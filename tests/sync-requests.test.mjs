import { MINUTE_MS, DAY_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EventStatus } from 'matrix-js-sdk';

const stub = source => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'matrix-js-sdk') return stub(`export const createClient = options => globalThis.syncClient(options); export const EventType = {}, EventStatus = ${JSON.stringify(EventStatus)}, MsgType = {}, PendingEventOrdering = { Detached: 'detached' }, ClientEvent = { Sync: 'sync', ToDeviceEvent: 'device' }, RoomEvent = { Timeline: 'timeline' }, MatrixEventEvent = { Decrypted: 'decrypted' }; export class MatrixScheduler {}`);
    if (specifier === 'react' && context.parentURL?.endsWith('/features/palside/rooms/rooms.ts')) return stub(`export const useEffect = fn => globalThis.hotEffects.push(fn), useLayoutEffect = useEffect, useState = value => [typeof value === 'function' ? value() : value, () => {}], useSyncExternalStore = (_subscribe, snapshot) => snapshot();`);
    if (context.parentURL?.endsWith('/hot.tsx')) {
      if (specifier === 'react') return stub(`export const useEffect = fn => globalThis.hotEffects.push(fn), useId = () => globalThis.hotSource, useLayoutEffect = useEffect, useMemo = fn => fn(), useRef = value => ({ current: value }), useState = value => [typeof value === 'function' ? value() : value, () => {}];`);
      if (specifier === 'react/jsx-runtime') return stub('export const jsx = () => null, jsxs = jsx, Fragment = "fragment";');
      if (specifier === 'use-intl') return stub('export const useTranslations = () => key => key;');
      if (specifier === 'motion/react') return stub('export const AnimatePresence = null, motion = { div: null }, useReducedMotion = () => true;');
      if (specifier.endsWith('.css')) return stub('export default {};');
      if (specifier === '../assets/token-name') return stub('export const TokenName = () => null, tokenLabel = view => view.name, tokenWaiting = () => undefined;');
      if (specifier === '../assets/token-data') return stub('export const tokenStats = () => undefined, liveView = (_c, view) => view;');
      if (!['./rooms', '../../../runtime/rooms/token-sites', '@palside/design/motion'].includes(specifier) && !specifier.startsWith('@palside/shared/')) return stub('export const Check = null, ChevronDown = null, Flame = null, Layers = null, Menu = null, MenuContent = null, MenuItem = null, MenuTrigger = null, EmptyState = null, InlineFeedback = null, Count = null, CountText = null, Tooltip = null, Token = null, ChainLogo = null, Faces = null, HotSearchField = () => null, HotSearchResults = () => null, openRoom = null, roomView = null, tabRoomKey = null;');
    }
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('/hot.tsx')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
globalThis.chrome = {};
const { SessionRuntime } = await import('../apps/extension/src/runtime/account/session-lifecycle.ts');
const { TimelineRuntime } = await import('../apps/extension/src/runtime/chat/timeline.ts');
const { LocalDataRuntime } = await import('../apps/extension/src/runtime/media/cache.ts');
const { RoomService } = await import('../apps/extension/src/runtime/rooms/rooms.ts');
const { WalletRuntime } = await import('../apps/extension/src/runtime/wallet/runtime.ts');
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
const { emptyState } = await import('../apps/extension/src/runtime/composition/state.ts');
const { Api } = await import('../apps/extension/src/runtime/transport/api.ts');
const { endpointsById, pathFor } = await import('../packages/shared/src/contracts/endpoints.ts');
const { Hot } = await import('../apps/extension/src/features/palside/rooms/hot.tsx');
hooks.deregister();
delete globalThis.chrome;
const drain = async () => { for (let i = 0; i < 250; i++) await Promise.resolve(); };
const key = 'token:Solana:So11111111111111111111111111111111111111112';

