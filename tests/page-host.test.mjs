import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE_MS } from '@palside/shared/units';

function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map(fn => fn(...args)); } }; }
// The worker never reaches the network here: a site's icon download answers 404.
function fixture({ site = true, origins, url = 'https://example.com/', signals = [], auto = false } = {}) {
  const timers = new Map();
  const timer = (fn, delay) => { if (delay < 1000) return setTimeout(fn, delay); const id = { delay }; timers.set(id, fn); return id; };
  const clearTimer = id => { if (!timers.delete(id)) clearTimeout(id); };
  const messages = [];
  const pageMessages = [];
  let pagePort;
  let perform = async () => ({ ok: true });
  const operations = [], injections = [];
  let state = { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false }, account: { id: 'alice' }, preferences: { current: 'one', siteInteraction: { [new URL(url).hostname]: { on: auto, danmaku: true, signal: true } }, notifications: 'off', share: false }, remoteTeams: [{ id: 'one', joined: true }, { id: 'two', joined: true }], items: { danmaku: [] }, data: { views: [], messages: [], people: [] }, signalRecords: signals, drafts: {} };
  const active = { id: 1, windowId: 10, url, active: true, status: 'complete', title: 'Example' };
  const browser = {
    runtime: { id: 'qa', getURL: value => `chrome-extension://qa${value}`, getContexts: async () => [{}], sendMessage: async ({ command }) => command.name === 'snapshot' ? { ok: true, value: state } : (operations.push(command), perform(command)), onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event(), onUpdateAvailable: event() },
    tabs: { query: async options => options?.url ? [] : [{ ...active }], captureVisibleTab: async () => 'data:image/png;base64,AA==', onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { get: async id => ({ id }), onRemoved: event(), onFocusChanged: event() },
    sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
    scripting: { executeScript: async value => { injections.push(value); if (pagePort) browser.runtime.onConnect.emit(pagePort); return []; } },
    action: { onClicked: event() },
    permissions: { contains: async ({ origins } = {}) => origins ? site : false, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
  };
  const host = addBackgroundHost(browser, { origins: origins ?? (site ? ['<all_urls>'] : []) });
  startWorker(browser, { setTimeout: timer, clearTimeout: clearTimer, fetch: async () => new Response('', { status: 404 }), openPage: async url => { active.url = url; active.status = 'loading'; setTimeout(() => { active.status = 'complete'; pagePort.sender.tab.url = url; browser.tabs.onUpdated.emit(active.id, { status: 'complete' }, active); }, 10); } });
  const port = { name: 'palside/panel', sender: { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' }, onMessage: event(), onDisconnect: event(), postMessage: value => messages.push(value) };
  browser.runtime.onConnect.emit(port);
  port.onMessage.emit({ type: 'hello', windowId: 10 });
  pagePort = { name: 'palside/page', sender: { id: 'qa', documentId: 'doc-1', tab: { id: 1, windowId: 10, url }, }, onMessage: event(), onDisconnect: event(), postMessage: value => pageMessages.push(value) };
  const sendState = stateSender(browser);
  const broadcast = () => sendState(state);
  broadcast();
  const command = (name, payload = {}) => new Promise(resolve => browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload: { ...(name === 'toggle' || name === 'preferences' ? {} : { windowId: 10, teamId: 'one' }), ...payload } } }, port.sender, resolve));
  // A per-site 网页互动 change broadcasts state for the active host.
  const interact = (on = true) => { const host = new URL(active.url).hostname; state = { ...state, preferences: { ...state.preferences, siteInteraction: { ...state.preferences.siteInteraction, [host]: { ...state.preferences.siteInteraction[host], on } } } }; broadcast(); };
  const status = () => messages.filter(message => message.type === 'page').at(-1)?.status;
  return { interact, status, perform: fn => { perform = fn; }, operations, injections, browser, port, pagePort, messages, pageMessages, active, command, host, timers, state: () => state, update: patch => { state = { ...state, ...patch }; broadcast(); }, expire: () => { for (const fn of [...timers.values()]) fn(); } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function fireTimers(f, delay) {
  for (const [id, fn] of [...f.timers]) if (delay === undefined || id.delay === delay) { f.timers.delete(id); fn(); }
}

/** A real reload or navigation: the document's port goes away as Chrome reports loading. */
function documentGoes(f) {
  f.pagePort.onDisconnect.emit();
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
}

/** The page layer is live for 网页互动: its signals are on. */
const live = (messages, from = 0) => messages.slice(from).some(message => message.type === 'signal-config' && message.on);
/** A teammate's signal on an ordinary page, and a page that answers its replay at once. */
function signal(url = 'https://example.com/') { return { id: 'signal', teamId: 'one', personId: 'alice', url, kind: 'danger', target: { kind: 'page' }, timestamp: 1, expiresAt: Date.now() + MINUTE_MS }; }
function answers(f) {
  const post = f.pagePort.postMessage;
  f.pagePort.postMessage = value => { post(value); if (value.type === 'signal-replay') setImmediate(() => f.pagePort.onMessage.emit({ type: 'located', requestId: value.requestId, result: 'shown' })); };
}

test('one-off signal replay keeps its page until its lease expires', async () => {
  const f = fixture({ signals: [signal()] });
  answers(f);
  assert.equal((await f.command('signal-replay', { recordId: 'signal' })).value.result, 'shown');
  assert.equal(f.pageMessages.some(value => value.type === 'off'), false);
  fireTimers(f, 4500); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.status().connected, false);
});

test('网页互动 toggles the page layer and its signals', async () => {
  const f = fixture(); await flush(); await flush(); await flush();
  assert.equal(f.status().signalEnabled, false); assert.equal(f.status().interactive, false);
  assert.equal(live(f.pageMessages), false);
  f.interact(true); await flush(); await flush(); await flush();
  assert.equal(f.status().signalEnabled, true); assert.equal(f.status().interactive, true);
  assert.equal(live(f.pageMessages), true);
  f.interact(false); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.status().signalEnabled, false); assert.equal(f.status().interactive, false); assert.equal('interact' in f.status(), false);
});

