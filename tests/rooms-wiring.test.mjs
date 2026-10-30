import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionScope } from '../apps/extension/src/runtime/account/session.ts';
import { STICKY_EVENT, teamEventContent } from '../apps/extension/src/domain/annotations/social.ts';
import { ApiError } from '../apps/extension/src/runtime/transport/api.ts';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const browserHost = {};
const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
Object.defineProperty(globalThis, 'chrome', { configurable: true, value: browserHost });
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
const { TimelineRuntime } = await import('../apps/extension/src/runtime/chat/timeline.ts');
const { LocalDataRuntime } = await import('../apps/extension/src/runtime/media/cache.ts');
const { SharingRuntime } = await import('../apps/extension/src/runtime/viewing/sharing.ts');
const { TeamInteractions } = await import('../apps/extension/src/runtime/annotations/interactions.ts');
const bridge = await import('../apps/extension/src/runtime/transport/bridge.ts');
if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
else delete globalThis.chrome;
hooks.deregister();

const key = 'token:Solana:So11111111111111111111111111111111111111112';
test('all room and invite commands route their payload to the owned service', async () => {
  const routes = [
    ['room-watch', 'watch', { id: 'panel:summary', view: key }, ['panel:summary', key]],
    ['room-panels', 'panelChanged', { connected: true }, [true]], ['room-tab', 'tabChanged', { asset: key.slice(6) }], ['room-open', 'open', { key }], ['room-close', 'close', {}, []],
    ['room-send', 'send', { text: 'hi' }, ['hi']], ['room-more', 'more', {}, []], ['room-find', 'find', { key, id: 'm' }, [key, 'm']], ['room-retract', 'retract', { id: 'm' }, ['m']], ['room-report', 'report', { id: 'm' }, ['m']],
    ['room-stance', 'stance', { key, value: 'bull' }, [key, 'bull']], ['room-summary', 'summary', { key }, [key]], ['room-people', 'people', { key }, [key]], ['room-hot', 'watchHot', { sourceId: 'panel', chain: 'Solana' }],
    ['room-block', 'block', { accountId: 'peer', blocked: true }, ['peer', true]], ['room-blocks', 'blocks', {}, []], ['room-settings', 'settings', { off: true }],
    ['invite-list', 'invites', {}, []], ['invite-options', 'inviteOptions', { accountId: 'peer' }, ['peer']], ['invite-send', 'inviteSend', { teamId: 'team', accountId: 'peer' }, ['team', 'peer']],
    ['invite-accept', 'inviteAccept', { id: 'i' }, ['i']], ['invite-ignore', 'inviteIgnore', { id: 'i' }, ['i']], ['invite-settings', 'inviteSettings', { accept: false }, [false]], ['team-invite-permission', 'invitePermission', { teamId: 'team', on: true }, ['team', true]],
  ];
  const calls = [], rooms = Object.fromEntries(routes.map(([, method]) => [method, (...args) => { calls.push({ method, args }); return 'result'; }]));
  const dispatch = new RuntimeCommands({ initialise: async () => {}, rooms });
  for (const [name, method, payload, args = [payload]] of routes) { assert.equal(await dispatch.execute({ name, payload }), 'result'); assert.deepEqual(calls.at(-1), { method, args }); }
});

test('panel bridge emits validated open-room keys, unsubscribes, ignores disconnected ports, and retains retry errors', async t => {
  const ports = [], received = [];
  const browser = { runtime: { connect() { const port = { postMessage() {}, disconnect() {}, onMessage: { addListener(fn) { port.receive = fn; } }, onDisconnect: { addListener(fn) { port.closed = fn; } } }; ports.push(port); return port; }, async sendMessage() { return { ok: false, code: 'ROOM_SLOW', retryAfterMs: 1234, text: { key: 'extension.room.slow', values: { seconds: 2 } } }; } }, windows: { async getCurrent() { return { id: 1 }; } } };
  Object.assign(browserHost, browser);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete globalThis.window; });
  const unsubscribe = bridge.onOpenRoom(value => received.push(value));
  const stop = bridge.observeState({ onDisconnect() {}, onState() {}, onError() {}, onLanguage() {}, onPage() {}, onCaptured() {}, onDanmaku() {} });
  await Promise.resolve(); ports[0].receive({ type: 'open-room', key }); ports[0].receive({ type: 'open-room', key: 'page:example.com' }); assert.deepEqual(received, [key]);
  unsubscribe(); ports[0].receive({ type: 'open-room', key }); assert.deepEqual(received, [key]);
  const unsubscribeAgain = bridge.onOpenRoom(value => received.push(value)); stop(); ports[0].receive({ type: 'open-room', key }); unsubscribeAgain(); assert.deepEqual(received, [key]);
  await assert.rejects(bridge.command('room-send', { text: 'hi' }), error => error.code === 'ROOM_SLOW' && error.retryAfterMs === 1234);
});