function fixture(t, { teams = [], initialEvents = [], identity } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  t.mock.method(Math, 'random', () => 0);
  const account = { id: 'self', nickname: 'Self', bio: '', tags: [], avatarId: null, acceptTeamInvites: true, matrixId: '@self:test', wallet: null, revision: 0 };
  const session = { account, token: 'token', matrix: { userId: '@self:test', deviceId: 'SELF' }, storageKey: Array(32).fill(1), crypto: 'ready' };
  const calls = [], streams = [], gates = new Map(), starts = [], cachedMessages = [], eventSignals = [];
  const server = { account: structuredClone(account), teams, presence: { self: 'active' } };
  const roomServer = { count: 1 };
  globalThis.syncClient = () => {
    const handlers = new Map(); let started = false;
    const room = { oldState: {}, getLiveTimeline: () => ({ getEvents: () => started ? initialEvents : [] }) };
    return {
      initRustCrypto: async () => { if (gates.has('crypto')) await gates.get('crypto'); },
      getCrypto: () => ({ setDeviceIsolationMode() {}, userHasCrossSigningKeys: async () => true, bootstrapSecretStorage: async () => {}, getCrossSigningStatus: async () => ({ privateKeysInSecretStorage: true }), bootstrapCrossSigning: async () => {}, crossSignDevice: async () => {} }),
      getUserId: () => session.matrix.userId, getDeviceId: () => session.matrix.deviceId,
      downloadKeysForUsers: async () => ({ self_signing_keys: { [session.matrix.userId]: { keys: { signing: 'signing' } } }, device_keys: { [session.matrix.userId]: { [session.matrix.deviceId]: { signatures: { [session.matrix.userId]: { signing: 'signature' } } } } } }),
      on: (event, fn) => handlers.set(event, fn), removeListener: event => handlers.delete(event), stopClient() {}, retryImmediately() {},
      getRooms: () => initialEvents.length ? [room] : [], getRoom: () => room, getSyncState: () => started ? 'PREPARED' : null,
      startClient: async () => {
        if (gates.has('matrix')) await gates.get('matrix');
        starts.push({ teams: structuredClone(runtime.state.remoteTeams), calls: [...calls] }); started = true;
        handlers.get('sync')?.('PREPARED');
        for (const event of initialEvents) handlers.get('timeline')?.(event, room, false, false, { liveEvent: false });
      },
    };
  };
  /** The service's side of every request, whether it arrives over the live socket or HTTP. */
  async function serve(method, path, body) {
    calls.push(`${method} ${path}`);
    const values = {
      '/me': { ...server, readAt: Date.now(), serverTime: Date.now() },
      '/rooms/blocks': { people: [] }, '/team-invites': { invites: [] }, '/presence': { ok: true },
      '/rooms/hot/subscription': { subscribed: body.open },
      '/chain/wallet': null,
      '/chain/recovery': { items: [], nextCursor: null },
      '/chain/config': { enabled: false, version: 1, deployment: null, dailySponsoredLimit: 0, quickPay: { single: '250', daily: '1000' }, minimumLiquidity: '0', updatedAt: Date.now() },
      '/rooms/lease': { key: body.key, count: 1, slowUntil: 0, slowMs: 5000 },
      '/rooms/summary': { key, site: null, count: roomServer.count, faces: [] },
      '/rooms/messages': { messages: [], hasMore: false },
    };
    assert.ok(path in values, path);
    const value = path === '/me' && method === 'POST' ? body : values[path];
    if (gates.has(path)) await gates.get(path);
    return value;
  }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = init.body ? JSON.parse(new TextDecoder().decode(init.body)) : {};
    return new Response(JSON.stringify(await serve(init?.method ?? 'GET', new URL(url).pathname, body)), { headers: { 'content-type': 'application/json' } });
  });
  /** The live socket's service side: `GET /events` marks each connection; `streams` lets a test push to it or drop it. */
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    constructor() {
      calls.push('GET /events');
      this.signal = { aborted: false }; eventSignals.push(this.signal);
      streams.push({ enqueue: text => { if (this.readyState === 1) this.onmessage?.({ data: text }); }, close: () => this.drop(1006) });
      void (async () => { await gates.get('/events'); if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); })();
    }
    send(data) {
      const message = JSON.parse(data);
      if (message.type === 'auth') { this.onmessage?.({ data: JSON.stringify({ type: 'ready', serverTime: Date.now() }) }); return; }
      const endpoint = endpointsById[message.endpoint];
      void serve(endpoint.method, pathFor(endpoint, message.params ?? {}, message.query).split('?')[0], message.body ?? {})
        .then(body => ({ status: 200, body }), () => ({ status: 503, body: { error: 'SERVICE_UNAVAILABLE' } }))
        .then(reply => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify({ type: 'reply', id: message.id, ...reply }) }); });
    }
    close(code = 1000) { this.drop(code); }
    drop(code) { if (this.readyState === 3) return; this.readyState = 3; this.signal.aborted = true; this.onclose?.({ code }); }
  }
  const socket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  globalThis.WebSocket = FakeSocket;
  t.after(() => { if (socket) Object.defineProperty(globalThis, 'WebSocket', socket); else delete globalThis.WebSocket; });
  const runtime = {
    state: emptyState(), api: new Api('https://service.test'), emit() {}, initialise: async () => {}, tokens: { clear() {}, put() {}, get() {}, apply: view => view, remember: () => false }, directory: { clear() {}, show() {}, resume() {}, ensure: async () => {} }, pages: { clear() {}, resolve: async () => undefined, get() {} },
    storage: { get: async () => { if (gates.has('storage')) await gates.get('storage'); }, rows: async () => [], remove: async () => {}, put: async () => {}, cache: async () => [] },
    sharing: { restoreToggles: async () => {}, savePreferences: async () => {}, peerViewing: new Map() },
    signals: { syncClock() {}, restoreRecords() {}, async pruneRecords() { return false; } },
    cache: { expireLocalContent: async () => {}, evictCachedContent() {}, pruneMedia() {}, eventTimes: new Map(), preparedViews: new Map(), expiresAt: message => message.expiresAt, cacheMessage: async message => { cachedMessages.push(message); } },
    sending: { outgoing: new Map() }, interactions: { annotationDeletions: new Map() },
    diagnosticErrors: { record() {} },
    refresh() { return this.auth.refresh(); },
  };
  const cache = new LocalDataRuntime(runtime);
  runtime.cache.readableTeam = cache.readableTeam.bind(cache);
  runtime.state.config.websiteUrl = 'https://site.test';
  runtime.auth = new SessionRuntime(runtime); runtime.timeline = new TimelineRuntime(runtime); runtime.rooms = new RoomService(runtime); runtime.wallet = new WalletRuntime(runtime); runtime.dispatch = new RuntimeCommands(runtime);
  runtime.auth.session = session; runtime.api.token = session.token;
  const advance = async ms => { t.mock.timers.tick(ms); await drain(); };
  const counts = () => Object.fromEntries([...new Set(calls)].sort().map(path => [path, calls.filter(item => item === path).length]));
  const mark = label => { const result = counts(); t.diagnostic(`${label}: ${JSON.stringify(result)}`); calls.length = 0; return result; };
  /** A change the service committed after every read so far began. */
  const change = () => ({ scope: 'me', at: Date.now() + 1 });
  const event = async (name, data) => { streams.at(-1).enqueue(JSON.stringify({ type: 'event', event: name, data })); await drain(); };
  const mount = source => {
    globalThis.hotEffects = []; globalThis.hotSource = source;
    Hot({ chain: null, c: { data: runtime.state.data, live: { state: runtime.state, command: (name, payload) => runtime.dispatch.execute({ name, payload: { ...payload, sourceId: `${source}:` } }) } } });
    const cleanup = globalThis.hotEffects.map(fn => fn()); return () => cleanup.forEach(fn => fn?.());
  };
  t.after(async () => { runtime.auth.liveDispose?.(); runtime.rooms.reset(); runtime.wallet.reset(); await drain(); delete globalThis.syncClient; delete globalThis.hotEffects; delete globalThis.hotSource; });
  return { runtime, server, roomServer, calls, streams, eventSignals, gates, starts, cachedMessages, advance, mark, event, change, mount, connect: async () => { await runtime.rooms.panelChanged(true); await runtime.auth.connect(session, identity); await drain(); await advance(0); } };
}