test('worker restart restores 网页互动 for every page of a granted site', async () => {
  const stale = fixture(); await flush(); await flush(); await flush();
  assert.equal(stale.injections.length, 0);
  assert.equal(stale.status().signalEnabled, false);
  const restored = fixture({ auto: true }); await flush(); await flush(); await flush();
  assert.equal(restored.status().signalEnabled, true);
  const other = fixture({ auto: true, url: 'https://example.com/other' }); await flush(); await flush(); await flush();
  assert.ok(other.injections.length > 0);
  assert.equal(other.status().signalEnabled, true);
  restored.update({ account: { id: 'bob' }, preferences: { ...restored.state().preferences, siteInteraction: { ...restored.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } }); await flush(); await flush();
  assert.equal(restored.pageMessages.at(-1).type, 'off');
  assert.equal(restored.status().signalEnabled, false);
});

test('delayed 互动 activation cannot inject a replacement page on a site without a grant', async () => {
  const f = fixture({ site: false, origins: ['https://example.com/*'] }); await flush(); await flush();
  let release; const contains = f.browser.permissions.contains;
  const gate = new Promise(resolve => { release = resolve; });
  f.browser.permissions.contains = async value => { if (value.origins) await gate; return contains(value); };
  f.interact(true); await flush();
  f.active.url = 'https://other.example.com/replaced';
  f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active);
  f.browser.permissions.contains = contains; release();
  await flush(); await flush(); await flush();
  assert.equal(f.injections.length, 0);
  assert.equal(live(f.pageMessages), false);
});
test('网页互动 turned off stays off through same URL reload', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  f.interact(false); await flush(); await flush();
  const before = f.pageMessages.length, count = f.injections.length;
  documentGoes(f);
  f.pagePort.sender.documentId = 'disabled-reload';
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(live(f.pageMessages, before), false);
  assert.equal(f.status().signalEnabled, false);
});
test('a same-document history change keeps the live page layer, unlike a document that goes away', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  const before = f.pageMessages.length, count = f.injections.length;
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.equal(f.pageMessages.slice(before).some(message => message.type === 'off' || message.type === 'clear'), false);
  assert.equal(f.injections.length, count);
  assert.equal(f.status().connected, true);
  documentGoes(f);
  f.pagePort.sender.documentId = 'doc-reloaded';
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.ok(f.injections.length > count);
});

