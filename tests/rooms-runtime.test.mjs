import { DAY_MS, MINUTE_MS } from '@palside/shared/units';
import { endpointsById, pathFor } from '../packages/shared/src/contracts/endpoints.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ROOM_MESSAGE_LIMIT, ROOM_RENEW_MS } from '@palside/shared/rules/rooms';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/runtime/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { RoomService } = await import('../apps/extension/src/runtime/rooms/rooms.ts');
const { TokenProfiles } = await import('../apps/extension/src/runtime/viewing/token-profiles.ts');
const { Api, ApiError } = await import('../apps/extension/src/runtime/transport/api.ts');
const { readPreferences, readPreferencePatch, emptyState } = await import('../apps/extension/src/runtime/composition/state.ts');
hooks.deregister();
const key = 'token:Solana:So11111111111111111111111111111111111111112', otherKey = 'token:Ethereum:0x1111111111111111111111111111111111111111';
const peer = { id: 'peer', nickname: 'Peer', avatarId: null }, self = { id: 'self', nickname: 'Self', avatarId: null };
const message = (id, author = peer, patch = {}) => ({ id, key, author, text: `Message ${id}`, createdAt: Date.now(), ...patch });
const summary = (room = key, patch = {}) => ({ key: room, site: 'gmgn', count: 2, faces: [peer], ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function fixture(t, rows = new Map()) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100 * DAY_MS });
  const calls = [], writes = [], avatarCalls = [], created = [], revoked = [], handlers = new Map();
  let generation = 0, emits = 0, saved = 0, sequence = 0, blocked = [], pendingInvites = [], refreshed = 0;
  t.mock.method(URL, 'createObjectURL', () => { const url = `blob:room-${++sequence}`; created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const runtime = {
    state: emptyState(),
    auth: { session: { account: { id: 'self', acceptTeamInvites: true }, token: 'token' }, scope() { const start = generation, session = this.session; const current = () => start === generation && session === this.session; const check = () => { if (!current()) throw Error('scope changed'); }; return { current, check, async wait(work) { const result = await work; check(); return result; } }; } },
    api: { async request(id, options = {}) {
      const endpoint = endpointsById[id], path = pathFor(endpoint, options.params ?? {}, options.query);
      options = { ...options, method: endpoint.method };
      calls.push({ path, options }); const route = `${options.method ?? 'GET'} ${path.split('?')[0]}`;
      if (handlers.has(route)) return handlers.get(route)(path, options);
      if (route === 'POST /rooms/lease') return { key: options.body.key, count: options.body.key ? 2 : 0, slowUntil: 500, slowMs: 15_000 };
      if (route === 'GET /rooms/summary') return summary(new URL(path, 'https://api.test').searchParams.get('key'));
      if (route === 'POST /rooms/messages') return { message: message('sent', self, { text: options.body.text, key: options.body.key }), slowUntil: Date.now() + 15_000, slowMs: 15_000 };
      if (route === 'GET /rooms/messages') return { messages: [], hasMore: false };
      if (route === 'POST /rooms/report') return { folded: true };
      if (route === 'POST /rooms/retract') return { retracted: true };
      if (route === 'POST /rooms/like') return { id: options.body.id, count: options.body.liked ? 1 : 0, liked: options.body.liked };
      if (route === 'GET /rooms/people') return { count: 2, people: [peer] };
      if (route === 'POST /rooms/likes') return { likes: [] };
      if (route === 'POST /rooms/hot/subscription') return { subscribed: options.body.open };
      if (route === 'POST /rooms/blocks') blocked = options.body.blocked ? [peer] : [];
      if (route.endsWith('/rooms/blocks')) return { people: blocked };
      if (route === 'GET /team-invites') return { invites: pendingInvites };
      if (route === 'GET /team-invites/options') return { accepts: true, teams: [{ teamId: 'team', state: 'can' }] };
      if (route === 'POST /team-invites') return { invite: { id: 'invite', expiresAt: Date.now() + 7 * DAY_MS } };
      if (route === 'POST /team-invites/invite/accept') { pendingInvites = []; return { teamId: 'team' }; }
      if (route === 'POST /team-invites/invite/ignore') { pendingInvites = []; return { ignored: true }; }
      if (route === 'PATCH /me' || route === 'POST /teams/team/invite-permission') return {};
      throw Error(`Unexpected request ${route}`);
    }, async roomAvatar(room, account) { avatarCalls.push({ key: room, account }); return new Blob(['avatar'], { type: 'image/png' }); } },
    storage: { async get(id) { return structuredClone(rows.get(id)?.value); }, async put(id, account, kind, value) { const row = { account, kind, value: structuredClone(value) }; rows.set(id, row); writes.push({ id, ...row }); }, async remove(id) { rows.delete(id); } },
    sharing: { async savePreferences() { saved++; } },
    tokens: new TokenProfiles(), directory: { clear() {}, show() {}, resume() {}, ensure: async () => {} }, pages: { clear() {}, resolve: async () => undefined, get() {} },
    dispatch: { mutate(id, options) { return runtime.api.request(id, { ...options, key: 'operation-key-0001' }); } },
    async refresh() { refreshed++; runtime.state.remoteTeams = [{ id: 'team', joined: true }]; },
    emit() { service.prune(); emits++; },
  };
  const service = new RoomService(runtime); runtime.rooms = service;
  t.after(async () => { service.reset(); await settle(); });
  const count = route => calls.filter(call => `${call.options.method ?? 'GET'} ${call.path.split('?')[0]}` === route).length;
  const enter = async () => { await service.panelChanged(true); await service.tabChanged({ asset: key.slice(6) }); };
  return { runtime, service, calls, count, handlers, rows, writes, avatarCalls, created, revoked, enter, invalidate: () => generation++, emits: () => emits, saved: () => saved, refreshed: () => refreshed, invites: value => { pendingInvites = value; } };
}

/** 设置 › 网页互动 › 弹幕 on or off, as the preferences command applies it. */
const danmaku = (f, on) => { f.runtime.state.preferences = { ...f.runtime.state.preferences, siteInteraction: on ? {} : { '*': { on: true, danmaku: false, signal: true, chart: true } } }; return f.service.preferencesChanged(); };

test('lease target follows the tab, pin overrides it, close follows the latest tab; the tab site accompanies renewal', async t => {
  const f = fixture(t);
  await f.service.tabChanged({ asset: key.slice(6), site: 'gmgn' }); assert.equal(f.count('POST /rooms/lease'), 0);
  await f.service.panelChanged(true); assert.equal(f.runtime.state.rooms.leased, key);
  assert.equal(f.runtime.state.rooms.current.slowUntil, 500); assert.equal(f.runtime.state.rooms.current.site, 'gmgn');
  assert.deepEqual(f.calls.find(call => call.path === '/rooms/lease').options.body, { key, site: 'gmgn' });
  await f.service.open({ key }); await f.service.tabChanged({ asset: otherKey.slice(6) }); assert.equal(f.runtime.state.rooms.current.key, key);
  await f.service.close(); assert.equal(f.runtime.state.rooms.current.key, otherKey);
  await f.service.tabChanged({ asset: null }); assert.equal(f.runtime.state.rooms.current, undefined); assert.equal(f.runtime.state.rooms.leased, undefined);
  assert.deepEqual(f.calls.filter(call => call.path === '/rooms/lease').map(call => call.options.body.key), [key, otherKey, null]);
});

test('renew loop runs every twenty seconds, panels close releases and reopening reacquires', async t => {
  const f = fixture(t); await f.enter();
  t.mock.timers.tick(ROOM_RENEW_MS); await settle(); assert.equal(f.count('POST /rooms/lease'), 2);
  await f.service.panelChanged(false); assert.equal(f.runtime.state.rooms.current, undefined);
  const n = f.calls.length; t.mock.timers.tick(3 * ROOM_RENEW_MS); await settle(); assert.equal(f.calls.length, n);
  await f.service.panelChanged(true); assert.equal(f.runtime.state.rooms.current.key, key);
  assert.ok(f.calls.every(call => !/active|enter|leave/.test(call.path)));
});

test('failed snapshots retry on the renew timer without leaving a permanently loading view', async t => {
  const f = fixture(t); f.handlers.set('GET /rooms/summary', () => { throw Error('offline'); });
  await assert.rejects(f.enter(), /offline/);
  // The room stays as 加载失败 (never a permanent 加载中) and retries itself after about one second, then two, four … (±20%)
  assert.equal(f.runtime.state.rooms.current.loading, false); assert.equal(f.runtime.state.rooms.current.failed, true);
  t.mock.timers.tick(1200); await settle(); assert.equal(f.runtime.state.rooms.current.failed, true);
  f.handlers.delete('GET /rooms/summary'); t.mock.timers.tick(2400); await settle();
  assert.equal(f.runtime.state.rooms.current.loading, false); assert.equal(f.runtime.state.rooms.current.failed, false);
});

test('rapid lease changes serialize and discard stale snapshots', async t => {
  const f = fixture(t), gate = deferred(); await f.service.panelChanged(true);
  f.handlers.set('POST /rooms/lease', (_path, options) => options.body.key === key ? gate.promise : { key: options.body.key, count: 4, slowUntil: 10 });
  const first = f.service.open({ key }); await settle(); const second = f.service.open({ key: otherKey });
  assert.equal(f.runtime.state.rooms.current.key, otherKey); assert.equal(f.runtime.state.rooms.current.loading, true);
  gate.resolve({ key, count: 2, slowUntil: 0 }); await Promise.all([first, second]);
  assert.equal(f.runtime.state.rooms.current.key, otherKey);
  assert.equal(f.calls.filter(call => call.path.startsWith('/rooms/summary')).length, 1);
});

test('off releases an in-flight lease and clears all public queries; late responses cannot restore them', async t => {
  const f = fixture(t); await f.enter(); await f.service.summary(key); await f.service.watchHot({ sourceId: 'one:hot', open: true }); await f.service.people(key);
  const gate = deferred(); f.handlers.set('GET /rooms/summary', () => gate.promise); const pending = f.service.summary(otherKey);
  await danmaku(f, false); assert.equal(f.runtime.state.rooms.current, undefined); assert.deepEqual(f.runtime.state.rooms.summaries, {}); assert.equal(f.runtime.state.rooms.hot, undefined); assert.equal(f.runtime.state.rooms.people, undefined);
  gate.resolve(summary(otherKey)); await pending; assert.deepEqual(f.runtime.state.rooms.summaries, {});
  const n = f.calls.length; t.mock.timers.tick(3 * ROOM_RENEW_MS); await settle(); assert.equal(f.calls.length, n);
  assert.equal(f.calls.filter(call => call.path === '/rooms/lease').at(-1).options.body.key, null);
  assert.throws(() => f.service.send('text'), { code: 'ROOM_OFF' }); await assert.rejects(f.service.summary(key), { code: 'ROOM_OFF' });
  f.handlers.delete('GET /rooms/summary'); await danmaku(f, true); assert.equal(f.runtime.state.rooms.current.key, key);
});

test('invalid keys, text and signed-out commands never contact the server', async t => {
  const f = fixture(t);
  for (const room of ['page:example.com', 'pool:Solana:anything', 'token:invalid']) assert.throws(() => f.service.open({ key: room }), { code: 'INVALID_INPUT' });
  assert.throws(() => f.service.tabChanged({ asset: 'wrong' }), { code: 'INVALID_INPUT' });
  await f.enter(); const n = f.calls.length;
  for (const text of ['', '  ', '😀'.repeat(61), 1]) assert.throws(() => f.service.send(text), { code: 'INVALID_INPUT' });
  assert.equal(f.calls.length, n); f.runtime.auth.session = undefined;
  await assert.rejects(f.service.invites(), { code: 'AUTH_REQUIRED' });
});

test('send trims Unicode text, deduplicates live echoes and retries unknown outcomes with the same operation key', async t => {
  const f = fixture(t); await f.enter(); let attempts = 0;
  f.handlers.set('POST /rooms/messages', (_path, options) => {
    if (++attempts === 1) throw new ApiError(0, { error: 'RESULT_UNKNOWN' });
    const sent = message('sent', self, { text: options.body.text }); f.service.consume({ key, type: 'message', message: sent }); return { message: sent, slowUntil: Date.now() + 5000 };
  });
  await assert.rejects(f.service.send(' hello ')); await f.service.send('hello');
  const calls = f.calls.filter(call => call.path === '/rooms/messages'); assert.equal(calls[0].options.key, calls[1].options.key); assert.equal(calls[1].options.body.text, 'hello');
  assert.deepEqual(f.runtime.state.rooms.current.messages.map(item => item.id), ['sent']); assert.equal(f.runtime.state.rooms.current.slowUntil, Date.now() + 5000);
  await f.service.send('😀'.repeat(60));
});

test('concurrent identical sends share their request; ROOM_SLOW preserves retryAfterMs and updates countdown', async t => {
  const f = fixture(t); await f.enter(); const gate = deferred(); f.handlers.set('POST /rooms/messages', () => gate.promise);
  const first = f.service.send('hello'); assert.equal(f.service.send('hello'), first); assert.throws(() => f.service.send('other'), { code: 'ROOM_BUSY' });
  const rejected = assert.rejects(first, error => error.code === 'ROOM_SLOW' && error.retryAfterMs === 2501 && error.text.values.seconds === 3);
  gate.reject(new ApiError(429, { error: 'ROOM_SLOW', retryAfterMs: 2501 })); await rejected;
  assert.equal(f.runtime.state.rooms.current.slowUntil, Date.now() + 2501);
});

for (const transition of ['snapshot failure', 'panel close', 'room switch', 'participation off', 'local clear']) test(`unknown sends keep their original key across ${transition}`, async t => {
  const f = fixture(t); await f.enter();
  f.handlers.set('POST /rooms/messages', () => { throw new ApiError(0, { error: 'RESULT_UNKNOWN' }); });
  await assert.rejects(f.service.send(' hello '), { code: 'RESULT_UNKNOWN' });
  if (transition === 'snapshot failure') {
    f.handlers.set('GET /rooms/summary', () => { throw Error('offline'); });
    f.service.reconnected(); await settle(); assert.equal(f.runtime.state.rooms.current.failed, true);
    f.handlers.delete('GET /rooms/summary'); await f.enter();
  } else if (transition === 'panel close') {
    await f.service.panelChanged(false); await f.service.panelChanged(true);
  } else if (transition === 'room switch') {
    await f.service.open({ key: otherKey }); await assert.rejects(f.service.send('hello'));
    await f.service.close();
  } else if (transition === 'participation off') {
    await danmaku(f, false); await danmaku(f, true);
  } else await f.service.clearLocal();
  await assert.rejects(f.service.send('another text'));
  f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages');
  assert.equal(sends.at(-1).options.key, sends[0].options.key);
  assert.notEqual(sends.at(-2).options.key, sends[0].options.key);
  if (transition === 'room switch') assert.notEqual(sends[1].options.key, sends[0].options.key);
  await f.service.send('hello');
  assert.notEqual(f.calls.at(-1).options.key, sends[0].options.key);
});

test('a send in flight remains shared after closing and reopening its panel', async t => {
  const f = fixture(t), gate = deferred(); await f.enter();
  f.handlers.set('POST /rooms/messages', () => gate.promise);
  const first = f.service.send('hello'), rejected = assert.rejects(first, { code: 'RESULT_UNKNOWN' });
  await f.service.panelChanged(false); await f.service.panelChanged(true);
  assert.equal(f.service.send('hello'), first);
  assert.throws(() => f.service.send('different'), { code: 'ROOM_BUSY' });
  gate.reject(new ApiError(0, { error: 'RESULT_UNKNOWN' })); await rejected;
  f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages');
  assert.equal(sends.length, 2); assert.equal(sends[0].options.key, sends[1].options.key);
});

test('send identities are account scoped and survive account reset without sharing another account request', async t => {
  const f = fixture(t), gate = deferred(), firstSession = f.runtime.auth.session; await f.enter();
  f.handlers.set('POST /rooms/messages', () => gate.promise);
  const first = assert.rejects(f.service.send('hello'), { code: 'ACCOUNT_CHANGED' });
  f.service.reset(); f.runtime.auth.session = { account: { id: 'other' }, token: 'other-token' }; await f.enter();
  f.handlers.set('POST /rooms/messages', () => { throw new ApiError(0, { error: 'RESULT_UNKNOWN' }); });
  await assert.rejects(f.service.send('hello'), { code: 'RESULT_UNKNOWN' });
  gate.reject(new ApiError(0, { error: 'RESULT_UNKNOWN' })); await first;
  f.service.reset(); f.runtime.auth.session = { ...firstSession }; await f.enter();
  f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages');
  assert.equal(sends.length, 3); assert.equal(sends[0].options.key, sends[2].options.key); assert.notEqual(sends[0].options.key, sends[1].options.key);
  assert.deepEqual(sends.map(send => send.options.token), ['token', 'other-token', 'token']);
});

for (const outcome of ['confirmed', 'rejected']) test(`${outcome} sends release identity even when their room view is closed`, async t => {
  const f = fixture(t), gate = deferred(); await f.enter();
  f.handlers.set('POST /rooms/messages', () => gate.promise);
  const work = f.service.send('hello'), done = outcome === 'confirmed' ? work : assert.rejects(work, { code: 'TEXT_NOT_ALLOWED' });
  await f.service.panelChanged(false);
  if (outcome === 'confirmed') gate.resolve({ message: message('sent', self), slowUntil: 0 });
  else gate.reject(new ApiError(400, { error: 'TEXT_NOT_ALLOWED' }));
  await done; assert.equal(f.runtime.state.rooms.current, undefined);
  await f.service.panelChanged(true); f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages'); assert.notEqual(sends[0].options.key, sends[1].options.key);
});

test('unknown sends retain their key through pre-lookup rejections and invalid responses', async t => {
  const f = fixture(t); await f.enter();
  for (const [status, error] of [[0, 'RESULT_UNKNOWN'], [401, 'AUTH_REQUIRED'], [409, 'ROOM_NOT_LEASED'], [429, 'RATE_LIMITED'], [502, 'INVALID_RESPONSE']]) {
    f.handlers.set('POST /rooms/messages', () => { throw new ApiError(status, { error }); });
    await assert.rejects(f.service.send('hello'), { code: error });
  }
  f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages'); assert.equal(new Set(sends.map(send => send.options.key)).size, 1);
});

test('ROOM_SLOW is a definite send rejection and the next attempt gets a new key', async t => {
  const f = fixture(t); await f.enter();
  f.handlers.set('POST /rooms/messages', () => { throw new ApiError(429, { error: 'ROOM_SLOW', retryAfterMs: 1000 }); });
  await assert.rejects(f.service.send('hello'), { code: 'ROOM_SLOW' });
  f.handlers.delete('POST /rooms/messages'); await f.service.send('hello');
  const sends = f.calls.filter(call => call.path === '/rooms/messages'); assert.notEqual(sends[0].options.key, sends[1].options.key);
});

test('snapshot replays in-flight message, folded, retract, count and likes events', async t => {
  const f = fixture(t), gate = deferred(); await f.service.panelChanged(true);
  f.handlers.set('GET /rooms/messages', () => gate.promise); 
  const opening = f.service.open({ key }); await settle();
  f.service.consume({ key, type: 'message', message: message('live') }); f.service.consume({ key, type: 'folded', id: 'live' });
  f.service.consume({ key, type: 'retract', id: 'gone' }); f.service.consume({ key, type: 'count', count: 12 });
  f.service.consume({ key, type: 'likes', id: 'live', count: 4 });
  gate.resolve({ messages: [message('gone')], hasMore: false }); await opening;
  const room = f.runtime.state.rooms.current; assert.deepEqual(room.messages.map(item => [item.id, item.folded]), [['live', true]]); assert.equal(room.count, 12); assert.deepEqual(room.likes?.live, { count: 4, liked: false });
  f.service.consume({ key: otherKey, type: 'count', count: 999 }); assert.equal(room.count, 12);
});

test('paging keeps chronological order, deduplicates, and cannot resurrect retracted or unfold messages', async t => {
  const f = fixture(t); f.handlers.set('GET /rooms/messages', () => ({ messages: [message('new')], hasMore: true })); await f.enter();
  const gate = deferred(); f.handlers.set('GET /rooms/messages', path => { assert.equal(new URL(path, 'https://api.test').searchParams.get('before'), 'new'); return gate.promise; });
  const pending = f.service.more(); assert.equal(f.service.more(), pending);
  f.service.consume({ key, type: 'retract', id: 'gone' }); f.service.consume({ key, type: 'folded', id: 'old' });
  gate.resolve({ messages: [message('gone'), message('old', peer, { createdAt: Date.now() - 10 }), message('new')], hasMore: false }); await pending;
  assert.deepEqual(f.runtime.state.rooms.current.messages.map(item => item.id), ['old', 'new']); assert.equal(f.runtime.state.rooms.current.messages[0].folded, true);
  assert.equal(f.runtime.state.rooms.current.hasMore, false);
  await f.service.report('old'); assert.equal(f.runtime.state.rooms.current.messages[0].reported, true);
  await f.service.retract('new'); assert.deepEqual(f.runtime.state.rooms.current.messages.map(item => item.id), ['old']);
});

test('messages have no age expiry and keep only the newest ten thousand', async t => {
  const f = fixture(t); await f.enter();
  f.service.consume({ key, type: 'message', message: message('ancient', peer, { createdAt: 1 }) });
  t.mock.timers.tick(30 * DAY_MS); f.runtime.emit(); assert.equal(f.runtime.state.rooms.current.messages[0].id, 'ancient');
  const emit = f.runtime.emit; f.runtime.emit = () => {};
  for (let i = 0; i < ROOM_MESSAGE_LIMIT; i++) f.service.consume({ key, type: 'message', message: message(String(i), peer, { createdAt: i + 2 }) });
  f.runtime.emit = emit; emit();
  assert.equal(f.runtime.state.rooms.current.messages.length, ROOM_MESSAGE_LIMIT); assert.ok(!f.runtime.state.rooms.current.messages.some(item => item.id === 'ancient'));
});

test('likes update optimistically, roll back failure, take a like back and keep my flag through events', async t => {
  const f = fixture(t); f.handlers.set('GET /rooms/messages', () => ({ messages: [message('1')], hasMore: false })); await f.enter(); const gate = deferred();
  f.handlers.set('POST /rooms/like', () => gate.promise); const pending = f.service.like(key, '1', true); await settle();
  assert.deepEqual(f.runtime.state.rooms.current.likes['1'], { count: 1, liked: true });
  const rejected = assert.rejects(pending, /failed/); gate.reject(Error('failed')); await rejected;
  assert.deepEqual(f.runtime.state.rooms.current.likes['1'], { count: 0, liked: false });
  f.handlers.set('POST /rooms/like', (_, options) => ({ id: '1', count: options.body.liked ? 5 : 4, liked: options.body.liked }));
  await f.service.like(key, '1', true); assert.deepEqual(f.runtime.state.rooms.current.likes['1'], { count: 5, liked: true });
  f.service.consume({ key, type: 'likes', id: '1', count: 6 }); assert.deepEqual(f.runtime.state.rooms.current.likes['1'], { count: 6, liked: true });
  await f.service.like(key, '1', false); assert.deepEqual(f.runtime.state.rooms.current.likes['1'], { count: 4, liked: false });
  assert.equal(f.count('POST /rooms/lease'), 1, 'a like needs no lease of its own');
  assert.throws(() => f.service.like(key, '1', 'yes'), { code: 'INVALID_INPUT' });
});

test('likes: one batched read per room, events win over a pending answer, and a new room asks again', async t => {
  const f = fixture(t), answer = deferred(), other = { id: 'other', nickname: 'Other', avatarId: null };
  f.handlers.set('GET /rooms/messages', () => ({ messages: [message('1'), message('2', self), message('3', other)], hasMore: false }));
  f.handlers.set('POST /rooms/likes', () => answer.promise);
  await f.enter(); t.mock.timers.tick(200); await settle();
  const reads = f.calls.filter(call => call.path === '/rooms/likes');
  assert.equal(reads.length, 1); assert.deepEqual(reads[0].options.body, { key, ids: ['1', '2', '3'] });
  f.service.consume({ key, type: 'likes', id: '1', count: 9 });
  answer.resolve({ likes: [{ id: '1', count: 2, liked: true }, { id: '3', count: 1, liked: false }] }); await settle();
  assert.deepEqual(f.runtime.state.rooms.current.likes, { 1: { count: 9, liked: false }, 3: { count: 1, liked: false } });
  f.service.consume({ key, type: 'message', message: message('4') }); f.service.consume({ key, type: 'message', message: message('5') }); t.mock.timers.tick(200); await settle();
  assert.equal(f.count('POST /rooms/likes'), 2); assert.deepEqual(f.calls.filter(call => call.path === '/rooms/likes')[1].options.body.ids, ['4', '5']);
  f.handlers.set('POST /rooms/likes', () => ({ likes: [] }));
  await f.service.tabChanged({ asset: otherKey.slice(6) }); t.mock.timers.tick(200); await settle();
  assert.equal(f.runtime.state.rooms.current.likes, undefined); assert.equal(f.count('POST /rooms/likes'), 2, 'a room without messages asks nothing');
});

test('block hides authors, faces and people, revokes avatars; unblock permits author messages again', async t => {
  const f = fixture(t), author = { ...peer, avatarId: 'avatar' };
  f.handlers.set('GET /rooms/summary', () => summary(key, { faces: [author] })); f.handlers.set('GET /rooms/people', () => ({ count: 2, people: [author] }));
  await f.enter(); f.service.consume({ key, type: 'message', message: message('visible', author) }); await f.service.people(key); await settle();
  assert.equal(f.avatarCalls.length, 1); const url = f.runtime.state.rooms.avatars.peer; assert.ok(url);
  await f.service.block('peer', true); assert.deepEqual(f.runtime.state.rooms.current.messages, []); assert.deepEqual(f.runtime.state.rooms.current.faces, []); assert.deepEqual(f.runtime.state.rooms.people.people, []); assert.equal(f.runtime.state.rooms.current.count, 2); assert.ok(f.revoked.includes(url));
  await f.service.block('peer', false); assert.equal(f.runtime.state.rooms.current.messages.length, 1);
});

test('block reads and writes serialize and the latest intent wins', async t => {
  const f = fixture(t), gate = deferred(); f.handlers.set('POST /rooms/blocks', (_path, options) => options.body.blocked ? gate.promise : { people: [] });
  const first = f.service.block('peer', true); await settle(); const second = f.service.block('peer', false); const reading = f.service.blocks(); await settle();
  assert.equal(f.count('POST /rooms/blocks'), 1); assert.equal(f.count('GET /rooms/blocks'), 0);
  gate.resolve({ people: [peer] }); await Promise.all([first, second, reading]); assert.deepEqual(f.runtime.state.rooms.blocked, []);
});

test('avatars load only faces, people and visible authors, discard late loads and revoke on clear', async t => {
  const f = fixture(t), gate = deferred(); f.runtime.api.roomAvatar = async (room, account) => { f.avatarCalls.push({ key: room, account }); return gate.promise; };
  f.handlers.set('GET /rooms/summary', () => summary(key, { faces: [{ ...peer, avatarId: 'avatar' }] }));
  await f.enter(); await settle(); assert.equal(f.avatarCalls.length, 1);
  await danmaku(f, false); gate.resolve(new Blob(['late'])); await settle(); assert.equal(f.created.length, 0);
  await danmaku(f, true); await settle(); assert.equal(f.created.length, 1);
  const url = f.runtime.state.rooms.avatars.peer; await f.service.clearLocal(); assert.ok(f.revoked.includes(url));
});

test('start applies the account invite setting without directory reads; acceptance refreshes team snapshot', async t => {
  const f = fixture(t), invite = { id: 'invite', team: { id: 'team' } }; f.invites([invite]); f.runtime.auth.session.account.acceptTeamInvites = false;
  await f.service.start(); assert.equal(f.runtime.state.rooms.acceptInvites, false); assert.equal(f.count('GET /rooms/blocks'), 0); assert.equal(f.count('GET /team-invites'), 0);
  await f.service.invites(); assert.deepEqual(f.runtime.state.rooms.invites, [invite]);
  assert.deepEqual(await f.service.inviteOptions('peer'), { accepts: true, teams: [{ teamId: 'team', state: 'can' }] });
  const sent = await f.service.inviteSend('team', 'peer'); assert.equal(sent.invite.id, 'invite'); assert.ok(f.calls.find(call => call.path === '/team-invites' && call.options.method === 'POST').options.key);
  assert.deepEqual(await f.service.inviteAccept('invite'), { teamId: 'team' }); assert.equal(f.refreshed(), 1); assert.deepEqual(f.runtime.state.rooms.invites, []); assert.equal(f.runtime.state.remoteTeams[0].joined, true);
  f.invites([invite]); await f.service.invites(); await f.service.inviteIgnore('invite'); assert.deepEqual(f.runtime.state.rooms.invites, []);
});

test('invite settings and owner permission use the agreed routes; business errors retain stable codes', async t => {
  const f = fixture(t); await f.service.inviteSettings(false); assert.equal(f.runtime.state.rooms.acceptInvites, false);
  assert.deepEqual(f.calls.at(-1), { path: '/me', options: { method: 'PATCH', body: { acceptTeamInvites: false } } });
  await f.service.invitePermission('team', true); assert.deepEqual(f.calls.at(-1), { path: '/teams/team/invite-permission', options: { method: 'POST', params: { id: 'team' }, body: { on: true } } }); assert.equal(f.refreshed(), 1);
  for (const code of ['INVITE_LIMIT', 'INVITE_ACCOUNT_UNAVAILABLE', 'INVITE_AWAITING_REPLY', 'INVITE_MEMBER', 'TEAM_FULL', 'INVITE_FORBIDDEN', 'INVITE_EXPIRED']) {
    f.handlers.set('POST /team-invites', () => { throw new ApiError(409, { error: code }); }); await assert.rejects(f.service.inviteSend('team', 'peer'), { code });
  }
});

test('room reconnection refreshes its snapshot without directory reads; participation off never reacquires a lease', async t => {
  const f = fixture(t); await f.enter(); const before = f.count('GET /rooms/summary'); f.service.reconnected(); await settle();
  assert.equal(f.count('GET /rooms/summary'), before + 1); assert.equal(f.count('GET /team-invites'), 0);
  await danmaku(f, false); const leases = f.count('POST /rooms/lease'); f.service.reconnected(); await settle(); assert.equal(f.count('POST /rooms/lease'), leases); assert.equal(f.count('GET /team-invites'), 0);
});

test('account reset rejects late work, releases with the old bearer and clears all room state', async t => {
  const f = fixture(t); await f.enter(); const gate = deferred(); f.handlers.set('GET /team-invites', () => gate.promise);
  const reading = assert.rejects(f.service.invites(), { code: 'ACCOUNT_CHANGED' });
  f.service.reset(); f.invalidate(); f.runtime.auth.session = { account: { id: 'replacement' }, token: 'replacement-token' };
  gate.resolve({ invites: [{ id: 'late' }] }); await reading; await settle();
  assert.deepEqual(f.runtime.state.rooms, { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} });
  assert.equal(f.calls.filter(call => call.path === '/rooms/lease').at(-1).options.token, 'token');
});