test('session startup uses an injected event connector and disposes it on failure', async t => {
  const f = fixture(t); let connected = 0, disposed = 0;
  f.runtime.auth.connectLiveEvents = options => {
    connected++; assert.equal(options.token(), f.runtime.auth.session.token);
    return () => { disposed++; };
  };
  f.gates.set('crypto', Promise.resolve().then(() => { throw Error('fixture boundary'); }));
  await assert.rejects(f.connect(), /fixture boundary/);
  assert.equal(connected, 1); assert.equal(disposed, 1);
  assert.equal(f.calls.includes('GET /events'), false);
  assert.equal(f.runtime.auth.liveDispose, undefined);
});

test('session startup and a live socket reconnect each load account, blocks and invites once', async t => {
  const f = fixture(t); await f.connect();
  const startup = f.mark('sign-in including live socket open');
  f.streams.at(-1).close(); await drain(); await f.advance(1000); await f.advance(0);
  const reconnect = f.mark('live socket reconnect');
  assert.equal(startup['GET /me'], 1); assert.equal(startup['GET /rooms/blocks'], 1); assert.equal(startup['GET /team-invites'], 1);
  assert.equal(reconnect['GET /me'], 1); assert.equal(reconnect['GET /rooms/blocks'], 1); assert.equal(reconnect['GET /team-invites'], 1);
});