test('switching team clears ongoing page content and navigation stops temporary pages', async () => {
  const f = fixture({ auto: true });
  await flush(); await flush(); await flush();
  f.update({ preferences: { ...f.state().preferences, current: 'two' } });
  assert.ok(f.pageMessages.some(message => message.type === 'clear'));
  assert.equal(f.pageMessages.at(-1).type, 'off');
  f.pagePort.onMessage.emit({ type: 'url', url: 'https://example.com/another' });
  assert.equal(f.pageMessages.at(-1).type, 'off');
});

test('revoking page access stops a one-off ordinary page', async () => {
  const f = fixture({ auto: true });
  await flush(); await flush(); await flush();
  f.host.grantedOrigins.clear();
  f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] });
  await flush(); await flush();
  assert.ok(f.pageMessages.some(message => message.type === 'off'));
});

test('same-URL refresh re-injects a 网页互动 page', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  const count = f.injections.length, before = f.pageMessages.length;
  documentGoes(f);
  f.pagePort.sender.documentId = 'doc-reloaded';
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.ok(f.injections.length > count);
  assert.equal(live(f.pageMessages, before), true);
});

test('cold worker opens the page layer only when 网页互动 is on for that granted site', async () => {
  for (const scenario of [{ auto: true, on: true }, { on: false }, { auto: true, site: false, on: false }]) {
    const f = fixture(scenario); await flush(); await flush(); await flush();
    assert.equal(f.injections.length > 0, scenario.on);
    assert.equal(live(f.pageMessages), scenario.on);
  }
});
test('replaying a token signal stays on any route of the same token page and opens its original URL from another site', async () => {
  const source = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112';
  for (const url of [`${source}?tab=holders`, 'https://example.com/']) {
    const f = fixture({ url, signals: [signal(source)] });
    answers(f);
    assert.equal((await f.command('signal-replay', { recordId: 'signal' })).value.result, 'shown');
    assert.equal(f.active.url, url.startsWith(source) ? url : source);
    fireTimers(f, 4500);
  }
});

test('replaying an ordinary-page signal opens its source, waits for load, and shows it once', async () => {
  const f = fixture({ signals: [signal()], url: 'https://example.com/elsewhere' });
  answers(f);
  const result = await f.command('signal-replay', { accountId: 'alice', recordId: 'signal' });
  assert.equal(result.ok, true); assert.equal(result.value.result, 'shown');
  assert.equal(f.active.url, 'https://example.com/'); assert.equal(f.active.status, 'complete');
  assert.equal(f.pageMessages.filter(message => message.type === 'signal-replay').length, 1);
  // Replaying is one-off: it does not turn 互动 on for the page.
  assert.equal(live(f.pageMessages), false);
  assert.equal(f.status().interactive, false); assert.equal(f.status().signalEnabled, false);
  assert.equal(f.state().preferences.siteInteraction['example.com'].on, false);
});