test('team timeline ignores unsupported event types but still caches encrypted stickies', async () => {
  const session = { account: { id: 'self' } }, writes = [], stickies = [];
  const runtime = {
    auth: { session, scope: () => sessionScope(() => true, () => Error('changed')) },
    state: { remoteTeams: [{ id: 'team', roomId: 'room', memberIds: ['peer'], people: [{ id: 'peer', matrixId: '@peer' }], periods: [{ joinedAt: 0, leftAt: null }], retentionDays: 30 }], items: { stickies: [] } },
    interactions: { upsertSticky: item => stickies.push(item) }, storage: { async cache(...args) { writes.push(args); return []; } }, cache: { evictCachedContent() {} }, emit() {},
  };
  runtime.cache = Object.assign(new LocalDataRuntime(runtime), runtime.cache);
  const timeline = new TimelineRuntime(runtime), content = teamEventContent(key.slice(6), { text: 'keep' });
  const event = type => ({ status: null, getRoomId: () => 'room', getId: () => '$id', isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false, isRedaction: () => false, isRedacted: () => false, getTs: () => Date.now(), getType: () => type, getContent: () => content, getUnsigned: () => ({}), getSender: () => '@peer' });
  await timeline.consume(event('com.palside.unknown-a')); await timeline.consume(event('com.palside.unknown-b')); assert.equal(writes.length, 0); assert.equal(stickies.length, 0);
  await timeline.consume(event(STICKY_EVENT)); assert.equal(writes.length, 1); assert.equal(writes[0][2].kind, 'stickies'); assert.equal(stickies[0].text, 'keep');
});

test('unsupported team event sends fail before encryption or persistence', async () => {
  const interactions = new TeamInteractions({ auth: { session: {} } });
  for (const kind of ['danmaku', 'unknown-kind', '']) await assert.rejects(interactions.teamEvent('team', kind, {}), error => error.text?.key === 'common.error');
});

test('invite writes reuse their durable operation key after an unknown outcome', async () => {
  const rows = new Map(), keys = [];
  const runtime = { auth: { session: { account: { id: 'self' } }, scope: () => sessionScope(() => true, () => Error('changed')) }, storage: { async get(key) { return rows.get(key); }, async put(key, _account, _kind, value) { rows.set(key, value); }, async remove(key) { rows.delete(key); } }, api: { async request(_path, options) { keys.push(options.key); if (keys.length === 1) throw new ApiError(0, { error: 'RESULT_UNKNOWN' }); return { invite: { id: 'invite' } }; } } };
  const commands = new RuntimeCommands(runtime), body = { teamId: 'team', accountId: 'peer' };
  await assert.rejects(commands.mutate('/team-invites', body), { code: 'RESULT_UNKNOWN' }); assert.equal(rows.size, 1);
  await commands.mutate('/team-invites', body); assert.equal(keys[0], keys[1]); assert.equal(rows.size, 0);
});