test('refresh and invite pushes read only their available contract domains', async t => {
  const f = fixture(t); await f.connect(); f.calls.length = 0;
  await f.event('refresh', f.change()); const me = f.mark('refresh me');
  await f.event('team-invites', { pending: 1 }); const invites = f.mark('team-invites');
  await f.event('refresh', { scope: 'blocks' }); const unsupported = f.mark('unsupported refresh scope');
  assert.deepEqual(me, { 'GET /me': 1, 'GET /rooms/blocks': 1 });
  assert.deepEqual(invites, { 'GET /team-invites': 1 }); assert.deepEqual(unsupported, {});
});

test('two Hot panels share one live subscription without polling and unsubscribe after unmount', async t => {
  const f = fixture(t); const first = f.mount('one'); await drain(); const second = f.mount('two'); await drain();
  await f.advance(30_000); await f.advance(30_000);
  const shown = f.mark('two Hot panels, 60 s'); first(); await drain(); assert.deepEqual(f.calls, []);
  second(); await drain();
  assert.deepEqual(f.mark('last Hot panel closes'), { 'POST /rooms/hot/subscription': 1 });
  await f.advance(MINUTE_MS);
  assert.deepEqual(shown, { 'POST /rooms/hot/subscription': 1 }); assert.deepEqual(f.mark('no Hot panels, 60 s'), {});
});

test('Hot subscriptions await their shared acknowledgement and propagate its failure', async t => {
  const f = fixture(t); let reject;
  f.gates.set('/rooms/hot/subscription', new Promise((_, fail) => { reject = fail; }));
  let settled = 0;
  const watch = sourceId => f.runtime.rooms.watchHot({ sourceId, open: true }).finally(() => { settled++; });
  const first = assert.rejects(watch('one:hot'), error => error.code === 'RESULT_UNKNOWN');
  const second = assert.rejects(watch('two:hot'), error => error.code === 'RESULT_UNKNOWN');
  await drain();
  assert.equal(settled, 0);
  assert.deepEqual(f.calls, ['POST /rooms/hot/subscription']);
  reject(Error('unreachable')); await Promise.all([first, second]);
  assert.equal(settled, 2);
  assert.deepEqual(f.runtime.state.rooms.hot, { rows: [], loaded: false });
});

test('Hot Retry reopens a failed shared subscription and other panels reuse it', async t => {
  const f = fixture(t); let reject;
  f.gates.set('/rooms/hot/subscription', new Promise((_, fail) => { reject = fail; }));
  const first = assert.rejects(f.runtime.rooms.watchHot({ sourceId: 'one:hot', open: true }), error => error.code === 'RESULT_UNKNOWN');
  const second = assert.rejects(f.runtime.rooms.watchHot({ sourceId: 'two:hot', open: true }), error => error.code === 'RESULT_UNKNOWN');
  reject(Error('unreachable')); await Promise.all([first, second]);
  f.gates.delete('/rooms/hot/subscription'); f.calls.length = 0;
  await f.runtime.rooms.watchHot({ sourceId: 'one:hot', open: false });
  await f.runtime.rooms.watchHot({ sourceId: 'one:hot', open: true });
  await f.runtime.rooms.watchHot({ sourceId: 'other:hot', open: true });
  assert.deepEqual(f.calls, ['POST /rooms/hot/subscription']);
  assert.deepEqual(f.runtime.state.rooms.hot, { rows: [], loaded: false });
  f.runtime.rooms.consume({ type: 'hot', rooms: { rows: [] } });
  assert.deepEqual(f.runtime.state.rooms.hot, { rows: [], loaded: true });
  f.calls.length = 0; await f.advance(MINUTE_MS); assert.deepEqual(f.calls, []);
});

