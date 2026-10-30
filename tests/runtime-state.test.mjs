import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createPatchSliceCache, diffState } from '../apps/extension/src/runtime/transport/state-diff.ts';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === './config' && context.parentURL?.endsWith('/composition/core.ts')) return { url: 'data:text/javascript,export const API_URL = "http://127.0.0.1:0";', shortCircuit: true };
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const browserHost = {};
const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
Object.defineProperty(globalThis, 'chrome', { configurable: true, value: browserHost });
const bridge = await import('../apps/extension/src/runtime/transport/bridge.ts');
if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor); else delete globalThis.chrome;
const { stateSync } = await import('../apps/extension/src/background/state.ts');
const { PalsideService } = await import('../apps/extension/src/runtime/composition/core.ts');
hooks.deregister();

function runtime() {
  const service = new PalsideService(undefined, undefined, { async get() {}, async rows() { return []; }, async cleanup() {} });
  service.api.request = async () => ({ websiteUrl: '', signupDifficulty: 0 });
  service.cache.lastCleanup = Date.now();
  return service;
}

test('concurrent wallet catch-up shares startup and a later refresh rereads configuration once', async t => {
  const service = runtime(), requests = [], stored = new Map(), gate = Promise.withResolvers();
  service.storage.get = async key => structuredClone(stored.get(key));
  service.storage.put = async (key, _account, _kind, value) => { stored.set(key, structuredClone(value)); };
  service.auth.session = { account: { id: 'self' }, token: 'token' };
  const config = { enabled: false, version: 1, deployment: null, dailySponsoredLimit: 0, updatedAt: 1 };
  service.api.request = async endpoint => {
    requests.push(endpoint);
    if (endpoint === 'chain.wallet') return null;
    if (endpoint === 'chain.recovery') return { items: [], nextCursor: null };
    assert.equal(endpoint, 'chain.config');
    await gate.promise;
    return structuredClone(config);
  };
  t.after(() => service.wallet.reset());
  const first = service.wallet.refresh(), second = service.wallet.refresh();
  gate.resolve();
  const snapshots = await Promise.all([first, second]);
  assert.deepEqual(requests, ['chain.wallet', 'chain.config', 'chain.recovery']);
  assert.ok(snapshots.every(state => state.availability === 'closed'));
  config.version++;
  await service.wallet.refresh();
  assert.deepEqual(requests, ['chain.wallet', 'chain.config', 'chain.recovery', 'chain.config']);
  assert.equal(service.state.wallet.config.version, 2);
});

test('team wallet pages append unique cards and first-page refresh keeps history and its cursor', async () => {
  const service = runtime(); service.state.preferences.current = 'a';
  const packet = (id, status = 'active') => ({ packet: { id, status } });
  const transfer = (id, status = 'submitted') => ({ id, status });
  const pages = [
    { packets: [packet('p1')], transfers: [transfer('t1')], nextCursor: 'one' },
    { packets: [packet('p1', 'exhausted'), packet('p2')], transfers: [transfer('t2')], nextCursor: 'two' },
    { packets: [packet('p0'), packet('p1', 'refunded')], transfers: [transfer('t1', 'confirmed')], nextCursor: 'new-first' },
    { packets: [packet('p3')], transfers: [], nextCursor: null },
    { packets: [packet('p0', 'exhausted')], transfers: [], nextCursor: 'first-again' },
  ];
  service.api.request = async () => pages.shift();
  await service.wallet.team('a'); await service.wallet.team('a', 'one'); await service.wallet.team('a');
  assert.deepEqual(service.state.chainTeam.packets.map(row => row.packet.id), ['p0', 'p1', 'p2']);
  assert.equal(service.state.chainTeam.packets[1].packet.status, 'refunded');
  assert.deepEqual(service.state.chainTeam.transfers, [transfer('t1', 'confirmed'), transfer('t2')]);
  assert.equal(service.state.chainTeam.nextCursor, 'two');
  await service.wallet.team('a', 'two'); await service.wallet.team('a');
  assert.equal(service.state.chainTeam.nextCursor, null);
  assert.deepEqual(service.state.chainTeam.packets.map(row => row.packet.id), ['p0', 'p1', 'p2', 'p3']);
  assert.equal(service.state.chainTeam.packets[0].packet.status, 'exhausted');
});