test('preferences move the stored 参与弹幕 switch to the 弹幕 card and fresh state has no transient toggle or room fields', () => {
  const moved = readPreferences({ rooms: { off: true, noticed: true } }); assert.deepEqual(moved.rooms, { noticed: true }); assert.deepEqual(moved.siteInteraction, { '*': { on: true, danmaku: false, signal: true, chart: true } }); assert.deepEqual(readPreferencePatch({ rooms: { off: true } }), { rooms: {} }); assert.equal(readPreferencePatch({ rooms: { intro: true } }), undefined);
  assert.equal(readPreferences({ rooms: { intro: true } }).rooms, undefined); assert.deepEqual(emptyState().preferences, { current: '', notifications: 'off' });
  assert.equal('toggles' in emptyState(), false);
  assert.equal('recent' in emptyState().rooms, false); assert.equal('active' in emptyState().rooms, false);
});

test('API uses accountId for room avatars and preserves slow errors without route-wide cooldown', async t => {
  const calls = []; t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return url.includes('/avatar') ? new Response('image') : new Response(JSON.stringify({ error: 'ROOM_SLOW', retryAfterMs: 2500 }), { status: 429 }); });
  const api = new Api('https://api.test'); api.token = 'bearer'; await api.roomAvatar(key, 'peer');
  assert.equal(new URL(calls[0].url).searchParams.get('accountId'), 'peer'); assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer');
  for (let i = 0; i < 2; i++) await assert.rejects(api.request('rooms.send', { body: { key, text: 'hi' }, key: 'retry-operation-0001' }), error => error.code === 'ROOM_SLOW' && error.retryAfterMs === 2500);
  assert.equal(calls.length, 3); assert.equal(calls[1].options.headers['Idempotency-Key'], 'retry-operation-0001');
});

