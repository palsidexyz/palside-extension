import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/runtime/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { lobbyCommand } = await import('../apps/extension/src/runtime/teams/command-handlers.ts');
const { Api } = await import('../apps/extension/src/runtime/transport/api.ts');
hooks.deregister();

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const team = (id, patch = {}) => ({ id, name: id, description: '', avatarId: null, ownerName: 'Owner', memberCount: 2, publishedAt: 1, recruitmentExpiresAt: Date.now() + 86_400_000, node: 'test', joined: false, ...patch });
const result = (...teams) => ({ teams, applications: [] });
function fixture(request) {
  let emits = 0;
  const runtime = {
    auth: { session: {}, scope() {
      const session = this.session;
      const current = () => this.session === session;
      const check = () => { if (!current()) throw Error('scope changed'); };
      return { current, check, async wait(work) { const value = await work; check(); return value; } };
    } },
    api: { request }, cache: { avatar: async id => id ? `blob:${id}` : undefined },
    state: { lobbyTeams: [] }, emit: () => { emits++; },
  };
  const commands = { runtime };
  return { runtime, run: payload => lobbyCommand.call(commands, { name: 'lobby', ...(payload === undefined ? {} : { payload }) }), emits: () => emits };
}

test('lobby sends search and sort through the real API contract and defaults existing callers to heat', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(new URL(url)); return Response.json(result(team('a', { activity: { level: 1, rank: 1, isNew: false } }))); });
  const f = fixture(); f.runtime.api = new Api('https://api.test');
  for (const payload of [undefined, {}, { q: '小队 & %_', sort: 'latest' }, { q: '' }, { sort: 'heat' }]) await f.run(payload);
  assert.deepEqual(calls.map(url => [url.pathname, url.searchParams.get('q'), url.searchParams.get('sort')]), [
    ['/lobby', '', 'heat'], ['/lobby', '', 'heat'], ['/lobby', '小队 & %_', 'latest'], ['/lobby', '', 'heat'], ['/lobby', '', 'heat'],
  ]);
  assert.deepEqual(f.runtime.state.lobbyTeams[0].activity, { level: 1, rank: 1, isNew: false });
});

test('lobby keeps server order, activity and application state without duplicating teams', async () => {
  const activity = { level: 2, rank: 2, isNew: false };
  const onlyApplication = team('closed', { activity: { level: 1, rank: null, isNew: true }, recruitmentExpiresAt: null });
  delete onlyApplication.joined;
  const response = result(team('first'), team('applied', { activity, avatarId: 'avatar', owner: { id: 'owner', avatarId: 'portrait' } }));
  response.applications = [
    { teamId: 'applied', team: team('applied', { name: 'old snapshot' }), status: 'pending', expiresAt: 123 },
    { teamId: 'closed', team: onlyApplication, status: 'rejected', expiresAt: 456, rejectedAt: 100 },
  ];
  const f = fixture(async () => response);
  assert.equal(await f.run(), response);
  const teams = f.runtime.state.lobbyTeams;
  assert.deepEqual(teams.map(row => row.id), ['first', 'applied', 'closed']);
  assert.equal(teams[1].name, 'applied');
  assert.deepEqual(teams[1].activity, activity);
  assert.equal(teams[1].requested, true);
  assert.equal(teams[1].applicationExpiresAt, 123);
  assert.equal(teams[1].avatar, 'blob:avatar');
  assert.equal(teams[1].ownerAvatar, 'blob:portrait');
  assert.equal(teams[2].applicationStatus, 'rejected');
  assert.equal(teams[2].applicationRetryAt, 100 + 86_400_000);
  assert.equal(teams[2].published, false);
  assert.deepEqual(teams[2].activity, onlyApplication.activity);
  assert.equal(teams[0].activity, undefined);
  assert.equal(f.emits(), 1);
});

test('a late lobby response cannot replace a newer search or load stale avatars', async () => {
  const old = deferred(); let calls = 0, avatars = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.resolve(result(team('new'))));
  f.runtime.cache.avatar = async () => { avatars++; };
  const pending = f.run({ q: 'old' });
  await f.run({ q: 'new', sort: 'latest' });
  const loaded = avatars;
  old.resolve(result(team('old')));
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(avatars, loaded);
  assert.equal(f.emits(), 1);
});

test('a lobby request waiting for avatars cannot overwrite a later request', async () => {
  const avatar = deferred(), started = deferred();
  const f = fixture(async (_id, options) => result(team(options.query.q, { avatarId: options.query.q })));
  f.runtime.cache.avatar = async id => {
    if (id === 'old') { started.resolve(); return avatar.promise; }
    return undefined;
  };
  const pending = f.run({ q: 'old' });
  await started.promise;
  await f.run({ q: 'new' });
  avatar.resolve('blob:old');
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(f.emits(), 1);
});

test('superseded request errors are ignored while current errors propagate', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.resolve(result(team('new'))));
  const pending = f.run({ q: 'old' });
  await f.run({ q: 'new' });
  old.reject(Error('old network failure'));
  assert.equal(await pending, undefined);
  f.runtime.api.request = async () => { throw Error('current network failure'); };
  await assert.rejects(f.run(), /current network failure/);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(f.emits(), 1);
});

test('a newer failed search still prevents older success from replacing the displayed list', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.reject(Error('offline')));
  const pending = f.run({ q: 'old' });
  await assert.rejects(f.run({ q: 'new' }), /offline/);
  old.resolve(result(team('old')));
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams, []);
  assert.equal(f.emits(), 0);
});

test('lobby requests are isolated per runtime and cannot publish across sessions', async () => {
  const pending = deferred();
  const first = fixture(() => pending.promise), second = fixture(async () => result(team('second')));
  const work = first.run();
  await second.run();
  pending.resolve(result(team('first')));
  await work;
  assert.equal(first.runtime.state.lobbyTeams[0].id, 'first');
  assert.equal(second.runtime.state.lobbyTeams[0].id, 'second');
  const stale = deferred(); first.runtime.api.request = () => stale.promise;
  const changed = first.run(); first.runtime.auth.session = {};
  stale.resolve(result(team('stale')));
  await assert.rejects(changed, /scope changed/);
  assert.equal(first.runtime.state.lobbyTeams[0].id, 'first');
  assert.equal(first.emits(), 1);
  first.runtime.auth.session = undefined;
  await assert.rejects(first.run());
});