test('late team feed responses cannot overwrite a different team or a changed selection', async () => {
  const service = runtime(), gate = Promise.withResolvers(), entered = Promise.withResolvers();
  service.state.preferences.current = 'a';
  service.api.request = async (_endpoint, options) => {
    if (options.params.id === 'a') { entered.resolve(); return gate.promise; }
    return { packets: [], transfers: [{ id: 'b' }], nextCursor: null };
  };
  const pending = service.wallet.team('a'); await entered.promise;
  service.state.preferences.current = 'b'; await service.wallet.team('b');
  gate.resolve({ packets: [], transfers: [{ id: 'a' }], nextCursor: 'a' }); await pending;
  assert.equal(service.state.chainTeam.teamId, 'b'); assert.deepEqual(service.state.chainTeam.transfers, [{ id: 'b' }]);
  const stale = Promise.withResolvers(), started = Promise.withResolvers();
  service.api.request = async () => { started.resolve(); return stale.promise; };
  const refreshing = service.wallet.team('b'); await started.promise;
  service.state.preferences.current = 'c';
  stale.resolve({ packets: [], transfers: [{ id: 'stale' }], nextCursor: 'stale' }); await refreshing;
  assert.deepEqual(service.state.chainTeam.transfers, [{ id: 'b' }]);
});

test('same-team pagination and refresh serialize so updated statuses win', async () => {
  const service = runtime(), gate = Promise.withResolvers(), entered = Promise.withResolvers();
  service.state.preferences.current = 'a';
  service.state.chainTeam = { teamId: 'a', packets: [], transfers: [{ id: 'old', status: 'submitted' }], nextCursor: 'one' };
  let calls = 0;
  service.api.request = async () => {
    calls++;
    if (calls === 1) { entered.resolve(); return gate.promise; }
    return { packets: [], transfers: [{ id: 'old', status: 'confirmed' }], nextCursor: 'first' };
  };
  const page = service.wallet.team('a', 'one'); await entered.promise;
  const refresh = service.wallet.team('a'); await Promise.resolve(); assert.equal(calls, 1);
  gate.resolve({ packets: [], transfers: [{ id: 'history', status: 'confirmed' }], nextCursor: 'two' });
  await Promise.all([page, refresh]);
  assert.deepEqual(service.state.chainTeam.transfers, [{ id: 'old', status: 'confirmed' }, { id: 'history', status: 'confirmed' }]);
  assert.equal(service.state.chainTeam.nextCursor, 'two');
});

test('room wallet reads reject late keys, same-key refreshes, changed rooms and ended sessions', async () => {
  const service = runtime(), pending = [];
  service.state.rooms.current = { key: 'a', messages: [], faces: [], count: 0 };
  service.api.request = async () => { const gate = Promise.withResolvers(); pending.push(gate); return gate.promise; };
  const first = service.wallet.room('a'), second = service.wallet.room('b');
  pending[1].resolve({ packets: ['new'] }); await second;
  pending[0].resolve({ packets: ['old'] }); await first;
  assert.equal(service.state.chainRoom.key, 'b');
  const older = service.wallet.room('b'), newer = service.wallet.room('b');
  pending[3].resolve({ packets: ['newer'] }); await newer;
  pending[2].resolve({ packets: ['older'] }); await older;
  assert.deepEqual(service.state.chainRoom.packets, ['newer']);
  const switched = service.wallet.room('a'); service.state.rooms.current = { key: 'c', messages: [], faces: [], count: 0 };
  pending[4].resolve({ packets: ['switched'] }); await switched;
  assert.deepEqual(service.state.chainRoom.packets, ['newer']);
  const ended = service.wallet.room('c'); service.auth.generation++;
  pending[5].resolve({ packets: ['ended'] }); await assert.rejects(ended);
  assert.deepEqual(service.state.chainRoom.packets, ['newer']);
});