test('an SPA page reporting its new URL gets its signal settings again', async () => {
  const f = fixture({ auto: true, url: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' });
  await flush(); await flush(); await flush();
  const url = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111113';
  f.active.url = url; f.pagePort.sender.tab.url = url;
  f.browser.tabs.onUpdated.emit(1, { url }, f.active); await flush(); await flush();
  const before = f.pageMessages.length;
  f.pagePort.onMessage.emit({ type: 'url', url }); await flush(); await flush();
  assert.equal(live(f.pageMessages, before), true);
});

test('a host granted for both protocols registers both without opting into sharing, including HTTP pages', async () => {
  for (const scheme of ['http', 'https']) {
    const f = fixture({ auto: true, origins: ['*://custom.example.com/*'], url: `${scheme}://custom.example.com/article` });
    await flush(); await flush(); await flush();
    assert.deepEqual(Array.from(f.host.calls.register.at(-1)[0].matches), ['http://custom.example.com/*', 'https://custom.example.com/*']);
    assert.ok(f.pageMessages.some(message => message.type === 'config'));
    assert.equal(live(f.pageMessages), true);
    assert.equal(f.state().preferences.share, false);
    assert.equal(f.operations.some(command => command.name === 'preferences'), false);
  }
});

test('automatic pages open live; turning 网页互动 off stops the page', async () => {
  const f = fixture({ auto: true });
  await flush(); await flush(); await flush();
  assert.ok(f.pageMessages.some(message => message.type === 'config'));
  assert.equal(live(f.pageMessages), true);
  f.update({ preferences: { ...f.state().preferences, share: true, siteInteraction: { ...f.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } });
  await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  const count = f.injections.length;
  documentGoes(f);
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(f.host.calls.unregister.at(-1).ids[0], 'palside-page');
});

test('turning 网页互动 off tears down its open page at once and keeps it off after refresh', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  const before = f.pageMessages.length;
  f.perform(async command => { if (command.name === 'preferences') f.interact(command.payload.siteInteraction['example.com'].on); return { ok: true }; });
  assert.equal((await f.command('preferences', { accountId: 'alice', siteInteraction: { 'example.com': { on: false, danmaku: true, signal: true } } })).ok, true);
  await flush(); await flush();
  assert.ok(f.pageMessages.slice(before).some(message => message.type === 'off'));
  assert.equal(f.status().interactive, false); assert.equal(f.status().connected, false);
  const count = f.injections.length;
  documentGoes(f);
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(f.state().preferences.siteInteraction['example.com'].on, false);
});

test('turning 网页互动 on connects its open page immediately and the panel status follows', async () => {
  const f = fixture(); await flush(); await flush();
  f.perform(async command => { if (command.name === 'preferences') f.interact(command.payload.siteInteraction['example.com'].on); return { ok: true }; });
  assert.equal((await f.command('preferences', { accountId: 'alice', siteInteraction: { 'example.com': { on: true, danmaku: true, signal: true } } })).ok, true);
  await flush(); await flush(); await flush();
  assert.ok(f.injections.length > 0);
  assert.equal(live(f.pageMessages), true);
  const status = f.status();
  assert.equal(status.interactive, true); assert.equal(status.connected, true); assert.equal(status.signalEnabled, true);
});

test('automatic registration cannot finish stale after site disable, revoke, logout, or account change', async () => {
  for (const change of [
    f => f.update({ preferences: { ...f.state().preferences, siteInteraction: { ...f.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
    f => f.update({ authenticated: false }),
    f => f.update({ account: { id: 'bob' }, preferences: { ...f.state().preferences, siteInteraction: { ...f.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } }),
    f => f.update({ preferences: { ...f.state().preferences, current: 'missing' } }),
  ]) {
    const f = fixture({ origins: ['https://example.com/*'] }); await flush(); await flush();
    let finish; const registrations = new Map();
    f.browser.scripting.registerContentScripts = scripts => new Promise(resolve => { finish = () => { for (const script of scripts) registrations.set(script.id, script); resolve(); }; });
    f.browser.scripting.unregisterContentScripts = async ({ ids }) => { for (const id of ids) registrations.delete(id); };
    f.interact(true);
    await flush(); assert.equal(typeof finish, 'function');
    change(f); const injections = f.injections.length;
    finish(); await flush(); await flush(); await flush();
    assert.equal(registrations.size, 0);
    assert.equal(f.injections.length, injections);
    f.browser.runtime.onConnect.emit(f.pagePort); await flush(); await flush();
    assert.equal(f.pageMessages.at(-1).type, 'off');
  }
});

test('registration failure preserves the site setting and a later site change retries registration', async () => {
  const f = fixture({ origins: ['https://example.com/*'] }); await flush(); await flush();
  f.perform(async command => { if (command.name === 'preferences') f.interact(command.payload.siteInteraction['example.com'].on); return { ok: true }; });
  let attempts = 0;
  f.browser.scripting.registerContentScripts = async () => { attempts++; throw new Error('registration failed'); };
  const failed = await f.command('preferences', { accountId: 'alice', siteInteraction: { 'example.com': { on: true, danmaku: true, signal: true } } });
  assert.equal(failed.ok, true);
  await flush(); await flush();
  assert.equal(attempts, 1);
  assert.equal(f.state().preferences.siteInteraction['example.com'].on, true);
  const registered = [];
  f.browser.scripting.registerContentScripts = async scripts => { registered.push(...scripts); };
  f.interact(false); await flush();
  f.interact(true); await flush();
  await flush(); await flush(); await flush();
  assert.deepEqual(Array.from(registered.at(-1).matches), ['https://example.com/*']);
});

test('automatic page admission and SPA navigation honor exact host grants with no fixed-site exceptions', async () => {
  const f = fixture({ auto: true, site: false, origins: ['https://custom.example.com/*'], url: 'https://custom.example.com/a' });
  await flush(); await flush(); await flush();
  const url = 'https://custom.example.com/b';
  f.active.url = url; f.pagePort.sender.tab.url = url;
  f.browser.tabs.onUpdated.emit(1, { url }, f.active); await flush();
  assert.equal(live(f.pageMessages), true);
  assert.equal(f.pageMessages.at(-1).type === 'off', false);
  const other = 'https://sub.custom.example.com/b';
  f.active.url = other; f.pagePort.sender.tab.url = other;
  f.browser.tabs.onUpdated.emit(1, { url: other }, f.active); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  for (const denied of ['https://sub.custom.example.com/', 'https://gmgn.ai/']) {
    f.pagePort.sender.tab.url = denied; f.active.url = denied;
    f.browser.runtime.onConnect.emit(f.pagePort); await flush(); await flush();
    assert.equal(f.pageMessages.at(-1).type, 'off');
  }
});

test('granting page access does not modify either persistent switch', async () => {
  const f = fixture({ site: false }); await flush();
  f.host.grantedOrigins.add('<all_urls>');
  f.browser.permissions.onAdded.emit({ origins: ['<all_urls>'] });
  await flush(); await flush();
  assert.equal(f.operations.some(command => command.name === 'preferences'), false);
  assert.equal(f.injections.length, 0);
  assert.equal(f.state().preferences.share, false); assert.equal(f.state().preferences.siteInteraction['example.com'].on, false);
});

test('delayed page admission cannot bind a revoked, disabled or navigated document', async () => {
  for (const change of [
    f => f.update({ preferences: { ...f.state().preferences, siteInteraction: { ...f.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
    f => { f.active.url = 'https://other.example.com/'; f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active); },
    f => { documentGoes(f); f.active.status = 'complete'; },
    f => f.update({ authenticated: false }),
    f => f.update({ account: { id: 'bob' }, preferences: { ...f.state().preferences, siteInteraction: { ...f.state().preferences.siteInteraction, 'example.com': { on: false, danmaku: true, signal: true } } } }),
  ]) {
    const f = fixture({ auto: true }); await flush(); await flush(); await flush();
    f.pagePort.onDisconnect.emit();
    const before = f.pageMessages.length, contains = f.browser.permissions.contains;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    f.browser.permissions.contains = async request => { const result = await contains(request); await gate; return result; };
    f.browser.runtime.onConnect.emit(f.pagePort);
    await flush(); change(f); release(); await flush(); await flush(); await flush();
    assert.equal(f.pageMessages.slice(before).some(message => message.type === 'config'), false);
    assert.equal(live(f.pageMessages, before), false);
  }
});

test('exact origin permissions register only their protocol and capture runs on the granted site', async () => {
  const f = fixture({ site: false, auto: true }); await flush(); await flush();
  f.host.grantedOrigins.add('https://example.com/*');
  f.browser.permissions.onAdded.emit({ origins: ['https://example.com/*'] });
  await flush(); await flush(); await flush();
  assert.deepEqual(Array.from(f.host.calls.register.at(-1)[0].matches), ['https://example.com/*']);
  assert.ok(f.pageMessages.some(message => message.type === 'config'));
  assert.equal((await f.command('capture')).code, 'NEED_SITE');
  f.browser.action.onClicked.emit(f.active);
  assert.equal((await f.command('capture')).ok, true);
  f.active.url = 'http://example.com/'; f.pagePort.sender.tab.url = f.active.url;
  f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  f.browser.runtime.onConnect.emit(f.pagePort); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
});

test('pending locate replies complete unavailable immediately when team or access changes', async () => {
  for (const change of [
    f => f.update({ preferences: { ...f.state().preferences, current: 'two' } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
    f => documentGoes(f),
  ]) {
    const f = fixture({ signals: [signal()] });
    const post = f.pagePort.postMessage;
    let flashed;
    const flash = new Promise(resolve => { flashed = resolve; });
    f.pagePort.postMessage = message => { post(message); if (message.type === 'signal-replay') flashed(); };
    const result = f.command('signal-replay', { recordId: 'signal' });
    await flash; change(f);
    assert.equal((await result).value.result, 'unavailable');
  }
});

test('removing a site from 已授权网站 unregisters its page layer and stops its page', async () => {
  const f = fixture({ auto: true, site: false, origins: ['https://example.com/*'] }); await flush(); await flush(); await flush();
  assert.ok(f.pageMessages.some(message => message.type === 'config'));
  const unregistered = f.host.calls.unregister.length;
  f.host.grantedOrigins.delete('https://example.com/*'); f.browser.permissions.onRemoved.emit({ origins: ['https://example.com/*'] });
  await flush(); await flush(); await flush();
  assert.ok(f.host.calls.unregister.length > unregistered);
  assert.equal(f.host.calls.unregister.at(-1).ids[0], 'palside-page');
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.status().interactive, false); assert.equal(f.status().granted, false);
});

test('a page layer that connected while its tab was still loading gets signals once the tab completes', async () => {
  const f = fixture({ auto: true });
  f.browser.windows.get = async id => ({ id, focused: true, incognito: false });
  await flush(); await flush(); await flush();
  const configs = () => f.pageMessages.filter(message => message.type === 'signal-config');
  // Subresources still loading do not make the page ineligible; a navigation rotates the tab instead.
  f.active.status = 'loading'; f.browser.windows.onFocusChanged.emit(10); await flush(); await flush(); await flush();
  assert.equal(configs().at(-1).on, true);
  const before = configs().length;
  f.active.status = 'complete';
  f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active); await flush(); await flush(); await flush();
  assert.ok(configs().length > before);
  assert.equal(configs().at(-1).on, true);
});

test('Chrome taking a site back switches its 网页互动 off once removals settle; a site still granted keeps its switch', async () => {
  const f = fixture({ auto: true });
  f.update({ preferences: { ...f.state().preferences, siteInteraction: { 'example.com': { on: true, danmaku: true, signal: true }, 'kept.example': { on: true, danmaku: true, signal: true } } } });
  await flush();
  f.browser.permissions.contains = async ({ origins }) => origins[0] === 'https://kept.example/*';
  f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['https://example.com/*', 'https://fresh.example/*'] });
  await flush();
  assert.equal(f.operations.some(command => command.name === 'preferences'), false, 'waits for a re-grant that may follow at once');
  fireTimers(f, 1500); await flush(); await flush(); await flush();
  const saved = f.operations.filter(command => command.name === 'preferences').at(-1).payload.siteInteraction;
  assert.equal(saved['example.com'].on, false);
  assert.equal(saved['fresh.example'].on, false, 'a removed site that never had a setting is recorded off too');
  assert.equal(saved['kept.example']?.on ?? true, true, 'a site still granted keeps its switch; one back at the default keeps no entry');
});

test('another tab or query of the same token page keeps signals, highlights and 弹幕; another page starts clean', async () => {
  const base = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112';
  const f = fixture({ auto: true, url: base });
  await flush(); await flush(); await flush();
  const cleared = () => f.pageMessages.filter(message => message.type === 'clear' || message.type === 'danmaku-remove').length;
  const before = cleared();
  for (const url of [`${base}?tab=holders`, `${base}?tab=trades#top`]) {
    f.active.url = url; f.pagePort.sender.tab.url = url;
    f.pagePort.onMessage.emit({ type: 'url', url }); await flush(); await flush();
  }
  assert.equal(cleared(), before);
  const other = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111113';
  f.active.url = other; f.pagePort.sender.tab.url = other;
  f.pagePort.onMessage.emit({ type: 'url', url: other }); await flush(); await flush();
  assert.ok(f.pageMessages.some(message => message.type === 'clear'));
});