test('accept waits out an older team snapshot and requests a fresh post-join snapshot', async t => {
  const f = fixture(t), gate = deferred(); f.runtime.auth.refreshing = gate.promise;
  const accepting = f.service.inviteAccept('invite'); await settle(); assert.equal(f.refreshed(), 0);
  gate.resolve(); await accepting; assert.equal(f.refreshed(), 1);
});

test('off during an in-flight lease queues release after the old acquisition', async t => {
  const f = fixture(t), gate = deferred(); await f.service.panelChanged(true);
  f.handlers.set('POST /rooms/lease', (_path, options) => options.body.key ? gate.promise : { key: null, count: 0, slowUntil: 0 });
  const opening = f.service.open({ key }); await settle(); const stopping = danmaku(f, false); await settle();
  assert.equal(f.runtime.state.rooms.current, undefined); gate.resolve({ key, count: 2, slowUntil: 0 }); await Promise.all([opening, stopping]);
  assert.deepEqual(f.calls.filter(call => call.path === '/rooms/lease').map(call => call.options.body.key), [key, null]); assert.equal(f.count('GET /rooms/summary'), 0);
});

test('slow snapshot reads cannot delay lease renewal or panel-close release', async t => {
  const f = fixture(t), gate = deferred(); await f.service.panelChanged(true); f.handlers.set('GET /rooms/messages', () => gate.promise);
  const opening = f.service.open({ key }); await settle(); assert.equal(f.runtime.state.rooms.current.loading, true);
  t.mock.timers.tick(ROOM_RENEW_MS); await settle(); assert.equal(f.count('POST /rooms/lease'), 2);
  await f.service.panelChanged(false); assert.equal(f.calls.filter(call => call.path === '/rooms/lease').at(-1).options.body.key, null);
  gate.resolve({ messages: [message('late')], hasMore: false }); await opening; assert.equal(f.runtime.state.rooms.current, undefined);
});