function tipRuntime() {
  const service = runtime();
  service.wallet.start = async () => ({ async handleEvent() {} });
  service.wallet.accountId = 'self';
  service.state.data.people = [{ id: 'self' }, { id: 'peer' }, { id: 'other' }];
  return service;
}

test('tip refresh cannot overwrite a changed room', async () => {
  const service = tipRuntime(), roomGate = Promise.withResolvers(), calls = [];
  service.state.rooms.current = { key: 'a', messages: [], faces: [], count: 0 };
  service.rooms.append({ id: 'm', key: 'a', text: 'old', author: { id: 'peer' }, createdAt: 1 }); service.emit();
  service.api.request = async (endpoint, options) => {
    calls.push([endpoint, options]);
    if (endpoint === 'rooms.messages') return roomGate.promise;
    assert.equal(endpoint, 'chain.room'); return { packets: [] };
  };
  const event = service.wallet.event({ type: 'tip', roomKey: 'a', groupId: 'group' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  service.state.rooms.current = { key: 'b', messages: [], faces: [], count: 0 };
  service.rooms.append({ id: 'm', key: 'b', text: 'new room', author: { id: 'peer' }, createdAt: 1 }); service.emit();
  roomGate.resolve({ messages: [{ id: 'm', key: 'a', text: 'old room response', author: { id: 'peer' }, createdAt: 1 }] }); await event;
  assert.equal(service.state.rooms.current.messages[0].text, 'new room');
  assert.equal(calls.filter(([endpoint]) => endpoint === 'chain.person').length, 0);
  service.state.rooms.current = undefined; calls.length = 0;
  await service.wallet.event({ type: 'tip', roomKey: 'a', groupId: 'group' });
  assert.deepEqual(calls, []);
});

test('new tip event wins over late room-message responses', async () => {
  const service = tipRuntime(), pending = new Map();
  service.state.rooms.current = { key: 'a', messages: [], faces: [], count: 0 };
  service.rooms.append({ id: 'm', key: 'a', text: 'initial', author: { id: 'self' }, createdAt: 1 }); service.emit();
  service.api.request = async endpoint => {
    if (endpoint === 'chain.room') return { packets: [] };
    const gate = Promise.withResolvers(); const list = pending.get(endpoint) ?? []; list.push(gate); pending.set(endpoint, list); return gate.promise;
  };
  const first = service.wallet.event({ type: 'tip', roomKey: 'a', groupId: 'group' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const second = service.wallet.event({ type: 'tip', roomKey: 'a', groupId: 'group' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const resolve = (index, text) => {
    pending.get('rooms.messages')[index].resolve({ messages: [{ id: 'm', key: 'a', text, author: { id: 'self' }, createdAt: 1 }] });
  };
  resolve(1, 'new'); await second; resolve(0, 'old'); await first;
  assert.equal(service.state.rooms.current.messages[0].text, 'new');
  service.rooms.append({ id: 'next', key: 'a', text: 'next', author: { id: 'peer' }, createdAt: 2 }); service.emit();
  assert.equal(service.state.rooms.current.messages.find(message => message.id === 'm').text, 'new');
  const ended = service.wallet.event({ type: 'tip', roomKey: 'a', groupId: 'group' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  service.auth.generation++; resolve(2, 'ended'); await assert.rejects(ended);
});

test('idle maintenance ticks produce zero emits, revisions and patches', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 100_000 });
  const service = runtime();
  await service.initialise();
  service.state.data.messages = Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, teamId: 'team', author: 'peer', text: 'x'.repeat(100), timestamp: i, expiresAt: 200_000 }));
  service.state.data.people = [{ id: 'peer' }];
  service.emit();
  const cache = createPatchSliceCache();
  let sent = service.state, emits = 0, bytes = 0;
  diffState(undefined, sent, cache);
  service.subscribe(next => { emits++; bytes += Buffer.byteLength(JSON.stringify(diffState(sent, next, cache))); sent = next; });
  const revision = service.state.revision;
  const prune = t.mock.method(service.rooms, 'prune');
  for (let i = 0; i < 6; i++) { t.mock.timers.tick(5000); await Promise.resolve(); }
  t.diagnostic(JSON.stringify({ scenario: 'idle-six-ticks', emits, bytes }));
  assert.equal(emits, 0);
  assert.equal(bytes, 0);
  assert.equal(service.state.revision, revision);
  assert.equal(prune.mock.callCount(), 0);
});

test('viewing expiry preserves identities until the nearest deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const service = runtime();
  service.state.preferences.current = 'team';
  service.state.data.people = [{ id: 'peer' }];
  service.sharing.peerViewing.set('peer', { view: { id: 'view' }, teamId: 'team', expiresAt: 112_345 });
  service.sharing.expireViewing();
  const people = service.state.data.people, revision = service.state.revision;
  service.sharing.expireViewing();
  assert.equal(service.state.data.people, people);
  assert.equal(service.state.revision, revision);
  t.mock.timers.tick(12_344);
  assert.equal(service.state.data.people[0].viewing, 'view');
  t.mock.timers.tick(1);
  assert.equal(service.state.data.people[0].viewing, undefined);
  assert.equal(service.state.revision, revision + 1);
});

test('equal emits retain the revision and skip derived room work', () => {
  const service = runtime();
  service.emit();
  const prune = test.mock.method(service.rooms, 'prune');
  const revision = service.state.revision;
  service.emit();
  assert.equal(service.state.revision, revision);
  assert.equal(prune.mock.callCount(), 0);
  prune.mock.restore();
});

test('Hot subscriptions protect stale results until the last panel releases them', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100_000 });
  const service = runtime(); service.auth.session = { account: { id: 'self' }, token: 'token' };
  let requests = 0; service.api.request = async () => { requests++; throw Error('offline'); };
  service.state.rooms.hot = { '': { top: [], rising: [], at: Date.now() } };
  service.emit();
  void service.rooms.watchHot({ sourceId: 'one:hot', chain: null }).catch(() => {}); void service.rooms.watchHot({ sourceId: 'two:hot', chain: null }).catch(() => {});
  const revision = service.state.revision;
  t.mock.timers.tick(600_000); await Promise.resolve(); service.emit();
  assert.ok(service.state.rooms.hot); assert.equal(service.state.revision, revision);
  service.rooms.watchHot({ sourceId: 'one:hot' }); assert.ok(service.state.rooms.hot);
  service.rooms.dropPanel('two'); assert.equal(service.state.rooms.hot, undefined);
  const stopped = requests; t.mock.timers.tick(60_000); await Promise.resolve(); assert.equal(requests, stopped);
  service.rooms.reset();
});