test('Hot to chat to Hot renews the subscription without starting a poll', async t => {
  const f = fixture(t); const leave = f.mount('one'); await drain(); await f.advance(10_000); leave(); await drain();
  assert.equal(f.runtime.state.rooms.hot, undefined);
  await f.advance(MINUTE_MS); const leaveAgain = f.mount('one'); await drain(); await f.advance(30_000);
  assert.deepEqual(f.mark('Hot → chat → Hot'), { 'POST /rooms/hot/subscription': 3 });
  leaveAgain(); await drain(); assert.deepEqual(f.mark('Hot closes'), { 'POST /rooms/hot/subscription': 1 });
});

test('concurrent refresh invalidations merge their domains into one follow-up', async t => {
  const f = fixture(t); await f.connect(); f.calls.length = 0;
  let release; const gate = new Promise(resolve => { release = resolve; }); f.gates.set('/me', gate); f.gates.set('/team-invites', gate);
  for (let i = 0; i < 10; i++) { await f.event('refresh', f.change()); await f.event('team-invites', { pending: i }); }
  release(); await drain();
  assert.deepEqual(f.mark('concurrent me and invite invalidations'), { 'GET /me': 2, 'GET /rooms/blocks': 2, 'GET /team-invites': 1 });
});

test('push calibration, disconnect fallback and room renewal keep their deadlines', async t => {
  const f = fixture(t); f.runtime.auth.dayRefreshDelay = 0; await f.connect(); await f.runtime.rooms.tabChanged({ asset: key.slice(6) }); f.calls.length = 0;
  for (let i = 0; i < 3; i++) { await f.advance(20_000); await f.event('presence', { account: 'peer', state: 'active' }); await f.runtime.auth.maintainConnection(); await drain(); }
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 0);
  assert.equal(f.calls.filter(path => path === 'POST /rooms/lease').length, 3);
  // With the stream open only a new UTC day (after this device's spread) reads the snapshot again.
  const auth = f.runtime.auth, day = DAY_MS, at = auth.snapshotAt;
  const nextDay = (Math.floor((at - auth.dayRefreshDelay) / day) + 1) * day + auth.dayRefreshDelay;
  assert.equal(auth.snapshotStale(nextDay - 1), false);
  assert.equal(auth.snapshotStale(nextDay), true);
  // The stream drops: the snapshot it kept current is already old, so it is read at once, then every 15 s.
  f.runtime.auth.liveDispose(); f.runtime.auth.liveOpen = false; f.calls.length = 0;
  await f.runtime.auth.maintainConnection(); await drain(); assert.equal(f.calls.filter(path => path === 'GET /me').length, 1); f.calls.length = 0;
  await f.advance(14_999); await f.runtime.auth.maintainConnection(); assert.equal(f.calls.filter(path => path === 'GET /me').length, 0);
  await f.advance(1); await f.runtime.auth.maintainConnection(); await drain();
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 1);
  assert.equal(f.calls.filter(path => path === 'GET /team-invites').length, 1);
});

test('panel disconnect drops only its Hot subscription and the last panel unsubscribes', async t => {
  const f = fixture(t); f.mount('one'); await drain(); f.mount('two'); await drain(); f.calls.length = 0;
  await f.runtime.dispatch.execute({ name: 'visible-drop', payload: { panel: 'one' } }); await f.advance(30_000);
  assert.deepEqual(f.calls, []); assert.ok(f.runtime.state.rooms.hot);
  await f.runtime.dispatch.execute({ name: 'visible-drop', payload: { panel: 'two' } }); await drain();
  assert.deepEqual(f.calls, ['POST /rooms/hot/subscription']); assert.equal(f.runtime.state.rooms.hot, undefined);
  f.calls.length = 0; await f.advance(MINUTE_MS);
  assert.deepEqual(f.calls, []);
});