for (const operation of ['send', 'report', 'retract', 'more']) test(`in-flight ${operation} survives same-key reconnect snapshot replacement`, async t => {
  const f = fixture(t), command = deferred(), snapshot = deferred(); f.handlers.set('GET /rooms/messages', () => ({ messages: [message('existing')], hasMore: true })); await f.enter();
  let pending;
  if (operation === 'send') { f.handlers.set('POST /rooms/messages', () => command.promise); pending = f.service.send('hi'); }
  if (operation === 'report') { f.handlers.set('POST /rooms/report', () => command.promise); pending = f.service.report('existing'); }
  if (operation === 'retract') { f.handlers.set('POST /rooms/retract', () => command.promise); pending = f.service.retract('existing'); }
  if (operation === 'more') { f.handlers.set('GET /rooms/messages', () => command.promise); pending = f.service.more(); }
  await settle(); f.handlers.set('GET /rooms/messages', () => snapshot.promise); f.service.reconnected(); await settle();
  command.resolve(operation === 'send' ? { message: message('sent', self), slowUntil: Date.now() + 5000 } : operation === 'report' ? { folded: true } : operation === 'retract' ? { retracted: true } : { messages: [message('older', peer, { createdAt: 1 })], hasMore: false }); await pending;
  snapshot.resolve({ messages: [message('existing')], hasMore: true }); await settle();
  const room = f.runtime.state.rooms.current;
  if (operation === 'send') { assert.ok(room.messages.some(item => item.id === 'sent')); assert.equal(room.slowUntil, Date.now() + 5000); }
  if (operation === 'report') { assert.equal(room.messages[0].reported, true); assert.equal(room.messages[0].folded, true); }
  if (operation === 'retract') assert.equal(room.messages.length, 0);
  if (operation === 'more') { assert.deepEqual(room.messages.map(item => item.id), ['older', 'existing']); assert.equal(room.hasMore, false); }
});