test('empty Hot results receive an expiry deadline even when other room inputs are unchanged', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100_000 });
  const service = runtime(); service.auth.session = { account: { id: 'self' }, token: 'token' };
  service.api.request = async () => ({ top: [], rising: [], at: Date.now() });
  service.emit(); await service.rooms.hot();
  t.mock.timers.tick(599_999); service.emit(); assert.ok(service.state.rooms.hot);
  t.mock.timers.tick(1); service.emit(); assert.equal(service.state.rooms.hot, undefined);
});

test('team mutation returns a small truthy receipt and snapshot remains explicit', async () => {
  const service = runtime();
  service.initialise = async () => {};
  service.auth.session = { account: { id: 'self' } };
  service.refresh = async () => {};
  const result = await service.command({ name: 'team', payload: { teamId: 'team', name: 'Team', description: '' } });
  assert.deepEqual(result, { done: true });
  assert.equal(await service.command({ name: 'snapshot' }), service.state);
});

function receivers(t) {
  const ports = [], panels = [], calls = { resync: 0, page: 0, tab: 0, signals: 0 };
  const bg = {
    panels: new Map(),
    post(port, message) { port.receive(JSON.parse(JSON.stringify(message))); },
    browser: { runtime: { async sendMessage() { calls.resync++; } } },
    images: { clearImageSessions() {} },
    sharing: { observationPolicy() {}, sharingPolicyChanged() {} },
    roomTab: { async refresh() { calls.tab++; } },
    pages: { pagePolicyChanged() {}, restoreAllPages() {}, async routePageState() { calls.page++; }, async pushPageStatus() {} },
    signals: { async routeSignals() { calls.signals++; } },
    notifications: { notificationState() {} },
  };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  browserHost.runtime = { connect() {
    const port = { sent: [], receive() {}, disconnect() {}, onMessage: { addListener(fn) { port.receive = fn; } }, onDisconnect: { addListener() {} }, postMessage(message) {
      port.sent.push(message);
      if (message.type === 'resync') bg.post(port, { type: 'state', state: bg.state });
    } };
    ports.push(port); bg.panels.set(port, ports.length); return port;
  } };
  browserHost.windows = { async getCurrent() { return { id: ports.length }; } };
  for (let i = 0; i < 2; i++) t.after(bridge.observeState({ onState(state) { panels[i] = state; }, onDisconnect() {}, onError() {}, onLanguage() {}, onPage() {}, onCaptured() {}, onDanmaku() {} }));
  t.after(() => { if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete globalThis.window; });
  return { bg, panels, ports, calls, sync: stateSync(bg) };
}