test('reads wait for a slow live socket: its first open carries the initial load once, a reconnect catches up', async t => {
  const f = fixture(t); let release; f.gates.set('/events', new Promise(resolve => { release = resolve; }));
  const connecting = f.connect(); await drain(); await f.advance(0);
  assert.equal(f.calls.includes('GET /me'), false, 'nothing leaves before the socket is ready');
  assert.ok(f.runtime.state.data.people.every(person => person.presence === undefined));
  release(); await connecting; await drain(); await f.advance(0);
  const opened = f.mark('slow first open');
  for (const path of ['GET /me', 'GET /rooms/blocks', 'GET /team-invites']) assert.equal(opened[path], 1, path);
  f.streams.at(-1).close(); await drain(); await f.advance(1000); await f.advance(0);
  const reconnect = f.mark('catch-up on reconnect');
  for (const path of ['GET /events', 'GET /me', 'GET /rooms/blocks', 'GET /team-invites', 'GET /chain/config']) assert.equal(reconnect[path], 1, path);
  assert.equal(f.runtime.state.data.people.find(person => person.id === 'self').presence, 'active');
});
test('refresh failure drains queued invalidations and leaves the next request usable', async t => {
  const f = fixture(t); await f.connect(); f.calls.length = 0;
  let reject; f.gates.set('/me', new Promise((_, fail) => { reject = fail; }));
  await f.event('refresh', f.change()); await f.event('refresh', f.change());
  f.gates.delete('/me'); reject(Error('unreachable')); await drain();
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 2);
  assert.equal(f.runtime.state.connection.service, 'ready'); assert.equal(f.runtime.auth.refreshing, undefined);
  await f.runtime.refresh(); assert.equal(f.calls.filter(path => path === 'GET /me').length, 3);
});

test('a server change while the live socket connects is in the first load', async t => {
  const f = fixture(t); let release; f.gates.set('/events', new Promise(resolve => { release = resolve; }));
  const connecting = f.connect(); await drain();
  f.server.account.nickname = 'Updated'; f.server.account.revision++;
  release(); await connecting;
  assert.equal(f.runtime.state.account.nickname, 'Updated');
});
test('the live socket opens before the initial request and startup reads each domain once', async t => {
  const f = fixture(t); let release; f.gates.set('crypto', new Promise(resolve => { release = resolve; }));
  const connecting = f.connect(); await drain(); await f.advance(0);
  const open = f.runtime.auth.liveOpen, calls = [...f.calls]; release(); await connecting;
  const counts = f.mark('live socket open before initial request');
  assert.equal(open, true); assert.equal(calls.includes('GET /me'), false);
  assert.equal(calls.includes('POST /me'), false);
  for (const path of ['GET /me', 'GET /rooms/blocks', 'GET /team-invites']) assert.equal(counts[path], 1, path);
});

test('an early live socket open catches up an existing room when room startup resumes', async t => {
  const f = fixture(t); await f.runtime.rooms.panelChanged(true); await f.runtime.rooms.tabChanged({ asset: key.slice(6) });
  assert.equal(f.runtime.state.rooms.current.count, 1);
  f.roomServer.count = 9; f.calls.length = 0; await f.connect();
  const counts = f.mark('existing room on early live socket open');
  assert.equal(f.runtime.state.rooms.current.count, 9);
  for (const path of ['GET /me', 'GET /rooms/blocks', 'GET /team-invites', 'GET /rooms/summary', 'GET /rooms/messages', 'POST /rooms/lease']) assert.equal(counts[path], 1, path);
});

test('invite events refresh invites only while the session and crypto client are current', async t => {
  const f = fixture(t); await f.connect(); f.calls.length = 0;
  await f.event('team-invites', { pending: 1 }); assert.deepEqual(f.calls, ['GET /team-invites']); f.calls.length = 0;
  const client = f.runtime.auth.client; f.runtime.auth.client = {};
  await f.event('team-invites', { pending: 2 }); assert.deepEqual(f.calls, []);
  f.runtime.auth.client = client; f.runtime.auth.generation++;
  await f.event('team-invites', { pending: 3 }); assert.deepEqual(f.calls, []);
});

test('initial presence is visible and a disconnected stream clears it', async t => {
  const f = fixture(t); await f.connect();
  assert.equal(f.runtime.state.data.people.find(person => person.id === 'self').presence, 'active');
  f.streams.at(-1).close(); await drain();
  assert.ok(f.runtime.state.data.people.every(person => person.presence === undefined));
});