for (const [method, args, route] of [['summary', [key], '/rooms/summary'], ['people', [key], '/rooms/people'], ['blocks', [], '/rooms/blocks'], ['invites', [], '/team-invites']]) {
  test(`concurrent ${method} reads share one request and unchanged refreshes do not emit`, async t => {
    const f = fixture(t), gate = deferred();
    const result = method === 'summary' ? summary() : method === 'people' ? { count: 2, people: [peer] } : method === 'blocks' ? { people: [peer] } : { invites: [] };
    f.handlers.set(`GET ${route}`, () => gate.promise);
    const first = f.service[method](...args), second = f.service[method](...args); await settle();
    assert.equal(f.count(`GET ${route}`), 1);
    gate.resolve(structuredClone(result)); await Promise.all([first, second]);
    const emits = f.emits(); t.mock.timers.tick(30_000);
    f.handlers.set(`GET ${route}`, () => structuredClone(result));
    await f.service[method](...args);
    assert.equal(f.count(`GET ${route}`), 2, 'explicit refresh still reaches the service');
    assert.equal(f.emits(), emits, 'timestamps alone do not publish a new revision');
  });
}

test('read deduplication ends at account replacement and failed reads can be retried', async t => {
  const f = fixture(t), gate = deferred(); f.handlers.set('GET /rooms/summary', () => gate.promise);
  const old = assert.rejects(f.service.summary(key), { code: 'ACCOUNT_CHANGED' });
  f.service.reset(); f.runtime.auth.session = { account: { id: 'other' }, token: 'other' };
  f.handlers.set('GET /rooms/summary', () => summary());
  await f.service.summary(key); assert.equal(f.count('GET /rooms/summary'), 2);
  gate.resolve(summary()); await old;
  assert.equal(f.runtime.state.rooms.summaries[key].key, key);
  f.handlers.set('GET /rooms/summary', () => { throw new ApiError(503, { error: 'SERVICE_UNAVAILABLE' }); });
  t.mock.timers.tick(31_000); // a fresh summary is reused; an older one is read again
  await assert.rejects(f.service.summary(key), { status: 503 });
  f.handlers.set('GET /rooms/summary', () => summary());
  await f.service.summary(key); assert.equal(f.count('GET /rooms/summary'), 4);
});