const wire = value => JSON.parse(JSON.stringify(value));
test('two panels and background converge through random entity insertions, edits, removals and reorders', t => {
  const f = receivers(t), cache = createPatchSliceCache();
  let state = runtime().state, sent, seed = 9137, bytes = 0;
  state.rooms.current = { key: 'token:Solana:mint', messages: [], faces: [], count: 0 };
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let step = 0; step < 240; step++) {
    const target = [state.data.messages, state.data.people, state.data.views, state.data.teams, state.items.stickies, state.rooms.current.messages][random(6)];
    const index = random(target.length + 1), action = random(4);
    if (action === 0 || !target.length) target.splice(index, 0, { id: `entity-${step}`, text: `value-${step}` });
    else if (action === 1) target[random(target.length)].text = `edited-${step}`;
    else if (action === 2) target.splice(random(target.length), 1);
    else target.reverse();
    const key = ['team', 'team/one', '~two', '__proto__'][random(4)];
    if (step % 3) Object.defineProperty(state.drafts, key, { value: { revision: step, value: { text: `draft-${step}` }, updatedAt: step }, enumerable: true, configurable: true, writable: true });
    else delete state.drafts[key];
    state = { ...state, revision: step + 1 };
    const patch = wire(diffState(sent, state, cache));
    sent = state;
    bytes += Buffer.byteLength(JSON.stringify(patch));
    f.sync.acceptPatch(patch);
    assert.deepEqual(f.bg.state, wire(state));
    assert.deepEqual(f.panels, [wire(state), wire(state)]);
  }
  assert.equal(f.calls.resync, 0);
  t.diagnostic(JSON.stringify({ scenario: '240-entity-operations', bytes, patches: 240 }));
});

test('dropped background and panel revisions resync from a full snapshot', t => {
  const f = receivers(t), cache = createPatchSliceCache();
  let state = runtime().state;
  f.sync.acceptPatch(wire(diffState(undefined, state, cache)));
  const missed = { ...state, revision: 1, data: { ...state.data, messages: [{ id: 'missed' }] } };
  diffState(state, missed, cache);
  state = { ...missed, revision: 2, data: { ...missed.data, messages: [...missed.data.messages, { id: 'received' }] } };
  const patch = wire(diffState(missed, state, cache));
  f.sync.acceptPatch(patch); f.sync.acceptPatch(patch);
  assert.equal(f.calls.resync, 1);
  assert.equal(f.bg.state.revision, 0);
  const snapshot = wire(diffState(undefined, state, cache));
  t.diagnostic(JSON.stringify({ scenario: 'dropped-revision-snapshot', bytes: Buffer.byteLength(JSON.stringify(snapshot)), resyncs: f.calls.resync }));
  f.sync.acceptPatch(snapshot);
  const first = f.ports[0]; f.bg.panels.delete(first);
  let next = { ...state, revision: 3, notice: 'one' };
  f.sync.acceptPatch(wire(diffState(state, next, cache)));
  f.bg.panels.set(first, 1);
  state = next; next = { ...state, revision: 4, notice: 'two' };
  f.sync.acceptPatch(wire(diffState(state, next, cache)));
  assert.equal(first.sent.filter(message => message.type === 'resync').length, 1);
  assert.deepEqual(f.panels, [wire(next), wire(next)]);
});

