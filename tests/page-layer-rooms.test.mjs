import { MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addBackgroundHost, startWorker } from './helpers/background-host.mjs';
import { ROOM_REPLAY_COUNT, ROOM_REPLAY_GAP_MS, ROOM_REPLAY_WINDOW_MS } from '@palside/shared/rules/rooms';

const address = '0x39dbed3a2bd333467115de45665cc57f813c4571', other = '0x49dbed3a2bd333467115de45665cc57f813c4571';
const url = value => `https://gmgn.ai/eth/token/${value}`;
const key = value => `token:Ethereum:${value}`;
const event = () => { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } }; };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const message = (id, patch = {}) => ({ id, key: key(address), text: id, author: { id: 'bob', nickname: 'Bob', avatarId: null }, createdAt: Date.now() - 1000, ...patch });
function fixture({ messages = [], site = true, saved = {}, state: patch = {} } = {}) {
  const calls = [], opened = [], injected = [], timers = new Map(), stored = { ...saved };
  const controls = { focused: 10, tabs: [{ id: 1, windowId: 10, active: true, url: url(address), status: 'complete' }] };
  let state = { authenticated: true, account: { id: 'alice' }, connection: { service: 'ready', messaging: 'ready', networkOnline: true }, preferences: { current: '', rooms: {}, notifications: 'off' }, remoteTeams: [], data: { views: [], messages: [], people: [] }, drafts: {}, rooms: { current: { key: key(address), loading: false, messages }, blocked: [], avatars: {} }, ...patch };
  const browser = {
    runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}`, getContexts: async () => [{}], onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event(), onUpdateAvailable: event(), sendMessage: async ({ command }) => { calls.push(command); return command.name === 'snapshot' ? { ok: true, value: state } : { ok: true }; } },
    tabs: { query: async options => controls.tabs.filter(tab => (!options.active || tab.active) && (options.windowId === undefined || tab.windowId === options.windowId)), onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { getLastFocused: async () => ({ id: controls.focused, focused: true }), get: async id => ({ id, focused: controls.focused === id }), onFocusChanged: event(), onRemoved: event() },
    sidePanel: { open: async options => { opened.push(options); }, setPanelBehavior: async () => {} },
    scripting: { executeScript: async options => { injected.push(options.target.tabId); return []; } },
    permissions: { contains: async () => false, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
    storage: { local: { get: async () => stored, set: async value => Object.assign(stored, value) } },
  };
  const host = addBackgroundHost(browser, { origins: site ? ['https://gmgn.ai/*'] : [] });
  const bg = startWorker(browser, { setTimeout: (fn, delay) => { const id = { delay }; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const panels = [], pages = [];
  function panel(windowId = 10) {
    const messages = [], port = { name: 'palside/panel', sender: { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' }, onMessage: event(), onDisconnect: event(), postMessage: value => messages.push(value) };
    browser.runtime.onConnect.emit(port); port.onMessage.emit({ type: 'hello', windowId }); panels.push(port);
    return { port, messages };
  }
  function page(tab = controls.tabs[0]) {
    const messages = [], port = { name: 'palside/page', sender: { id: 'qa', frameId: 0, tab: { ...tab } }, onMessage: event(), onDisconnect: event(), postMessage: value => messages.push(value) };
    browser.runtime.onConnect.emit(port); pages.push(port); return { port, messages, flights: () => messages.filter(value => value.type === 'danmaku').flatMap(value => value.items), removed: () => messages.filter(value => value.type === 'danmaku-remove').flatMap(value => value.ids) };
  }
  function update(patch) { state = { ...state, ...patch }; bg.sync.acceptState(state); }
  function tick() { for (const [id, fn] of [...timers]) if (id.delay === ROOM_REPLAY_GAP_MS) { timers.delete(id); fn(); } }
  const primary = panel(); update({});
  return { bg, calls, opened, injected, controls, browser, host, timers, stored, primary, panel, page, update, state: () => state, tick, room: messages => update({ rooms: { ...state.rooms, current: { ...state.rooms.current, messages } } }), close: () => { for (const port of pages) port.onDisconnect.emit(); for (const port of panels) port.onDisconnect.emit(); } };
}

test('room snapshot replays only the newest lines within the window, one per gap, then new arrivals', async t => {
  const now = Date.now();
  const f = fixture({ messages: [message('expired', { createdAt: now - ROOM_REPLAY_WINDOW_MS }), ...Array.from({ length: ROOM_REPLAY_COUNT + 5 }, (_, i) => message(String(i), { createdAt: now - 1000 + i }))] }); t.after(f.close);
  const replayed = Array.from({ length: ROOM_REPLAY_COUNT }, (_, i) => String(i + 5));
  await flush(); const p = f.page(); await flush();
  assert.deepEqual(p.flights().map(item => item.id), [replayed[0]]);
  assert.equal([...f.timers.keys()].filter(id => id.delay === ROOM_REPLAY_GAP_MS).length, 1);
  f.room([...f.state().rooms.current.messages, message('live', { createdAt: now })]); await flush();
  for (let i = 0; i < ROOM_REPLAY_COUNT; i++) f.tick();
  await flush();
  assert.deepEqual(p.flights().map(item => item.id), [...replayed, 'live']);
  f.room([message('older', { createdAt: now - ROOM_REPLAY_WINDOW_MS * 2 }), ...f.state().rooms.current.messages]); await flush();
  assert.equal(p.flights().length, ROOM_REPLAY_COUNT + 1, 'loading older room pages never flies');
});

test('once per tab and token survives reconnect and token switching, expires after ten minutes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
  const f = fixture({ messages: [message('a')] }); t.after(f.close);
  await flush(); let p = f.page(); await flush(); assert.equal(p.flights().length, 1);
  p.port.onDisconnect.emit(); p = f.page(); await flush(); assert.equal(p.flights().length, 0);
  f.controls.tabs[0].url = url(other); f.browser.tabs.onUpdated.emit(1, { url: url(other) }, f.controls.tabs[0]);
  f.update({ rooms: { ...f.state().rooms, current: { key: key(other), messages: [message('b', { key: key(other) })], loading: false } } });
  p = f.page(); await flush(); assert.deepEqual(p.flights().map(item => item.id), ['b']);
  f.controls.tabs[0].url = url(address); f.browser.tabs.onUpdated.emit(1, { url: url(address) }, f.controls.tabs[0]);
  f.update({ rooms: { ...f.state().rooms, current: { key: key(address), messages: [message('a')], loading: false } } });
  p = f.page(); await flush(); assert.equal(p.flights().length, 0);
  t.mock.timers.tick(ROOM_REPLAY_WINDOW_MS);
  p.port.onDisconnect.emit(); f.room([message('recent')]); p = f.page(); await flush(); assert.deepEqual(p.flights().map(item => item.id), ['recent']);
});

test('all public-room display conditions apply independently of interaction features and team membership', async t => {
  const cases = [
    f => f.update({ preferences: { ...f.state().preferences, siteInteraction: { '*': { on: true, danmaku: false, signal: true, chart: true } } } }),
    f => f.update({ preferences: { ...f.state().preferences, siteInteraction: { 'gmgn.ai': { on: true, danmaku: false, signal: true } } } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['https://gmgn.ai/*'] }); },
    f => f.primary.port.onDisconnect.emit(),
    f => f.update({ rooms: { ...f.state().rooms, current: { key: key(other), messages: [message('wrong', { key: key(other) })] } } }),
    f => f.update({ authenticated: false }),
  ];
  for (const disable of cases) {
    const f = fixture({ messages: [message('a'), message('b')] }); t.after(f.close); await flush();
    f.update({ preferences: { ...f.state().preferences, siteInteraction: { 'gmgn.ai': { on: true, danmaku: true, signal: false } } } }); await flush();
    const p = f.page(); await flush(); assert.equal(p.flights().length, 1, 'works with no team and both interaction features off');
    await disable(f); await flush(); f.tick();
    assert.equal(p.flights().length, 1); assert.ok(p.removed().includes('a'));
  }
});

test('blocked and folded messages never fly; removal, later folding and blocking take flights down and cancel pending ones', async t => {
  const f = fixture({ messages: [message('blocked', { author: { id: 'blocked', nickname: 'Hidden' } }), message('folded', { folded: true }), message('a'), message('b'), message('c')] }); t.after(f.close);
  f.update({ rooms: { ...f.state().rooms, blocked: [{ id: 'blocked' }] } }); await flush();
  const p = f.page(); await flush(); assert.deepEqual(p.flights().map(item => item.id), ['a']);
  f.room(f.state().rooms.current.messages.filter(item => item.id !== 'a').map(item => item.id === 'b' ? { ...item, folded: true } : item)); await flush(); f.tick(); await flush();
  assert.deepEqual(p.flights().map(item => item.id), ['a', 'c']); assert.ok(p.removed().includes('a'));
  f.update({ rooms: { ...f.state().rooms, blocked: [{ id: 'bob' }] } }); await flush(); assert.ok(p.removed().includes('c'));
});

test('matching tab sources, non-token pages and click to the correct window room', async t => {
  const f = fixture({ messages: [message('a')] }); t.after(f.close); await flush();
  f.controls.tabs.push({ ...f.controls.tabs[0], id: 2, windowId: 20, url: url(other) });
  const secondPanel = f.panel(20); const wrong = f.page(f.controls.tabs[1]); const p = f.page(); await flush();
  assert.equal(wrong.flights().length, 0); assert.equal(p.flights().length, 1);
  p.port.onMessage.emit({ type: 'open-room', key: key(other) }); await flush(); assert.equal(f.opened.length, 0);
  p.port.onMessage.emit({ type: 'open-room', key: key(address) }); await flush();
  assert.deepEqual(f.opened, [{ windowId: 10 }]);
  assert.deepEqual(f.primary.messages.filter(item => item.type === 'open-room'), [{ type: 'open-room', key: key(address) }]);
  assert.equal(secondPanel.messages.some(item => item.type === 'open-room'), false);
  f.controls.tabs[0].url = 'https://gmgn.ai/'; f.browser.tabs.onUpdated.emit(1, { url: f.controls.tabs[0].url }, f.controls.tabs[0]); await flush();
  assert.ok(p.removed().includes('a')); const ordinary = f.page(); await flush(); assert.equal(ordinary.flights().length, 0);
});

test('room-tab follows the most recently focused panel window, emits null on non-token pages, rejects panel forgery', async t => {
  const f = fixture(); t.after(f.close); await flush();
  const tabs = () => f.calls.filter(command => command.name === 'room-tab').map(command => command.payload);
  // room-tab carries the token and the registry site only: never a name or an icon.
  assert.deepEqual(tabs().at(-1), { asset: `Ethereum:${address}`, site: 'gmgn', windowId: 10 });
  f.controls.tabs.push({ ...f.controls.tabs[0], id: 2, windowId: 20, url: url(other) });
  // Opening the side panel in a window is working in it: 弹幕 follows that window at once.
  f.panel(20); await flush(); assert.deepEqual([tabs().at(-1).asset, tabs().at(-1).windowId], [`Ethereum:${other}`, 20]);
  f.controls.focused = 10; f.browser.windows.onFocusChanged.emit(10); await flush(); assert.equal(tabs().at(-1).asset, `Ethereum:${address}`);
  f.controls.focused = 20; f.browser.windows.onFocusChanged.emit(20); await flush(); assert.equal(tabs().at(-1).asset, `Ethereum:${other}`);
  f.controls.focused = 30; f.browser.windows.onFocusChanged.emit(30); await flush(); assert.equal(tabs().at(-1).asset, `Ethereum:${other}`);
  f.controls.tabs[1].url = 'https://gmgn.ai/'; f.browser.tabs.onUpdated.emit(2, { url: 'https://gmgn.ai/' }, f.controls.tabs[1]); await flush(); assert.deepEqual(tabs().at(-1), { asset: null, windowId: 20 });
  await assert.rejects(f.bg.commands.panelCommand({ name: 'room-tab', payload: { asset: `Ethereum:${address}` } }, f.primary.port.sender.url));
  const count = tabs().length; await f.bg.roomTab.refresh(); assert.equal(tabs().length, count);
});

test('room-tab follows a token only on an added site, and follows or drops it as Chrome grants or revokes the site', async t => {
  const f = fixture({ site: false }); t.after(f.close); await flush();
  const tabs = () => f.calls.filter(command => command.name === 'room-tab').map(({ payload: { windowId: _window, ...payload } }) => payload);
  assert.ok(tabs().length && tabs().every(payload => payload.asset === null), 'a visible address without site access never reports its token');
  f.host.grantedOrigins.add('https://gmgn.ai/*'); f.browser.permissions.onAdded.emit({ origins: ['https://gmgn.ai/*'] }); await flush();
  assert.equal(tabs().at(-1).asset, `Ethereum:${address}`);
  f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['https://gmgn.ai/*'] }); await flush();
  assert.deepEqual(tabs().at(-1), { asset: null });
});

test('enabled, density and area persist; a named view still sends room-tab only its site', async t => {
  const f = fixture({ saved: { 'palside:danmaku': { enabled: false, density: 'low', area: 50 } } }); t.after(f.close); await flush();
  assert.equal(f.primary.messages.find(item => item.type === 'danmaku').settings.enabled, false);
  await f.bg.danmaku.saveDanmakuSettings({ enabled: true, density: 'high' });
  assert.equal(f.stored['palside:danmaku'].density, 'high'); assert.equal(f.stored['palside:danmaku'].area, 50);
  f.update({ data: { ...f.state().data, views: [{ kind: 'asset', chain: 'Ethereum', address, name: 'Token', logo: 'https://evil.example/logo.png' }] } }); await flush();
  assert.deepEqual(f.calls.filter(command => command.name === 'room-tab').at(-1).payload, { asset: `Ethereum:${address}`, site: 'gmgn', windowId: 10 });
});

test('another tab gets its own replay and a missing grant or capture-only admission cannot show room flights', async t => {
  const denied = fixture({ site: false, messages: [message('hidden')] }); t.after(denied.close); await flush();
  const refused = denied.page(); await flush(); assert.equal(refused.flights().length, 0);
  const f = fixture({ messages: [message('a')] }); t.after(f.close); await flush();
  const p = f.page(); await flush();
  const tab = { ...f.controls.tabs[0], id: 2, active: false }; f.controls.tabs.push(tab);
  const otherPage = f.page(tab); await flush(); assert.equal(otherPage.flights().length, 1);
  const info = f.bg.pages.pagePorts.get(p.port); info.siteGranted = false;
  f.bg.danmaku.syncPage(p.port, info); f.room([message('a'), message('b')]); await flush();
  assert.equal(p.flights().length, 1); assert.ok(p.removed().includes('a'));
});

const packet = (patch = {}) => ({ id: 'packet', accountId: 'bob', kind: 'room', scope: key(address), status: 'active', count: 5, claimedCount: 1, amount: '5', expiresAt: Date.now() + MINUTE_MS, ...patch });
const packetFlights = p => p.flights().filter(item => item.packet);

function paymentFixture(options = {}) {
  return fixture({ ...options, state: { chainRoom: { key: key(address), packets: [packet()] }, ...options.state } });
}

test('room packets fly once each with public display fields only, and a click names only a packet this page was sent', async t => {
  const f = paymentFixture({ messages: [message('a')], state: { chainRoom: { key: key(address), packets: [packet({ privateKey: 'never-project' }), packet({ id: 'other-packet' })] } } });
  t.after(f.close); await flush(); const p = f.page(); await flush();
  assert.deepEqual(packetFlights(p).map(item => item.id), ['packet', 'other-packet']);
  assert.deepEqual(Object.keys(packetFlights(p)[0]).sort(), ['author', 'id', 'key', 'mate', 'packet', 'self', 'text', 'timestamp']);
  assert.equal(packetFlights(p)[0].author.name, 'Bob');
  for (const field of ['accountId', 'privateKey', 'amount', 'claimedCount']) assert.equal(JSON.stringify(packetFlights(p)).includes(field), false);
  const labels = p.messages.find(item => item.type === 'config').labels;
  assert.equal(labels.packetFrom, '{name}’s red packet'); assert.equal(labels.member, 'Member');
  f.update({ chainRoom: { ...f.state().chainRoom } }); await flush();
  assert.equal(packetFlights(p).length, 2, 'a packet already flown never flies again');
  p.port.onMessage.emit({ type: 'open-room', key: key(address), packet: 'packet' }); await flush();
  assert.deepEqual(f.primary.messages.filter(item => item.type === 'open-room').at(-1), { type: 'open-room', key: key(address), packet: 'packet' });
  p.port.onMessage.emit({ type: 'open-room', key: key(address), packet: 'forged' }); await flush();
  assert.deepEqual(f.primary.messages.filter(item => item.type === 'open-room').at(-1), { type: 'open-room', key: key(address) });
});

test('room packets skip wrong rooms, blocked senders and packets that cannot be grabbed, and fly when one arrives', async t => {
  const now = Date.now();
  const unavailable = [packet({ id: 'a', scope: key(other) }), packet({ id: 'b', kind: 'team' }), packet({ id: 'c', status: 'refunded' }), packet({ id: 'd', status: 'pending' }), packet({ id: 'e', claimedCount: 5 }), packet({ id: 'f', expiresAt: now }), packet({ id: 'g', accountId: 'blocked' })];
  const f = paymentFixture({ state: { chainRoom: { key: key(address), packets: unavailable } } });
  t.after(f.close); f.update({ rooms: { ...f.state().rooms, blocked: [{ id: 'blocked' }] } });
  await flush(); const p = f.page(); await flush();
  assert.deepEqual(packetFlights(p), []);
  f.update({ chainRoom: { key: key(other), packets: [packet()] } }); await flush();
  assert.deepEqual(packetFlights(p), []);
  f.update({ rooms: { ...f.state().rooms, current: { ...f.state().rooms.current, loading: true } }, chainRoom: { key: key(address), packets: [packet()] } }); await flush();
  assert.deepEqual(packetFlights(p), [], 'nothing flies while the room reloads');
  f.update({ rooms: { ...f.state().rooms, current: { ...f.state().rooms.current, loading: false } } }); await flush();
  assert.deepEqual(packetFlights(p).map(item => item.id), ['packet']);
});

test('room packet flights are taken back when the page leaves the room or loses 弹幕', async t => {
  const cases = [
    f => f.update({ preferences: { ...f.state().preferences, siteInteraction: { 'gmgn.ai': { on: true, danmaku: false, signal: true } } } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['https://gmgn.ai/*'] }); },
    f => f.update({ authenticated: false }),
    f => f.update({ rooms: { ...f.state().rooms, current: { key: key(other), messages: [], loading: true } } }),
  ];
  for (const disable of cases) {
    const f = paymentFixture(); t.after(f.close); await flush(); const p = f.page(); await flush();
    assert.equal(packetFlights(p).length, 1);
    await disable(f, p); await flush();
    assert.ok(p.removed().includes('packet'));
  }
});

test('room packets require a site grant and a matching page', async t => {
  const denied = paymentFixture({ site: false }); t.after(denied.close); await flush();
  const refused = denied.page(); await flush(); assert.equal(packetFlights(refused).length, 0);
  const f = paymentFixture(); t.after(f.close); await flush();
  f.controls.tabs.push({ ...f.controls.tabs[0], id: 2, url: url(other) });
  const wrong = f.page(f.controls.tabs[1]); await flush(); assert.equal(packetFlights(wrong).length, 0);
  const p = f.page(); await flush(); assert.equal(packetFlights(p).length, 1);
});

test('a pool page names its URL until the server finds its token, then follows the token and enables webpage danmaku', async t => {
  const f = fixture({ messages: [message('token')] }); t.after(f.close); await flush();
  const pool = `https://dexscreener.com/ethereum/${other}`;
  const tabs = () => f.calls.filter(command => command.name === 'room-tab').map(({ payload: { windowId: _window, ...payload } }) => payload);
  f.host.grantedOrigins.add('https://dexscreener.com/*');
  f.controls.tabs[0].url = pool; f.browser.tabs.onUpdated.emit(1, { url: pool }, f.controls.tabs[0]); await flush();
  assert.deepEqual(tabs().at(-1), { asset: null, page: pool });
  const denied = f.page(); await flush(); assert.equal(denied.flights().length, 0);
  const injections = f.injected.length;
  f.update({ pages: { [pool]: `Ethereum:${address}` } }); await flush();
  assert.ok(f.injected.length > injections, 'the answer restores the page even if the pinned room did not change');
  assert.deepEqual(tabs().at(-1), { asset: `Ethereum:${address}`, site: 'dexscreener' });
  const page = f.page(); await flush(); assert.deepEqual(page.flights().map(item => item.id), ['token']);
  f.update({ pages: { [pool]: null } }); await flush();
  assert.deepEqual(tabs().at(-1), { asset: null }, 'a pool with no single token is not asked again from the tab');
});