test('a new offscreen room service acquires the unchanged host tab with background and panels retained', async t => {
  const { roomTab } = await import('../apps/extension/src/background/room-tab.ts');
  const { stateSync } = await import('../apps/extension/src/background/state.ts');
  const f = fixture(t), tab = { id: 5, windowId: 10, url: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' };
  let receiver = f.service; const snapshots = [];
  const bg = {
    state: f.runtime.state, panels: new Map([[{}, 10]]), activeTab: async () => tab, panelWindows: { current: () => 10 },
    browser: { windows: { getLastFocused: async () => ({ id: 10 }) }, idle: { queryState: async () => 'active' }, permissions: { contains: async () => true } },
    async run({ name, payload }) {
      snapshots.push({ name, payload });
      if (name === 'room-tab') await receiver.tabChanged(payload);
      if (name === 'room-panels') await receiver.panelChanged(payload.connected);
      return { ok: true };
    },
    sharing: { observer: { replay: async () => {} }, replayDeviceState: async () => {} },
    panel: { reportRoomPanels: () => bg.run({ name: 'room-panels', payload: { connected: bg.panels.size > 0 } }) },
  };
  bg.roomTab = roomTab(bg); const sync = stateSync(bg);
  sync.runtimeReady('first'); await settle();
  assert.equal(f.runtime.state.rooms.leased, key);
  f.service.reset(); await settle();
  receiver = new RoomService(f.runtime); f.runtime.rooms = receiver; t.after(() => receiver.reset());
  sync.runtimeReady('second'); await settle();
  assert.equal(f.runtime.state.rooms.leased, key);
  assert.equal(snapshots.filter(command => command.name === 'room-tab').length, 2);
  assert.equal(bg.panels.size, 1);
});

test('an inbox change during an invite read fetches again instead of sharing the stale read', async t => {
  const f = fixture(t), gate = deferred(), invite = { id: 'invite', team: { id: 'team', name: 'Team' } };
  f.handlers.set('GET /team-invites', () => gate.promise);
  const stale = f.service.invites(); await settle();
  f.handlers.set('GET /team-invites', () => ({ invites: [invite] }));
  await f.service.invites(true);
  gate.resolve({ invites: [] }); await stale;
  assert.equal(f.count('GET /team-invites'), 2);
  assert.deepEqual(f.runtime.state.rooms.invites, [invite]);
});

test('summary reads release their keys on success and failure without losing concurrent reads', async t => {
  const f = fixture(t), gate = deferred();
  f.handlers.set('GET /rooms/summary', () => gate.promise);
  const first = f.service.summary(key), second = f.service.summary(key); gate.resolve(summary());
  await Promise.all([first, second]); assert.equal(f.service.summaryReads.size, 0);
  f.handlers.set('GET /rooms/summary', () => { throw Error('offline'); });
  await assert.rejects(f.service.summary(otherKey)); assert.equal(f.service.summaryReads.size, 0);
});
test('summary LRU and expiry preserve all displayed keys and release unreferenced avatar URLs', async t => {
  const f = fixture(t); await f.enter(); await f.service.open({ key: otherKey });
  f.service.watch('panel:details', key);
  f.handlers.set('GET /rooms/summary', path => { const room = new URL(path, 'https://api.test').searchParams.get('key'); return summary(room, { faces: [{ ...peer, id: 'cached-peer', avatarId: 'shared' }] }); });
  t.mock.timers.tick(31_000); // past the room snapshot's fresh summary
  await f.service.summary(key); await settle(); const url = f.runtime.state.rooms.avatars['cached-peer'];
  const roomKey = i => `token:Ethereum:0x${i.toString(16).padStart(40, '0')}`;
  for (let i = 0; i < 70; i++) { await f.service.summary(roomKey(i)); t.mock.timers.tick(1); }
  assert.equal(Object.keys(f.runtime.state.rooms.summaries).length, 64);
  assert.ok(f.runtime.state.rooms.summaries[key]); assert.ok(f.runtime.state.rooms.summaries[otherKey]);
  await f.service.summary(roomKey(20)); await f.service.summary(roomKey(71));
  assert.ok(f.runtime.state.rooms.summaries[roomKey(20)]); assert.equal(f.runtime.state.rooms.summaries[roomKey(8)], undefined);
  t.mock.timers.tick(10 * MINUTE_MS); f.service.prune();
  assert.deepEqual(Object.keys(f.runtime.state.rooms.summaries).sort(), [key, otherKey].sort());
  assert.equal(f.runtime.state.rooms.avatars['cached-peer'], url); assert.ok(!f.revoked.includes(url));
  f.service.watch('panel:details'); f.service.prune();
  assert.equal(f.runtime.state.rooms.summaries[key], undefined); assert.ok(f.revoked.includes(url));
});

test('danmaku runtime accepts sixty composed graphemes and rejects sixty-one before sending', async t => {
  const f = fixture(t); await f.enter();
  for (const glyph of ['👨‍👩‍👧‍👦', '👩🏽‍💻', '🇨🇳', 'e\u0301']) {
    const text = glyph.repeat(60);
    const result = await f.service.send(` ${text} `); assert.equal(result.message.text, text);
    const calls = f.count('POST /rooms/messages');
    assert.throws(() => f.service.send(text + glyph), { code: 'INVALID_INPUT' });
    assert.equal(f.count('POST /rooms/messages'), calls);
  }
});

test('hot uses one device subscription across panels, local filters, and no polling', async t => {
  const f = fixture(t); await f.enter();
  await f.service.watchHot({ sourceId: 'one:hot', open: true });
  assert.deepEqual(f.runtime.state.rooms.hot, { rows: [], loaded: false });
  await f.service.watchHot({ sourceId: 'two:hot', open: true });
  await f.service.watchHot({ sourceId: 'one:hot', open: true });
  assert.equal(f.count('POST /rooms/hot/subscription'), 1);
  const rows = [{ ...summary(), count: 5, rise: 3 }];
  f.service.consume({ type: 'hot', rooms: { rows } });
  assert.deepEqual(f.runtime.state.rooms.hot, { rows, loaded: true });
  t.mock.timers.tick(MINUTE_MS); await settle();
  assert.equal(f.count('POST /rooms/hot/subscription'), 1);
  assert.equal(f.count('GET /rooms/hot'), 0);
  f.service.dropPanel('one'); await settle(); assert.equal(f.count('POST /rooms/hot/subscription'), 1);
  f.service.dropPanel('two'); await settle();
  assert.equal(f.calls.filter(call => call.path === '/rooms/hot/subscription').at(-1).options.body.open, false);
  assert.equal(f.runtime.state.rooms.hot, undefined);
  f.service.consume({ type: 'hot', rooms: { rows } }); assert.equal(f.runtime.state.rooms.hot, undefined);
});

test('hot reopens after live socket reconnect and closes when participation is disabled', async t => {
  const f = fixture(t); await f.enter();
  await f.service.watchHot({ sourceId: 'one:hot', open: true });
  f.service.reconnected(); await settle();
  assert.equal(f.count('POST /rooms/hot/subscription'), 2);
  await danmaku(f, false); await settle();
  assert.equal(f.calls.filter(call => call.path === '/rooms/hot/subscription').at(-1).options.body.open, false);
  assert.equal(f.runtime.state.rooms.hot, undefined);
});

test('effective server slow interval reaches the composer state', async t => {
  const f = fixture(t); await f.enter();
  assert.equal(f.runtime.state.rooms.current.slowMs, 15_000);
  await f.service.send('hello');
  assert.equal(f.runtime.state.rooms.current.slowUntil, Date.now() + 15_000);
  assert.equal(f.runtime.state.rooms.current.slowMs, 15_000);
});

test('hot faces load avatars, respect blocks, and room count updates reach the row', async t => {
  const f = fixture(t); await f.enter();
  await f.service.watchHot({ sourceId: 'one:hot', open: true });
  f.service.consume({ type: 'hot', rooms: { rows: [{ ...summary(), faces: [{ ...peer, avatarId: 'hot-avatar' }] }] } });
  await settle(); assert.equal(f.avatarCalls.length, 1); assert.ok(f.runtime.state.rooms.avatars.peer);
  f.service.consume({ key, type: 'count', count: 8 });
  assert.equal(f.runtime.state.rooms.hot.rows[0].count, 8);
  await f.service.block(peer.id, true);
  assert.deepEqual(f.runtime.state.rooms.hot.rows[0].faces, []); assert.equal(f.runtime.state.rooms.avatars.peer, undefined);
});

test('a fresh summary is reused instead of read again, and expires back to the service', async t => {
  const f = fixture(t); await f.service.panelChanged(true);
  await f.service.summary(otherKey); await f.service.summary(otherKey);
  assert.equal(f.count('GET /rooms/summary'), 1);
  t.mock.timers.tick(31_000);
  await f.service.summary(otherKey);
  assert.equal(f.count('GET /rooms/summary'), 2);
});

test('switching back to a recent room shows its last lines and known numbers while the service snapshot loads', async t => {
  const f = fixture(t), gate = deferred();
  f.handlers.set('GET /rooms/messages', (path) => path.includes(encodeURIComponent(otherKey)) || path.includes(otherKey) ? { messages: [], hasMore: false } : { messages: [message('kept')], hasMore: false });
  await f.enter();
  assert.deepEqual(f.runtime.state.rooms.current.messages.map(item => item.id), ['kept']);
  await f.service.tabChanged({ asset: otherKey.slice(6) });
  f.handlers.set('GET /rooms/messages', () => gate.promise);
  const back = f.service.tabChanged({ asset: key.slice(6) }); await settle();
  const room = f.runtime.state.rooms.current;
  assert.equal(room.key, key); assert.equal(room.loading, true);
  assert.deepEqual(room.messages.map(item => item.id), ['kept']);
  assert.equal(room.count, 2, 'numbers come from the token summary');
  gate.resolve({ messages: [message('fresh')], hasMore: false }); await back;
  assert.deepEqual(f.runtime.state.rooms.current.messages.map(item => item.id), ['fresh'], 'the service snapshot replaces kept lines');
});
