import test from 'node:test';
import assert from 'node:assert/strict';
import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import { signals } from '../apps/extension/src/background/signals.ts';
import { defaultSignalSettings } from '../apps/extension/src/runtime/annotations/signals.ts';
import { freshPageSignals } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
import { pageScopeUrl } from '../apps/extension/src/domain/annotations/social.ts';
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
function event() { const listeners = []; return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)) }; }
function fixture({ interact = false, saved = {} } = {}) {
  let state = { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false }, account: { id: 'alice' }, preferences: { current: 'one', web: { share: true, interact: true }, hiddenStickies: [] }, toggles: { share: false, interact }, remoteTeams: [{ id: 'one', joined: true }], data: { people: [], messages: [], views: [] }, items: { danmaku: [], stickies: [] }, drafts: {}, signals: [] };
  const control = { focused: true, queued: 1, tab: { id: 1, windowId: 10, active: true, status: 'complete', url: 'https://example.com/article' } };
  const calls = [], pages = [], panels = [], local = structuredClone(saved), storageReads = [];
  const sender = { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' };
  const browser = {
    runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}`, getContexts: async () => [{}], onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event(), sendMessage: async ({ command }) => { calls.push(command); return { ok: true, value: command?.name === 'snapshot' ? state : command?.name === 'signal-send' ? { queued: control.queued } : undefined }; } },
    storage: { local: { get: async keys => { storageReads.push(keys); return { ...local }; }, set: async value => Object.assign(local, value), remove: async () => {} } },
    tabs: { query: async () => [{ ...control.tab }], get: async () => ({ ...control.tab }), onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { get: async () => ({ id: 10, focused: control.focused }), getLastFocused: async () => ({ id: 10, focused: control.focused }), onRemoved: event(), onFocusChanged: event() },
    permissions: { contains: async () => true, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
    scripting: { executeScript: async () => connect() },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} }, action: { onClicked: event() },
  };
  const grants = addBackgroundHost(browser, { origins: ['<all_urls>'] }).grantedOrigins;
  const connect = () => { const messages = []; const port = { name: 'palside/page', sender: { id: 'qa', frameId: 0, documentId: `doc-${pages.length}`, tab: { ...control.tab } }, onMessage: event(), onDisconnect: event(), postMessage: message => messages.push(message), disconnect() {} }; pages.push({ port, messages }); browser.runtime.onConnect.emit(port); return pages.at(-1); };
  startWorker(browser, { fetch: async () => ({ ok: false }) });
  const panel = { name: 'palside/panel', sender, onMessage: event(), onDisconnect: event(), postMessage: message => panels.push(message) };
  browser.runtime.onConnect.emit(panel); panel.onMessage.emit({ type: 'hello', windowId: 10 });
  const sendState = stateSender(browser);
  const update = patch => { state = { ...state, ...patch }; sendState(state); };
  update({});
  const command = (name, payload = {}) => new Promise(resolve => browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload } }, sender, resolve));
  // 网页互动 is one switch: the panel saves it, and the background follows the broadcast state.
  const toggle = async on => { update({ toggles: { ...state.toggles, interact: on } }); await wait(); await wait(); };
  const features = async patch => { update({ preferences: { ...state.preferences, interaction: { danmaku: true, signal: true, sticky: true, ...patch } } }); await wait(); };
  return { control, calls, pages, panels, local, storageReads, browser, grants, connect, update, command, toggle, features, state: () => state };
}
test('signals follow 网页互动 and their own switch; settings persist locally and panel sends cannot bypass host', async () => {
  const f = fixture(); await wait();
  assert.equal(f.pages.length, 0);
  assert.equal(f.panels.filter(m => m.type === 'page').at(-1).status.signalEnabled, false);
  await f.toggle(true);
  assert.equal(f.pages.at(-1).messages.filter(m => m.type === 'signal-config').at(-1)?.on, true);
  let status = f.panels.filter(m => m.type === 'page').at(-1).status;
  assert.equal(status.interactive, true); assert.equal(status.signalEnabled, true); assert.equal(status.stickyEnabled, true);
  await f.features({ signal: false });
  assert.equal(f.pages.at(-1).messages.filter(m => m.type === 'signal-config').at(-1)?.on, false);
  status = f.panels.filter(m => m.type === 'page').at(-1).status;
  assert.equal(status.signalEnabled, false); assert.equal(status.stickyEnabled, true); assert.equal(status.interactive, true);
  const saved = await f.command('signal-settings', { expectedAccountId: f.state().account.id, settings: { sound: true, volume: 200 } });
  assert.equal(saved.value.volume, 100); assert.equal((await f.command('signal-settings-get')).value.sound, true);
  assert.equal((await f.command('signal-send', {})).ok, false);
});
test('send and receive require focus, current page, enabled switch and permission', async () => {
  const f = fixture(); await wait(); await f.toggle(true);
  const page = f.pages.at(-1), send = () => page.port.onMessage.emit({ type: 'signal-send', kind: 'attention', target: { kind: 'page' }, requestId: crypto.randomUUID() });
  send(); await wait(); assert.equal(f.calls.filter(c => c.name === 'signal-send').length, 1);
  f.control.focused = false; send(); await wait(); assert.equal(f.calls.filter(c => c.name === 'signal-send').length, 1);
  const received = () => ({ id: crypto.randomUUID(), teamId: 'one', url: pageScopeUrl(f.control.tab.url), sentAt: Date.now(), kind: 'attention', target: { kind: 'page' }, personId: 'bob', at: Date.now() });
  f.update({ signals: [received()] }); await wait(); assert.equal(page.messages.filter(m => m.type === 'signal').length, 0);
  f.control.focused = true; f.update({ signals: [received()] }); await wait(); assert.equal(page.messages.filter(m => m.type === 'signal').length, 1);
  f.update({}); await wait(); assert.equal(page.messages.filter(m => m.type === 'signal').length, 1);
  f.grants.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] });
  send(); await wait(); assert.equal(f.calls.filter(c => c.name === 'signal-send').length, 1); assert.equal(page.messages.at(-1).type, 'off');
});
test('background guard token is offscreen-only and invalidates when the switch closes', async () => {
  const f = fixture(); await wait(); await f.toggle(true);
  let token, finish;
  const original = f.browser.runtime.sendMessage;
  f.browser.runtime.sendMessage = message => message.command?.name === 'signal-send' ? new Promise(resolve => { token = message.command.payload.hostToken; finish = resolve; }) : original(message);
  const page = f.pages.at(-1);
  page.port.onMessage.emit({ type: 'signal-send', kind: 'attention', target: { kind: 'page' }, requestId: 'guard-send' }); await wait();
  const guard = () => new Promise(resolve => f.browser.runtime.onMessage.emit({ type: 'palside/signal-current', token }, { id: 'qa', url: 'chrome-extension://qa/offscreen.html' }, resolve));
  assert.equal((await guard()).ok, true);
  let pageReply = false;
  f.browser.runtime.onMessage.emit({ type: 'palside/signal-current', token }, page.port.sender, () => { pageReply = true; });
  assert.equal(pageReply, false);
  await f.features({ signal: false }); assert.equal((await guard()).ok, false);
  finish({ ok: true, value: { queued: 1 } }); await wait();
  assert.equal(page.messages.find(m => m.type === 'signal-result' && m.requestId === 'guard-send')?.ok, false);
  assert.equal((await guard()).ok, false);
});
test('an empty relay receipt acknowledges processing without a recipient error', async () => {
  const f = fixture(); await wait(); await f.toggle(true); f.control.queued = 0;
  const page = f.pages.at(-1);
  page.port.onMessage.emit({ type: 'signal-send', kind: 'attention', target: { kind: 'page' }, requestId: 'empty-send' });
  await wait();
  const result = page.messages.find(m => m.type === 'signal-result' && m.requestId === 'empty-send');
  assert.equal(result?.ok, true);
  assert.equal(result?.error, undefined);
});
test('restart restores signals from 网页互动 alone', async () => {
  const stale = fixture(); await wait(); await wait();
  assert.equal(stale.pages.length, 0);
  assert.equal(stale.panels.filter(m => m.type === 'page').at(-1).status.signalEnabled, false);
  const f = fixture({ interact: true }); await wait(); await wait();
  assert.equal(f.pages.some(p => p.messages.some(m => m.type === 'signal-config' && m.on)), true);
  const page = f.pages.at(-1);
  f.control.tab.url = 'https://example.com/other'; page.port.sender.tab.url = f.control.tab.url;
  f.browser.tabs.onUpdated.emit(1, { url: f.control.tab.url }, f.control.tab); await wait();
  assert.equal(page.messages.at(-1).type === 'off', false);
  assert.equal(page.messages.filter(m => m.type === 'signal-config').at(-1).on, true, 'another page of the same site keeps signals');
});
test('turning 网页互动 off or switching team stops signals on every open page', async () => {
  const f = fixture({ interact: true }); await wait(); await wait();
  const first = f.pages.at(-1);
  await f.toggle(false);
  assert.equal(first.messages.at(-1).type, 'off');
  assert.equal(f.panels.filter(m => m.type === 'page').at(-1).status.signalEnabled, false);
  await f.toggle(true);
  const second = f.pages.at(-1);
  assert.notEqual(second, first);
  f.update({ preferences: { current: 'two', web: { share: true, interact: true }, hiddenStickies: [] }, toggles: { share: false, interact: false }, remoteTeams: [{ id: 'two', joined: true }] }); await wait();
  assert.equal(second.messages.at(-1).type, 'off');
  assert.equal(f.panels.filter(m => m.type === 'page').at(-1).status.signalEnabled, false);
});
test('permission loss while turning 互动 on prevents injection', async () => {
  const f = fixture(); await wait();
  let finish;
  const original = f.browser.permissions.contains, gate = new Promise(resolve => { finish = resolve; });
  f.browser.permissions.contains = options => options.origins ? gate.then(() => original(options)) : original(options);
  f.update({ toggles: { share: false, interact: true } }); await wait();
  f.grants.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] });
  f.browser.permissions.contains = original; finish(); await wait(); await wait();
  assert.equal(f.pages.length, 0);
});
test('fresh signal selection rejects snapshot, wrong team, expired and other canonical URL', () => {
  const base = { authenticated: true, account: { id: 'alice' }, remoteTeams: [{ id: 'one', joined: true }], preferences: { current: 'one' }, signals: [] };
  const item = { id: crypto.randomUUID(), teamId: 'one', url: 'https://example.com/article', sentAt: 10000, kind: 'attention', target: { kind: 'page' }, personId: 'bob', at: 10000 };
  const next = { ...base, signals: [item] };
  assert.equal(freshPageSignals(base, next, item.url, 10001).length, 1);
  assert.equal(freshPageSignals(undefined, next, item.url, 10001).length, 0);
  assert.equal(freshPageSignals(next, next, item.url, 10001).length, 0);
  assert.equal(freshPageSignals(base, next, item.url, 15000).length, 0);
  assert.equal(freshPageSignals(base, next, 'https://example.com/other', 10001).length, 0);
});


test('signal settings isolate accounts, restore after worker restart and use read-only signed-out defaults', async () => {
  const sharedKey = 'palside:signal-settings';
  const f = fixture({ saved: { [sharedKey]: { ...defaultSignalSettings, sound: true, volume: 99 } } });
  const read = async () => (await f.command('signal-settings-get')).value;
  await wait(); assert.deepEqual(await read(), defaultSignalSettings);
  const alice = (await f.command('signal-settings', { expectedAccountId: f.state().account.id, settings: { sound: true, volume: 41, size: 'lg', emoteSize: 'sm', wheelSize: 'lg', key: ['Shift'], wheel: [...defaultSignalSettings.wheel].reverse() } })).value;
  assert.deepEqual(f.local['palside:signal-settings:alice'], alice);
  f.update({ account: { id: 'bob' } });
  assert.deepEqual(await read(), defaultSignalSettings);
  const bob = (await f.command('signal-settings', { expectedAccountId: f.state().account.id, settings: { volume: 17 } })).value;
  assert.deepEqual(f.local['palside:signal-settings:bob'], bob);
  f.update({ account: { id: 'alice' } }); assert.deepEqual(await read(), alice);
  f.update({ authenticated: false }); assert.deepEqual(await read(), defaultSignalSettings);
  const before = structuredClone(f.local);
  assert.equal((await f.command('signal-settings', { expectedAccountId: f.state().account.id, settings: { sound: false } })).ok, false);
  assert.deepEqual(f.local, before);
  assert.equal(f.storageReads.flat().includes(sharedKey), false);
  const restarted = fixture({ saved: f.local }); await wait();
  assert.deepEqual((await restarted.command('signal-settings-get')).value, alice);
});

test('late signal settings reads and writes cannot replace the next account settings', async () => {
  const f = fixture(); await wait();
  const originalGet = f.browser.storage.local.get;
  const gate = Promise.withResolvers();
  f.browser.storage.local.get = keys => keys.includes('palside:signal-settings:bob') ? gate.promise : originalGet(keys);
  f.update({ account: { id: 'bob' } }); await wait();
  f.update({ account: { id: 'carol' } });
  assert.deepEqual((await f.command('signal-settings-get')).value, defaultSignalSettings);
  gate.resolve({ 'palside:signal-settings:bob': { ...defaultSignalSettings, sound: true } }); await wait();
  assert.deepEqual((await f.command('signal-settings-get')).value, defaultSignalSettings);
  const write = Promise.withResolvers(), started = Promise.withResolvers();
  const originalSet = f.browser.storage.local.set;
  f.browser.storage.local.set = async value => { if ('palside:signal-settings:carol' in value) { started.resolve(); await write.promise; } return originalSet(value); };
  const saving = f.command('signal-settings', { expectedAccountId: f.state().account.id, settings: { sound: true } }); await Promise.race([started.promise, saving.then(result => assert.fail(`Write rejected before storage: ${JSON.stringify(result)}`))]);
  f.update({ account: { id: 'alice' } }); write.resolve();
  assert.equal((await saving).ok, false);
  assert.deepEqual((await f.command('signal-settings-get')).value, defaultSignalSettings);
  assert.equal(f.local['palside:signal-settings:carol'].sound, true);
  assert.equal(f.local['palside:signal-settings:alice'], undefined);
});

test('signal settings host rejects missing and mismatched expected accounts before storage', async () => {
  const local = {}, reads = [], writes = [];
  const bg = {
    state: { authenticated: true, account: { id: 'bob' } },
    browser: { storage: { local: {
      get: async keys => { reads.push(keys); return local; },
      set: async value => { writes.push(value); Object.assign(local, value); },
    } } },
    pages: { pagePorts: new Map(), pushPageStatus: async () => {} },
  };
  const host = signals(bg);
  for (const expected of [undefined, '', 'alice']) await assert.rejects(host.changeSignalSettings({ sound: true }, expected));
  assert.equal(reads.length, 0); assert.equal(writes.length, 0);
  assert.equal((await host.changeSignalSettings({ sound: true }, 'bob')).sound, true);
  assert.equal(local['palside:signal-settings:bob'].sound, true);
  assert.equal(writes.length, 1);
});

test('signal settings host rechecks the expected account after loading and while queued', async () => {
  const read = Promise.withResolvers(), started = Promise.withResolvers(), writes = [];
  const bg = {
    state: { authenticated: true, account: { id: 'alice' } },
    browser: { storage: { local: {
      get: () => { started.resolve(); return read.promise; },
      set: async value => { writes.push(value); },
    } } },
    pages: { pagePorts: new Map(), pushPageStatus: async () => {} },
  };
  const host = signals(bg);
  const first = host.changeSignalSettings({ sound: true }, 'alice');
  const second = host.changeSignalSettings({ volume: 75 }, 'alice');
  const rejected = Promise.all([assert.rejects(first), assert.rejects(second)]);
  await started.promise;
  bg.state.account = { id: 'bob' };
  read.resolve({});
  await rejected;
  assert.deepEqual(writes, []);
});