test('unrelated patches do not project page content, signals or room tabs', t => {
  const f = receivers(t), cache = createPatchSliceCache(), state = runtime().state;
  f.sync.acceptPatch(wire(diffState(undefined, state, cache)));
  const calls = { ...f.calls };
  f.sync.acceptPatch(wire(diffState(state, { ...state, revision: 1, notice: 'notice' }, cache)));
  assert.deepEqual(f.calls, calls);
});

test('unread counts follow in-place read IDs, recalls, membership and expiry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const service = runtime();
  service.state.account = { id: 'self' };
  service.state.remoteTeams = [{ id: 'team', joined: true, preferences: { readIds: [] } }];
  service.state.data.teams = [{ id: 'team', unread: 0, mentions: 0 }];
  service.state.data.messages = [{ id: 'm', teamId: 'team', author: 'peer', status: 'sent', mentionIds: ['self'], expiresAt: 110_000 }];
  service.emit();
  assert.equal(service.state.data.teams[0].mentions, 1);
  service.state.remoteTeams[0].preferences.readIds.push('m'); service.emit();
  assert.equal(service.state.data.teams[0].unread, 0);
  service.state.remoteTeams[0].preferences.readIds.pop(); service.emit();
  assert.equal(service.state.data.teams[0].unread, 1);
  service.state.data.messages[0].recalled = true; service.emit();
  assert.equal(service.state.data.teams[0].mentions, 0);
  service.state.data.messages[0].recalled = false; service.emit();
  service.state.remoteTeams[0].joined = false; service.emit();
  assert.equal(service.state.data.teams[0].unread, 0);
  service.state.remoteTeams[0].joined = true; service.emit();
  assert.equal(service.state.data.teams[0].unread, 1);
  t.mock.timers.tick(10_000); service.emit();
  assert.equal(service.state.data.teams[0].unread, 0);
});

test('one message emit sends a bounded entity patch with 2000 retained messages', t => {
  const service = runtime(), cache = createPatchSliceCache();
  service.state.data.messages = Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, teamId: 'team', author: 'peer', text: 'x'.repeat(100), timestamp: i }));
  service.emit();
  let sent = service.state, emits = 0, bytes = 0;
  diffState(undefined, sent, cache);
  service.subscribe(next => { emits++; bytes += Buffer.byteLength(JSON.stringify(diffState(sent, next, cache))); sent = next; });
  service.state.data.messages.push({ id: 'added', teamId: 'team', author: 'peer', text: 'y'.repeat(100), timestamp: 2000 });
  service.emit();
  t.diagnostic(JSON.stringify({ scenario: 'append-emit-to-2000', bytes, emits }));
  assert.equal(emits, 1);
  assert.ok(bytes < 400);
});

test('room counts and notices retain message ordering and avatar projections', t => {
  const service = runtime();
  service.state.rooms.current = { key: 'token:Solana:mint', faces: [], messages: [], count: 0 };
  service.emit();
  const messages = service.state.rooms.current.messages, avatars = service.state.rooms.avatars;
  const prune = t.mock.method(service.rooms, 'prune');
  service.state.rooms.current.count++; service.emit();
  service.state.notice = 'notice'; service.emit();
  assert.equal(service.state.rooms.current.messages, messages);
  assert.equal(service.state.rooms.avatars, avatars);
  assert.equal(prune.mock.callCount(), 0);
});

test('viewing metadata updates reach subscribers when the view ID stays the same', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const service = runtime();
  service.state.preferences.current = 'team';
  service.state.data.people = [{ id: 'peer' }];
  let observed;
  service.subscribe(state => { observed = wire(state); });
  for (const name of ['Token', 'Token name']) {
    const view = { id: 'view', name };
    service.sharing.peerViewing.set('peer', { view, teamId: 'team', expiresAt: 120_000 });
    service.cache.upsertView(view); service.sharing.expireViewing();
    assert.equal(observed.data.views[0].name, name);
  }
});
