import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/runtime/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { Api } = await import('../apps/extension/src/runtime/transport/api.ts');
const { RoomService } = await import('../apps/extension/src/runtime/rooms/rooms.ts');
const { emptyState } = await import('../apps/extension/src/runtime/composition/state.ts');
hooks.deregister();

const key = 'token:Solana:So11111111111111111111111111111111111111112';
const invite = (id = 'invite/one', avatarId = 'team-avatar') => ({ id, team: { id: 'team', name: 'Team', avatarId, memberCount: 2 }, from: { id: 'peer', nickname: 'Peer', avatarId: 'person-avatar' }, createdAt: Date.now(), expiresAt: Date.now() + 86400_000 });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

function fixture(t) {
  const calls = [], people = [], created = [], revoked = [];
  let pending = [], sequence = 0;
  const runtime = {
    state: emptyState(),
    auth: { session: { token: 'invitee-token', account: { id: 'invitee' } }, scope() {
      const session = this.session, current = () => this.session === session;
      return { current };
    } },
    api: { baseUrl: 'https://api.test', async request(path, options) {
      if (path === 'invites.list') return { invites: pending };
      if (['invites.accept', 'invites.ignore'].includes(path)) { pending = []; return { teamId: 'team', ignored: true }; }
      return Api.prototype.request.call(this, path, options);
    }, async roomAvatar(room, account) { people.push({ room, account }); return new Blob(['person']); } },
    dispatch: { mutate: path => runtime.api.request(path) },
    async refresh() {},
    emit() { service.prune(); },
  };
  runtime.api = Object.assign(new Api('https://api.test'), runtime.api);
  const service = new RoomService(runtime);
  const response = { handler: async () => new Response('team', { headers: { 'Content-Type': 'image/png' } }) };
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return response.handler(url, options); });
  t.mock.method(URL, 'createObjectURL', blob => { const url = `blob:avatar-${++sequence}`; created.push({ url, blob }); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.after(() => service.reset());
  return { runtime, service, calls, people, created, revoked, response, async invites(value) { pending = value; await service.invites(); } };
}

test('pending invite avatars use the authenticated invitee endpoint even with rooms off', async t => {
  const f = fixture(t), gate = deferred(); f.runtime.state.preferences.rooms = { off: true };
  f.response.handler = () => gate.promise;
  await f.invites([invite()]); f.runtime.emit(); f.runtime.emit();
  assert.equal(f.calls.length, 1, 'in-flight requests are deduplicated');
  assert.equal(f.calls[0].url, 'https://api.test/team-invites/invite%2Fone/avatar');
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer invitee-token');
  assert.equal(f.calls[0].options.credentials, 'omit'); assert.equal(f.calls[0].options.cache, 'no-store');
  assert.ok(f.calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(f.runtime.state.remoteTeams, [], 'no membership is needed');
  gate.resolve(new Response('team')); await settle();
  assert.deepEqual(f.runtime.state.rooms.avatars, { 'team:team': f.created[0].url });
  assert.equal(await f.created[0].blob.text(), 'team');
  await f.invites([invite()]); f.runtime.emit(); await settle();
  assert.equal(f.calls.length, 1, 'completed avatars stay cached'); assert.equal(f.people.length, 0);
});

test('person avatars retain account keys and remain cached when invite teams disappear', async t => {
  const f = fixture(t);
  f.runtime.state.rooms.people = { key, count: 1, people: [invite().from] };
  await f.invites([invite(), { ...invite('without-avatar', null), team: { id: 'empty', avatarId: null } }]); await settle();
  assert.deepEqual(f.people, [{ room: key, account: 'peer' }]); assert.equal(f.calls.length, 1);
  const personUrl = f.runtime.state.rooms.avatars.peer, teamUrl = f.runtime.state.rooms.avatars['team:team'];
  assert.ok(personUrl); assert.ok(teamUrl); assert.notEqual(personUrl, teamUrl);
  await f.invites([]); await settle();
  assert.deepEqual(f.revoked, [teamUrl]); assert.deepEqual(f.runtime.state.rooms.avatars, { peer: personUrl });
  assert.equal(f.people.length, 1);
});

test('accepting or ignoring an invite immediately revokes its team avatar', async t => {
  const f = fixture(t);
  for (const method of ['inviteAccept', 'inviteIgnore']) {
    await f.invites([invite()]); await settle(); const url = f.runtime.state.rooms.avatars['team:team'];
    assert.ok(url); await f.service[method](invite().id);
    assert.ok(f.revoked.includes(url)); assert.deepEqual(f.runtime.state.rooms.avatars, {});
  }
  assert.equal(f.created.length, 2);
});

test('late avatar responses are discarded after invites disappear or change avatar', async t => {
  const f = fixture(t), gone = deferred(), replaced = deferred();
  f.response.handler = () => gone.promise;
  await f.invites([invite()]); await f.invites([]);
  gone.resolve(new Response('gone')); await settle(); assert.equal(f.created.length, 0);
  f.response.handler = () => replaced.promise;
  await f.invites([invite()]);
  f.response.handler = async () => new Response('new');
  await f.invites([invite('invite/one', 'new-avatar')]); await settle();
  const url = f.runtime.state.rooms.avatars['team:team']; assert.ok(url);
  replaced.resolve(new Response('old')); await settle();
  assert.equal(f.created.length, 1); assert.equal(await f.created[0].blob.text(), 'new');
  assert.equal(f.runtime.state.rooms.avatars['team:team'], url);
  await f.invites([invite('invite/one', null)]); assert.deepEqual(f.revoked, [url]);
});

test('replacing a cached team avatar revokes the old object URL', async t => {
  const f = fixture(t); await f.invites([invite()]); await settle();
  const old = f.runtime.state.rooms.avatars['team:team'];
  await f.invites([invite('invite/one', 'replacement-avatar')]); await settle();
  assert.deepEqual(f.revoked, [old]); assert.notEqual(f.runtime.state.rooms.avatars['team:team'], old);
  assert.equal(f.calls.length, 2);
});

test('sign-out revokes loaded avatars and prevents late responses from reaching a replacement account', async t => {
  const f = fixture(t); await f.invites([invite()]); await settle();
  const old = f.runtime.state.rooms.avatars['team:team'], gate = deferred();
  f.response.handler = () => gate.promise;
  await f.invites([invite(), { ...invite('second', 'second-avatar'), team: { id: 'other', avatarId: 'second-avatar' } }]);
  f.service.reset(); f.runtime.auth.session = undefined;
  assert.deepEqual(f.revoked, [old]); assert.deepEqual(f.runtime.state.rooms.avatars, {});
  f.runtime.auth.session = { token: 'new-token', account: { id: 'replacement' } };
  f.response.handler = async () => new Response('replacement');
  await f.invites([{ ...invite('new', 'second-avatar'), team: { id: 'other', avatarId: 'second-avatar' } }]); await settle();
  const replacement = f.runtime.state.rooms.avatars['team:other']; assert.ok(replacement);
  gate.resolve(new Response('old-account')); await settle();
  assert.equal(f.created.length, 2); assert.deepEqual(f.runtime.state.rooms.avatars, { 'team:other': replacement });
  f.service.reset(); assert.deepEqual(f.revoked, [old, replacement]);
});

test('avatar failures do not create URLs or retry on every emit, and removed failures do not poison a new invite', async t => {
  const f = fixture(t);
  for (const failure of [async () => new Response('denied', { status: 403 }), async () => { throw Error('offline'); }]) {
    f.response.handler = failure;
    const before = f.calls.length;
    await f.invites([invite()]); await settle(); f.runtime.emit(); f.runtime.emit(); await settle();
    assert.equal(f.calls.length, before + 1); assert.deepEqual(f.runtime.state.rooms.avatars, {});
    assert.equal(f.created.length, 0); await f.invites([]);
  }
  f.response.handler = async () => new Response('recovered');
  await f.invites([invite('new-invite')]); await settle();
  assert.equal(f.created.length, 1); assert.ok(f.runtime.state.rooms.avatars['team:team']);
});

test('invite avatar errors retain server codes and metadata and share the API cooldown', async t => {
  const f = fixture(t);
  f.response.handler = async () => new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfterMs: 60_000 }), { status: 429, headers: { 'Retry-After': '60' } });
  await assert.rejects(f.service.inviteAvatar('invite'), { code: 'RATE_LIMITED', retryAfterMs: 60_000 });
  await assert.rejects(f.service.inviteAvatar('invite'), { status: 429 });
  assert.equal(f.calls.length, 1);
});