test('a failed initial account load leaves Matrix and the event stream stopped', async t => {
  const f = fixture(t); let reject; f.gates.set('/me', new Promise((_, fail) => { reject = fail; }));
  const connecting = assert.rejects(f.connect()); await drain(); reject(Error('unreachable')); await connecting;
  assert.equal(f.runtime.auth.liveOpen, false); assert.equal(f.runtime.auth.liveDispose, undefined);
  assert.deepEqual(f.starts, []); assert.equal(f.eventSignals.length, 1); assert.equal(f.eventSignals[0].aborted, true);
});

for (const stage of ['storage', 'crypto', 'matrix']) {
  test(`connection failure during ${stage} disposes its live socket`, async t => {
    const f = fixture(t); let reject; f.gates.set(stage, new Promise((_, fail) => { reject = fail; }));
    const connecting = assert.rejects(f.connect()); await drain();
    assert.equal(f.runtime.auth.liveOpen, true); assert.equal(f.eventSignals[0].aborted, false);
    reject(Error('unreachable')); await connecting;
    assert.equal(f.eventSignals[0].aborted, true); assert.equal(f.runtime.auth.liveDispose, undefined); assert.equal(f.runtime.auth.liveOpen, false);
    await f.advance(MINUTE_MS); assert.equal(f.eventSignals.length, 1);
  });
}

test('an invalidated connection attempt disposes its stream without disposing a replacement', async t => {
  const f = fixture(t); let release; f.gates.set('storage', new Promise(resolve => { release = resolve; }));
  const connecting = assert.rejects(f.connect()); await drain();
  assert.equal(f.runtime.auth.liveOpen, true);
  f.runtime.auth.generation++;
  let disposed = false; const replacement = () => { disposed = true; }; f.runtime.auth.liveDispose = replacement;
  release(); await connecting;
  assert.equal(f.eventSignals[0].aborted, true); assert.equal(disposed, false); assert.equal(f.runtime.auth.liveDispose, replacement);
});

const initialTeam = {
  id: 'team', name: 'Team', description: '', avatarId: null, memberCount: 2, publishedAt: null, recruitmentExpiresAt: null,
  ownerId: 'peer', roomId: '!team:test', joined: true, reason: null,
  people: [{ id: 'peer', nickname: 'Peer', avatarId: null, bio: '', tags: [], matrixId: '@peer:test', wallet: null, deleted: false }],
  memberIds: ['self', 'peer'], revision: 0, retentionDays: 7, membersCanInvite: true,
  periods: [{ joinedAt: 1, leftAt: null }], preferences: { muted: false, readIds: [], revision: 0 }, requests: [], bans: [], transfer: null, inviteSuspended: false,
};
const initialEvent = {
  getRoomId: () => initialTeam.roomId, getId: () => '$initial', getTs: () => 999_000,
  isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false,
  isRedaction: () => false, isRedacted: () => false, getType: () => 'm.room.message',
  getUnsigned: () => ({}), getSender: () => '@peer:test', getContent: () => ({ msgtype: 'm.text', body: 'Initial sync message' }),
};

test('events before the initial load coalesce into its reads and preserve presence and room updates', async t => {
  const f = fixture(t, { teams: [initialTeam] }); let release; f.gates.set('storage', new Promise(resolve => { release = resolve; }));
  const connecting = f.connect(); await drain(); assert.equal(f.runtime.auth.liveOpen, true);
  await f.runtime.rooms.tabChanged({ asset: key.slice(6) });
  for (let i = 0; i < 3; i++) { await f.event('refresh', f.change()); await f.event('team-invites', { pending: i }); }
  f.server.presence.peer = 'away'; await f.event('presence', { account: 'peer', state: 'away' });
  await f.event('room', { key, type: 'count', count: 8 });
  assert.equal(f.runtime.state.rooms.summaries[key].count, 8);
  assert.equal(f.calls.includes('GET /me'), false); assert.equal(f.calls.includes('GET /team-invites'), false);
  release(); await connecting;
  const counts = f.mark('events before initial request');
  for (const path of ['GET /me', 'GET /rooms/blocks', 'GET /team-invites']) assert.equal(counts[path], 1, path);
  assert.equal(f.runtime.state.data.people.find(person => person.id === 'peer').presence, 'away');
});