async function privateEvent(type, content, { encrypted = true, id = '$private', timestamp = Date.now(), failure = false } = {}) {
  const { MatrixEvent } = await import('matrix-js-sdk');
  const clear = { type, content, room_id: 'room', sender: '@peer' };
  const event = new MatrixEvent({ ...clear, event_id: id, origin_server_ts: timestamp, ...(encrypted ? { type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2' } } : {}) });
  if (encrypted) await event.attemptDecryption({ decryptEvent: async () => {
    if (failure) throw new Error('synthetic decryption failure');
    return { clearEvent: clear };
  } });
  return event;
}
function privateFixture() {
  const session = { account: { id: 'self' } }, writes = [], removed = [];
  const runtime = {
    auth: { session, scope: () => sessionScope(() => true, () => Error('changed')) },
    state: { preferences: { current: 'team' }, remoteTeams: [{ id: 'team', roomId: 'room', joined: true, memberIds: ['peer'], people: [{ id: 'peer', matrixId: '@peer' }], periods: [{ joinedAt: 0, leftAt: null }], retentionDays: 30 }], data: { messages: [], people: [{ id: 'peer' }] } },
    sending: { outgoing: new Map() },
    storage: { async remove(key) { removed.push(key); } },
    cache: { eventTimes: new Map(), expiresAt: message => message.expiresAt, async cacheMessage(message) { writes.push(structuredClone(message)); }, pruneViews() {}, evictCachedContent() {}, upsertView() {} },
    interactions: { stickyRecords: [], refreshStickies() {}, async rememberAnnotationDeletion() {} }, emit() {},
  };
  runtime.cache = Object.assign(new LocalDataRuntime(runtime), runtime.cache);
  return { runtime, timeline: new TimelineRuntime(runtime), writes, removed };
}
for (const encrypted of [false, true]) {
  test(`private chat requires SDK encryption: encrypted=${encrypted}`, async () => {
    const { runtime, timeline, writes } = privateFixture();
    await timeline.consume(await privateEvent('m.room.message', { msgtype: 'm.text', body: 'private body' }, { encrypted }));
    assert.equal(runtime.state.data.messages.length, encrypted ? 1 : 0);
    assert.equal(writes.length, encrypted ? 1 : 0);
    if (encrypted) assert.equal(runtime.state.data.messages[0].text, 'private body');
  });
  test(`private edits require SDK encryption before and after their original: encrypted=${encrypted}`, async () => {
    for (const editFirst of [false, true]) {
      const { runtime, timeline, writes } = privateFixture();
      const timestamp = Date.now();
      const original = await privateEvent('m.room.message', { msgtype: 'm.text', body: 'original' }, { timestamp });
      const edit = await privateEvent('m.room.message', { msgtype: 'm.text', body: '* edited', 'm.new_content': { msgtype: 'm.text', body: 'edited' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$private' } }, { encrypted, id: '$edit', timestamp: timestamp + 1 });
      for (const event of editFirst ? [edit, original] : [original, edit]) await timeline.consume(event);
      assert.equal(runtime.state.data.messages[0].text, encrypted ? 'edited' : 'original');
      assert.equal(timeline.edits.has('$private'), encrypted);
      assert.equal(writes.at(-1).text, encrypted ? 'edited' : 'original');
    }
  });
  test(`private viewing requires SDK encryption: encrypted=${encrypted}`, async t => {
    const { runtime } = privateFixture(), sharing = new SharingRuntime(runtime);
    runtime.state.toggles = { share: false, interact: false };
    t.after(() => clearTimeout(sharing.viewingExpiryTimer));
    const expiresAt = Date.now() + 30_000;
    sharing.activeViewing.set('peer', { teamId: 'team', order: 1, sequence: 1, expiresAt });
    const content = { teamId: 'team', order: 1, sequence: 1, expiresAt, view: { version: 1, kind: 'website', disclosure: 'page', name: 'Public page', url: 'https://example.com/guide' } };
    await sharing.consumeViewing(await privateEvent('com.palside.viewing', content, { encrypted }), runtime.auth.session);
    assert.equal(sharing.peerViewing.has('peer'), encrypted);
    assert.equal(sharing.peerViewingVersions.has('peer'), encrypted);
  });
}
test('private timeline rejects failed decryption and keeps missing-key status', async () => {
  const { runtime, timeline, writes } = privateFixture();
  await timeline.consume(await privateEvent('m.room.message', { msgtype: 'm.text', body: 'private body' }, { failure: true }));
  assert.equal(runtime.state.data.messages.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(runtime.state.history.team.missingKeys, 1);
});
test('plaintext Matrix state is ignored and plaintext redaction still removes private content', async () => {
  const { MatrixEvent } = await import('matrix-js-sdk');
  const { runtime, timeline, writes } = privateFixture();
  await timeline.consume(new MatrixEvent({ type: 'm.room.name', state_key: '', room_id: 'room', event_id: '$state', sender: '@peer', content: { name: 'Room' } }));
  assert.equal(writes.length, 0);
  await timeline.consume(await privateEvent('m.room.message', { msgtype: 'm.text', body: 'private body' }));
  await timeline.consume(new MatrixEvent({ type: 'm.room.redaction', room_id: 'room', event_id: '$redaction', sender: '@service', redacts: '$private', content: { reason: 'author' } }));
  assert.equal(runtime.state.data.messages[0].recalled, true);
  assert.equal(runtime.state.data.messages[0].text, '');
  assert.equal(writes.at(-1).text, '');
});

test('viewing rejects an undecrypted encrypted envelope containing plaintext payload fields', async t => {
  const { MatrixEvent } = await import('matrix-js-sdk');
  const { runtime } = privateFixture(), sharing = new SharingRuntime(runtime);
  t.after(() => clearTimeout(sharing.viewingExpiryTimer));
  const expiresAt = Date.now() + 30_000;
  sharing.activeViewing.set('peer', { teamId: 'team', order: 1, sequence: 1, expiresAt });
  const content = { teamId: 'team', order: 1, sequence: 1, expiresAt, view: { version: 1, kind: 'website', disclosure: 'page', name: 'Public page', url: 'https://example.com/guide' } };
  await sharing.consumeViewing(new MatrixEvent({ type: 'm.room.encrypted', sender: '@peer', content }), runtime.auth.session);
  assert.equal(sharing.peerViewing.size, 0);
  assert.equal(sharing.peerViewingVersions.size, 0);
});

test('Hot subscriptions bind to their panel document and replay after the port reconnects', async t => {
  const { commands } = await import('../apps/extension/src/background/commands.ts');
  const routed = [];
  const host = commands({ run: async command => { routed.push(command); return { ok: true }; }, sharing: {} });
  await host.panelCommand({ name: 'room-hot', payload: { chain: null, sourceId: 'other' } }, 'chrome-extension://test/sidepanel.html', 'document');
  assert.deepEqual(routed, [{ name: 'room-hot', payload: { chain: null, sourceId: 'document:hot' } }]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [], ports = [];
  Object.assign(browserHost, { runtime: {
    async sendMessage(message) { calls.push(message.command); return { ok: true }; },
    connect() { const port = { postMessage() {}, disconnect() {}, onMessage: { addListener() {} }, onDisconnect: { addListener(fn) { port.closed = fn; } } }; ports.push(port); return port; },
  }, windows: { async getCurrent() { return { id: 1 }; } } });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete globalThis.window; });
  await bridge.command('room-hot', { chain: 'Solana' });
  await bridge.command('room-watch', { id: 'summary', view: key });
  await bridge.command('room-watch', { id: 'people', view: key });
  const stop = bridge.observeState({ onState() {}, onError() {}, onLanguage() {}, onDisconnect() {}, onPage() {}, onCaptured() {}, onDanmaku() {} });
  try {
    await Promise.resolve(); await Promise.resolve(); calls.length = 0;
    ports.at(-1).closed(); t.mock.timers.tick(500); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls, [{ name: 'room-hot', payload: { chain: 'Solana' } }, { name: 'room-watch', payload: { id: 'summary', view: key } }, { name: 'room-watch', payload: { id: 'people', view: key } }]);
    await bridge.command('room-hot', {}); await bridge.command('room-watch', { id: 'summary' }); await bridge.command('room-watch', { id: 'people' }); calls.length = 0;
    ports.at(-1).closed(); t.mock.timers.tick(500); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls, []);
  } finally { stop(); await bridge.command('room-hot', {}); await bridge.command('room-watch', { id: 'summary' }); await bridge.command('room-watch', { id: 'people' }); }
});