test('temporary avatar failures expire and retry while the invite remains visible', async t => {
  const f = fixture(t); let now = 1000; t.mock.method(Date, 'now', () => now);
  for (const status of [0, 429, 500, 503]) {
    await f.invites([]);
    f.response.handler = async () => { if (!status) throw Error('offline'); return new Response('retry', { status }); };
    const before = f.calls.length;
    await f.invites([invite()]); await settle(); f.runtime.emit(); await settle();
    assert.equal(f.calls.length, before + 1);
    f.response.handler = async () => new Response('recovered'); now += 60_000;
    f.runtime.emit(); await settle();
    assert.equal(f.calls.length, before + 2); assert.ok(f.runtime.state.rooms.avatars['team:team']);
  }
});

test('network recovery and credential epochs retry temporary avatar failures immediately', async t => {
  const f = fixture(t);
  for (const recover of [() => { f.runtime.state.connection.networkOnline = false; f.runtime.emit(); f.runtime.state.connection.networkOnline = true; f.runtime.emit(); }, () => f.service.reconnected(), () => { f.runtime.auth.session = { ...f.runtime.auth.session, token: 'renewed' }; f.runtime.emit(); }]) {
    await f.invites([]); f.response.handler = async () => { throw Error('offline'); };
    await f.invites([invite()]); await settle();
    const before = f.calls.length; f.response.handler = async () => new Response('recovered');
    recover(); await settle(); assert.equal(f.calls.length, before + 1); assert.ok(f.runtime.state.rooms.avatars['team:team']);
  }
});

test('permanent avatar failures survive time and network recovery within the credential epoch', async t => {
  const f = fixture(t); let now = 1000; t.mock.method(Date, 'now', () => now);
  for (const status of [403, 404, 410]) {
    await f.invites([]); f.response.handler = async () => new Response('unavailable', { status });
    await f.invites([invite()]); await settle(); const before = f.calls.length;
    now += 86400_000; f.service.reconnected(); f.runtime.emit(); await settle();
    assert.equal(f.calls.length, before);
  }
});

test('a server avatar retry deadline survives network recovery and reconnects', async t => {
  const f = fixture(t); let now = 1000; t.mock.method(Date, 'now', () => now);
  f.response.handler = async () => new Response('busy', { status: 503, headers: { 'Retry-After': '120' } });
  await f.invites([invite()]); await settle(); const before = f.calls.length;
  f.response.handler = async () => new Response('recovered');
  f.service.reconnected(); f.runtime.emit(); now += 60_000; f.runtime.emit(); await settle();
  assert.equal(f.calls.length, before);
  now += 61_000; f.runtime.emit(); await settle();
  assert.equal(f.calls.length, before + 1); assert.ok(f.runtime.state.rooms.avatars['team:team']);
});