test('presence during the initial snapshot survives creation of the people list without another read', async t => {
  const f = fixture(t, { teams: [initialTeam] }); let release; f.gates.set('/me', new Promise(resolve => { release = resolve; }));
  const connecting = f.connect(); await drain(); assert.equal(f.runtime.auth.liveOpen, true);
  await f.event('presence', { account: 'peer', state: 'away' }); release(); await connecting;
  assert.equal(f.runtime.state.data.people.find(person => person.id === 'peer').presence, 'away');
  assert.equal(f.runtime.state.data.people.find(person => person.id === 'self').presence, 'active');
  assert.equal(f.calls.filter(call => call === 'GET /me').length, 1); assert.equal(f.runtime.auth.snapshotPresence, undefined);
});

for (const mode of ['fresh sign-in', 'restored device']) {
  const options = () => ({ teams: [initialTeam], initialEvents: [initialEvent], ...(mode === 'fresh sign-in' ? { identity: { secretStorageKey: new Uint8Array(32) } } : {}) });
  test(`account membership and initial reads finish before Matrix starts (${mode})`, async t => {
    const f = fixture(t, options()); assert.deepEqual(f.runtime.state.remoteTeams, []);
    await f.connect(); assert.equal(f.starts.length, 1);
    assert.deepEqual(f.starts[0].teams, [initialTeam]);
    for (const path of ['GET /me', 'GET /rooms/blocks', 'GET /team-invites']) {
      assert.equal(f.starts[0].calls.filter(call => call === path).length, 1, path);
      assert.equal(f.calls.filter(call => call === path).length, 1, path);
    }
  });
  test(`initial-sync timeline events use account membership and retention (${mode})`, async t => {
    const f = fixture(t, options()); await f.connect();
    const message = f.runtime.state.data.messages.find(message => message.id === '$initial');
    assert.ok(message, 'initial-sync event is consumed');
    assert.equal(message.teamId, 'team'); assert.equal(message.author, 'peer'); assert.equal(message.text, 'Initial sync message');
    assert.equal(message.expiresAt, initialEvent.getTs() + initialTeam.retentionDays * DAY_MS);
    assert.equal(f.cachedMessages.length, 1); assert.equal(f.cachedMessages[0].id, '$initial');
  });
}

test('a failing snapshot backs off instead of being asked every maintenance tick', async t => {
  const f = fixture(t); await f.connect(); f.runtime.auth.liveDispose(); f.runtime.auth.liveOpen = false; f.calls.length = 0;
  const failMe = () => f.gates.set('/me', { then: (_resolve, reject) => reject(Error('down')) });
  await f.advance(15_000); failMe(); await assert.rejects(f.runtime.auth.maintainConnection()); assert.equal(f.calls.filter(path => path === 'GET /me').length, 1);
  // The first retry waits about 5 s (±20%); ticks before that send nothing.
  for (let i = 0; i < 3; i++) { await f.advance(1_000); failMe(); await f.runtime.auth.maintainConnection(); }
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 1);
  await f.advance(3_000); failMe(); await assert.rejects(f.runtime.auth.maintainConnection());
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 2);
  // A manual reconnect ignores the wait, and success clears it.
  f.gates.delete('/me'); await f.runtime.auth.reconnect(); await drain();
  assert.equal(f.runtime.auth.maintenanceFailures, 0); assert.equal(f.runtime.auth.maintenanceRetryAt, 0);
});

test('a refresh push already covered by a snapshot is not read again', async t => {
  const f = fixture(t); await f.connect(); f.calls.length = 0;
  const readAt = f.runtime.auth.snapshotReadAt;
  await f.event('refresh', { scope: 'me', at: readAt }); await drain();
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 0, 'the echo of a change the snapshot read after');
  // An explicit read after a mutation, with the echo arriving while it is in flight: one read, not two.
  let release; f.gates.set('/me', new Promise(resolve => { release = resolve; }));
  const reading = f.runtime.refresh(); await drain();
  await f.event('refresh', { scope: 'me', at: Date.now() }); f.gates.delete('/me'); release(); await reading; await drain();
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 1);
  await f.event('refresh', f.change()); await drain();
  assert.equal(f.calls.filter(path => path === 'GET /me').length, 2, 'a later change is read');
});
