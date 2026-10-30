import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDiff, currentPick } from '../apps/extension/src/runtime/browser/page-layer-host.ts';



function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map(fn => fn(...args)); } }; }
function fixture({ site = true, origins, url = 'https://example.com/', saved = [], auto = false } = {}) {
  const timers = new Map();
  const timer = (fn, delay) => { if (delay < 1000) return setTimeout(fn, delay); const id = { delay }; timers.set(id, fn); return id; };
  const clearTimer = id => { if (!timers.delete(id)) clearTimeout(id); };
  const messages = [];
  const pageMessages = [];
  let pagePort;
  let perform = async () => ({ ok: true });
  const operations = [], injections = [];
  let state = { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false }, account: { id: 'alice' }, preferences: { current: 'one', web: { share: true, interact: true }, notifications: 'off' }, toggles: { share: false, interact: auto }, remoteTeams: [{ id: 'one', joined: true }, { id: 'two', joined: true }], items: { danmaku: [], stickies: saved }, data: { views: [], messages: [], people: [] }, drafts: {} };
  const active = { id: 1, windowId: 10, url, active: true, status: 'complete', title: 'Example' };
  const browser = {
    runtime: { id: 'qa', getURL: value => `chrome-extension://qa${value}`, getContexts: async () => [{}], sendMessage: async ({ command }) => command.name === 'snapshot' ? { ok: true, value: state } : (operations.push(command), perform(command)), onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event() },
    tabs: { query: async options => options?.url ? [] : [{ ...active }], captureVisibleTab: async () => 'data:image/png;base64,AA==', onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { get: async id => ({ id }), onRemoved: event(), onFocusChanged: event() },
    sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
    scripting: { executeScript: async value => { injections.push(value); if (pagePort) browser.runtime.onConnect.emit(pagePort); return []; } },
    action: { onClicked: event() },
    permissions: { contains: async ({ origins } = {}) => origins ? site : false, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
  };
  const host = addBackgroundHost(browser, { origins: origins ?? (site ? ['<all_urls>'] : []) });
  startWorker(browser, { setTimeout: timer, clearTimeout: clearTimer, openPage: async url => { active.url = url; active.status = 'loading'; setTimeout(() => { active.status = 'complete'; pagePort.sender.tab.url = url; browser.tabs.onUpdated.emit(active.id, { status: 'complete' }, active); }, 10); } });
  const port = { name: 'palside/panel', sender: { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' }, onMessage: event(), onDisconnect: event(), postMessage: value => messages.push(value) };
  browser.runtime.onConnect.emit(port);
  port.onMessage.emit({ type: 'hello', windowId: 10 });
  pagePort = { name: 'palside/page', sender: { id: 'qa', documentId: 'doc-1', tab: { id: 1, windowId: 10, url }, }, onMessage: event(), onDisconnect: event(), postMessage: value => pageMessages.push(value) };
  const sendState = stateSender(browser);
  const broadcast = () => sendState(state);
  broadcast();
  const command = (name, payload = {}) => new Promise(resolve => browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload: { ...(name === 'toggle' ? {} : name === 'quote-sticky' ? { teamId: 'one' } : { windowId: 10, teamId: 'one' }), ...payload } } }, port.sender, resolve));
  const native = message => pagePort.onMessage.emit({ ...message, contextId: pageMessages.filter(value => value.type === 'pick' && value.on).at(-1)?.contextId });
  // 网页互动 is one switch: saving it broadcasts state, and the background follows it for every granted site.
  const interact = (on = true) => { state = { ...state, toggles: { ...state.toggles, interact: on } }; broadcast(); };
  const status = () => messages.filter(message => message.type === 'page').at(-1)?.status;
  return { interact, status, perform: fn => { perform = fn; }, operations, injections, browser, port, pagePort, messages, pageMessages, active, command, host, timers, native, state: () => state, update: patch => { state = { ...state, ...patch }; broadcast(); }, expire: () => { for (const fn of [...timers.values()]) fn(); } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function fireTimers(f, delay) {
  for (const [id, fn] of [...f.timers]) if (delay === undefined || id.delay === delay) { f.timers.delete(id); fn(); }
}

test('one-off locate retains its highlight until its lease expires', async () => {
  const f = fixture({ saved: [savedMark()] });
  const post = f.pagePort.postMessage;
  f.pagePort.postMessage = value => { post(value); if (value.type === 'flash') setImmediate(() => f.pagePort.onMessage.emit({ type: 'located', requestId: value.requestId, result: 'shown' })); };
  assert.equal((await f.command('locate-sticky', { stickyId: '$saved' })).value.result, 'shown');
  assert.equal(f.pageMessages.some(value => value.type === 'off'), false);
  fireTimers(f, 4500); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.status().connected, false);
});

const target = { kind: 'quote', exact: 'hello world', prefix: '', suffix: '' };
const picked = requestId => ({ type: 'picked', requestId, target, caption: 'hello world' });

test('网页互动 toggles note projections and selection at once', async () => {
  const f = fixture({ saved: [savedMark()] }); await flush(); await flush(); await flush();
  assert.equal(f.status().stickyEnabled, false); assert.equal(f.status().interactive, false);
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), false);
  f.interact(true); await flush(); await flush(); await flush();
  assert.equal(f.status().stickyEnabled, true); assert.equal(f.status().interactive, true);
  assert.equal(f.pageMessages.filter(message => message.type === 'stickies').at(-1).items.length, 1);
  assert.equal(f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).canSticky, true);
  f.interact(false); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.status().stickyEnabled, false); assert.equal(f.status().interactive, false); assert.equal('interact' in f.status(), false);
  assert.equal(f.state().items.stickies.length, 1);
});
test('worker restart restores notes from 网页互动 for every page of a granted site', async () => {
  const stale = fixture({ saved: [savedMark()] }); await flush(); await flush(); await flush();
  assert.equal(stale.injections.length, 0);
  assert.equal(stale.status().stickyEnabled, false);
  const restored = fixture({ auto: true, saved: [savedMark()] }); await flush(); await flush(); await flush();
  assert.equal(restored.status().stickyEnabled, true);
  assert.equal(restored.pageMessages.filter(message => message.type === 'stickies').at(-1).items.length, 1);
  const other = fixture({ auto: true, url: 'https://example.com/other', saved: [savedMark()] }); await flush(); await flush(); await flush();
  assert.ok(other.injections.length > 0);
  assert.equal(other.status().stickyEnabled, true);
  assert.equal(other.pageMessages.filter(message => message.type === 'stickies').at(-1).items.length, 0);
  restored.update({ account: { id: 'bob' }, toggles: { share: false, interact: false } }); await flush(); await flush();
  assert.equal(restored.pageMessages.at(-1).type, 'off');
  assert.equal(restored.status().stickyEnabled, false);
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
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), false);
});
test('网页互动 turned off stays off through same URL reload', async () => {
  const f = fixture({ auto: true, saved: [savedMark()] }); await flush(); await flush(); await flush();
  f.interact(false); await flush(); await flush();
  const before = f.pageMessages.length, count = f.injections.length;
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  f.pagePort.sender.documentId = 'disabled-reload';
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(f.pageMessages.slice(before).some(message => message.type === 'pick' && message.on && message.canSticky), false);
  assert.equal(f.pageMessages.slice(before).some(message => message.type === 'stickies' && message.items.length), false);
  assert.equal(f.status().stickyEnabled, false);
});
test('pick failure acknowledges the same request and keeps context for retry', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  f.perform(async command => command.name === 'attach-ref' ? { ok: false, message: 'no', text: { key: 'common.retry' } } : { ok: true });
  f.native(picked('first'));
  await flush(); await flush();
  const failed = f.pageMessages.find(message => message.type === 'pick-result');
  assert.equal(failed.requestId, 'first'); assert.equal(failed.ok, false); assert.equal(typeof failed.error, 'string');
  f.perform(async () => ({ ok: true }));
  f.native(picked('retry'));
  await flush(); await flush();
  const result = f.pageMessages.filter(message => message.type === 'pick-result').at(-1);
  assert.equal(result.requestId, 'retry'); assert.equal(result.ok, true);
  const command = f.operations.filter(command => command.name === 'attach-ref').at(-1);
  assert.equal(command.payload.accountId, 'alice'); assert.equal(command.payload.teamId, 'one');
});

test('duplicate submissions cannot send twice while the original request is pending', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  let complete;
  f.perform(command => command.name === 'attach-ref' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ ok: true }));
  f.native(picked('first'));
  await flush();
  f.native(picked('duplicate'));
  await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 1);
  complete({ ok: true }); await flush();
});

test('team/account switch, navigation, document disconnect and revocation invalidate pending selections', async () => {
  for (const cancel of [
    f => f.update({ preferences: { ...f.state().preferences, current: 'two' } }),
    f => f.update({ account: { id: 'bob' } }),
    f => f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active),
    f => f.pagePort.onDisconnect.emit(),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
  ]) {
    const f = fixture({ auto: true }); await flush(); await flush(); await flush();
    let complete;
    f.perform(command => command.name === 'attach-ref' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ ok: true }));
    const old = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
    f.native(picked('old'));
    await flush();
    assert.equal(typeof complete, 'function');
    cancel(f); await flush();
    complete({ ok: true }); await flush(); await flush();
    assert.equal(f.pageMessages.some(message => message.type === 'pick-result' && message.ok), false);
    f.pagePort.onMessage.emit({ ...picked('late'), contextId: old });
    await flush();
    assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 1);
  }
});

test('reference flashes preserve semantic query and hash and exclude old or other-team events', () => {
  const now = Date.now();
  const old = { authenticated: true, account: { id: 'me' }, remoteTeams: [{ id: 'a', joined: true }], preferences: { current: 'a' }, data: { messages: [] } };
  const message = (id, url, patch = {}) => ({ id, teamId: 'a', author: 'x', liveArrival: true, status: 'sent', expiresAt: now + 1000, ref: { target, view: { kind: 'website', url } }, ...patch });
  const next = { ...old, data: { messages: [message('same', 'https://example.com/read?q=one#section'), message('hash', 'https://example.com/read?q=one#other'), message('old', 'https://example.com/read?q=one#section', { liveArrival: false }), message('team', 'https://example.com/read?q=one#section', { teamId: 'b' })] } };
  const ports = [{ tabId: 1, windowId: 1, url: 'https://example.com/read?q=one&utm_source=a#section' }];
  assert.deepEqual(pageDiff(old, next, ports, now)[0].flashes.map(item => item.id), ['same']);
});

test('pick context binds the document even if a reload keeps the same URL', () => {
  const context = { accountId: 'a', teamId: 't', tabId: 1, windowId: 2, url: 'https://example.com', documentId: 'old' };
  const state = { authenticated: true, account: { id: 'a' }, preferences: { current: 't' }, remoteTeams: [{ id: 't', joined: true }] };
  assert.equal(currentPick(context, { ...context }, state), true);
  assert.equal(currentPick(context, { ...context, documentId: 'new' }, state), false);
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




const savedMark = (patch = {}) => ({ id: '$saved', revision: '$saved', teamId: 'one', author: 'alice', text: '', target, caption: 'hello world', url: 'https://example.com/', site: 'example.com', timestamp: Date.now(), expiresAt: Date.now() + 60_000, ...patch });

test('native selection saves an empty-body note on a page with 网页互动', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  const contextId = f.pageMessages.find(message => message.type === 'pick' && message.on)?.contextId;
  assert.equal(typeof contextId, 'string');
  f.perform(async command => command.name === 'team-event' ? { ok: true, value: { id: '$mark', revision: '$edit', existing: true } } : { ok: true });
  const requestId = crypto.randomUUID();
  f.native({ type: 'marked', action: 'sticky', text: '', target, caption: 'hello world', requestId });
  await flush(); await flush();
  const submitted = f.operations.find(command => command.name === 'team-event');
  assert.equal(submitted.payload.operationId, requestId);
  assert.equal(submitted.payload.kind, 'sticky'); assert.equal(submitted.payload.text, '');
  assert.equal(submitted.payload.url, 'https://example.com/'); assert.equal(submitted.payload.accountId, 'alice'); assert.equal(submitted.payload.teamId, 'one');
  const result = f.pageMessages.find(message => message.type === 'pick-result');
  assert.equal(result.stickyId, '$mark'); assert.equal(result.revision, '$edit'); assert.equal(result.existing, true);
  f.native(picked(crypto.randomUUID())); await flush(); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 1);
  assert.equal(f.pageMessages.some(message => message.type === 'mark'), false);
});
test('native selection rejects another context, pause state and 网页互动 turned off', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  f.pagePort.onMessage.emit({ ...picked(crypto.randomUUID()), contextId: 'another-document' });
  await f.command('selection-enabled', { on: false });
  f.native(picked(crypto.randomUUID())); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
  await f.command('selection-enabled', { on: true });
  f.interact(false); await flush();
  f.native(picked(crypto.randomUUID())); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
});
test('same-URL refresh re-injects a 网页互动 page with a new document context and keeps selection pause', async () => {
  const f = fixture({ auto: true }); await flush(); await flush(); await flush();
  const oldContext = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  await f.command('selection-enabled', { on: false });
  const count = f.injections.length;
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  f.pagePort.sender.documentId = 'doc-reloaded';
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush(); await flush();
  assert.ok(f.injections.length > count);
  const fresh = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  assert.notEqual(fresh, oldContext);
  assert.equal(f.pageMessages.filter(message => message.type === 'selection-enabled').at(-1).on, false);
  await f.command('selection-enabled', { on: true });
  f.pagePort.onMessage.emit({ ...picked(crypto.randomUUID()), contextId: oldContext });
  await flush(); assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
});

test('cold worker restores only with 网页互动 on a granted site; saved marks cannot bypass the choice', async () => {
  for (const scenario of [
    { saved: [savedMark()], auto: true, restore: true },
    { saved: [savedMark()], restore: false },
    { saved: [savedMark({ expiresAt: Date.now() - 1 })], auto: true, restore: true, projected: false },
    { saved: [savedMark({ url: 'https://example.com/other' })], restore: false },
    { saved: [savedMark({ teamId: 'two' })], restore: false },
    { saved: [savedMark({ expiresAt: Date.now() - 1 })], restore: false },
    { saved: [savedMark()], site: false, restore: false },
  ]) {
    const f = fixture(scenario); await flush(); await flush(); await flush();
    assert.equal(f.injections.length > 0, scenario.restore);
    assert.equal(f.pageMessages.some(message => message.type === 'stickies' && message.items.some(item => item.id === '$saved')), scenario.restore && scenario.projected !== false, 'saved notes appear only on pages that open with 互动');
    assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), scenario.restore);
  }
});

test('quoting a saved mark uses the readable original target and refuses another account or team', async () => {
  const f = fixture({ saved: [savedMark()] }); await flush(); await flush();
  f.active.url = 'https://example.com/elsewhere';
  assert.equal((await f.command('quote-sticky', { accountId: 'alice', stickyId: '$saved', target: { kind: 'quote', exact: 'forged' }, url: 'https://evil.example/' })).ok, false);
  assert.equal((await f.command('quote-sticky', { accountId: 'alice', stickyId: '$saved' })).ok, true);
  const quoted = f.operations.find(command => command.name === 'attach-ref');
  assert.equal(quoted.payload.url, 'https://example.com/'); assert.equal(quoted.payload.target.exact, 'hello world'); assert.equal(quoted.payload.teamId, 'one');
  assert.equal((await f.command('quote-sticky', { accountId: 'bob', stickyId: '$saved' })).ok, false);
  assert.equal((await f.command('quote-sticky', { teamId: 'two', stickyId: '$saved' })).ok, false);
});

test('locating an asset quote opens its original URL from another route or site', async () => {
  const source = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112';
  for (const url of [`${source}?tab=holders`, 'https://example.com/']) {
    const f = fixture({ url });
    const ref = { view: { kind: 'token', chain: 'Solana', address: 'So11111111111111111111111111111111111111112', url: source }, target };
    f.update({ data: { ...f.state().data, messages: [{ id: 'quote', teamId: 'one', author: 'alice', ref }] } });
    const post = f.pagePort.postMessage;
    f.pagePort.postMessage = value => { post(value); if (value.type === 'flash') setImmediate(() => f.pagePort.onMessage.emit({ type: 'located', requestId: value.requestId, result: 'shown' })); };
    assert.equal((await f.command('locate-ref', { messageId: 'quote' })).value.result, 'shown');
    assert.equal(f.active.url, source);
    fireTimers(f, 4500);
  }
});

test('locating a saved ordinary-page mark opens its source, waits for load, and focuses it once', async () => {
  const f = fixture({ saved: [savedMark()], url: 'https://example.com/elsewhere' });
  const originalPost = f.pagePort.postMessage;
  f.pagePort.postMessage = message => { originalPost(message); if (message.type === 'flash') setImmediate(() => f.pagePort.onMessage.emit({ type: 'located', requestId: message.requestId, result: 'shown' })); };
  const result = await f.command('locate-sticky', { accountId: 'alice', stickyId: '$saved' });
  assert.equal(result.ok, true); assert.equal(result.value.result, 'shown');
  assert.equal(f.active.url, 'https://example.com/'); assert.equal(f.active.status, 'complete');
  assert.equal(f.pageMessages.filter(message => message.type === 'flash').length, 1);
  // Locating is one-off: it neither projects 便利贴 nor turns 互动 on for the page.
  assert.equal(f.pageMessages.some(message => message.type === 'stickies' && message.items.length), false);
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), false);
  assert.equal(f.status().interactive, false); assert.equal(f.status().stickyEnabled, false);
  assert.equal(f.state().toggles.interact, false);
});


test('SPA page handshake rebinds the current context after browser URL notification without rotating it again', async () => {
  const f = fixture({ auto: true, url: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' });
  await flush(); await flush(); await flush();
  const old = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  const url = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111113';
  f.active.url = url; f.pagePort.sender.tab.url = url;
  f.browser.tabs.onUpdated.emit(1, { url }, f.active); await flush(); await flush();
  const afterBrowser = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  assert.notEqual(afterBrowser, old);
  const before = f.pageMessages.filter(message => message.type === 'pick' && message.on).length;
  const signals = f.pageMessages.filter(message => message.type === 'signal-config').length;
  const projections = f.pageMessages.filter(message => message.type === 'stickies').length;
  f.pagePort.onMessage.emit({ type: 'url', url }); await flush(); await flush();
  assert.ok(f.pageMessages.filter(message => message.type === 'signal-config').length > signals);
  assert.ok(f.pageMessages.filter(message => message.type === 'stickies').length > projections);
  const bound = f.pageMessages.filter(message => message.type === 'pick' && message.on);
  assert.ok(bound.length > before); assert.equal(bound.at(-1).contextId, afterBrowser);
});

test('switching team invalidates the old native context even on an automatically supported page', async () => {
  const f = fixture({ auto: true, url: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' });
  await flush(); await flush(); await flush();
  const old = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  f.update({ preferences: { ...f.state().preferences, current: 'two' } }); await flush(); await flush(); await flush();
  const current = f.pageMessages.filter(message => message.type === 'pick' && message.on).at(-1).contextId;
  assert.notEqual(current, old);
  f.pagePort.onMessage.emit({ ...picked(crypto.randomUUID()), contextId: old }); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
  f.native(picked(crypto.randomUUID())); await flush(); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').at(-1).payload.teamId, 'two');
});

test('a host granted for both protocols registers both without opting into sharing, including HTTP pages', async () => {
  for (const scheme of ['http', 'https']) {
    const f = fixture({ auto: true, origins: ['*://custom.example.com/*'], url: `${scheme}://custom.example.com/article` });
    await flush(); await flush(); await flush();
    assert.deepEqual(Array.from(f.host.calls.register.at(-1)[0].matches), ['http://custom.example.com/*', 'https://custom.example.com/*']);
    assert.ok(f.pageMessages.some(message => message.type === 'config'));
    assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), true);
    assert.equal(f.state().toggles.share, false);
    assert.equal(f.operations.some(command => command.name === 'preferences'), false);
  }
});

test('automatic pages open with notes and selection; turning 网页互动 off stops the page', async () => {
  const f = fixture({ auto: true, saved: [savedMark()] });
  await flush(); await flush(); await flush();
  assert.ok(f.pageMessages.some(message => message.type === 'config'));
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on && message.canSticky), true);
  assert.equal(f.pageMessages.some(message => message.type === 'stickies' && message.items.some(item => item.id === '$saved')), true);
  f.update({ toggles: { share: true, interact: false } });
  await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  assert.equal(f.pageMessages.some(message => message.type === 'pick-result' && message.requestId === 'pending-auto'), false);
  const count = f.injections.length;
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
  assert.equal(f.host.calls.unregister.at(-1).ids[0], 'palside-page');
});

test('turning 网页互动 off tears down its open page at once and keeps it off after refresh', async () => {
  const f = fixture({ auto: true, saved: [savedMark()] }); await flush(); await flush(); await flush();
  const before = f.pageMessages.length;
  f.perform(async command => { if (command.name === 'toggle') f.interact(command.payload.interact); return { ok: true }; });
  assert.equal((await f.command('toggle', { interact: false })).ok, true);
  await flush(); await flush();
  assert.ok(f.pageMessages.slice(before).some(message => message.type === 'off'));
  assert.equal(f.status().interactive, false); assert.equal(f.status().connected, false);
  f.native(picked('after-off')); await flush(); await flush();
  assert.equal(f.operations.filter(command => command.name === 'attach-ref').length, 0);
  const count = f.injections.length;
  f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  f.active.status = 'complete'; f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush(); await flush();
  assert.equal(f.injections.length, count);
  assert.equal(f.state().toggles.interact, false);
});

test('turning 网页互动 on connects its open page immediately and the panel status follows', async () => {
  const f = fixture({ saved: [savedMark()] }); await flush(); await flush();
  f.perform(async command => { if (command.name === 'toggle') f.interact(command.payload.interact); return { ok: true }; });
  assert.equal((await f.command('toggle', { interact: true })).ok, true);
  await flush(); await flush(); await flush();
  assert.ok(f.injections.length > 0);
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on && message.canSticky), true);
  assert.equal(f.pageMessages.filter(message => message.type === 'stickies').at(-1).items.length, 1);
  const status = f.status();
  assert.equal(status.interactive, true); assert.equal(status.connected, true); assert.equal(status.stickyEnabled, true);
});

test('automatic registration cannot finish stale after disable, revoke, logout, or account change', async () => {
  for (const change of [
    f => f.update({ toggles: { share: false, interact: false } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
    f => f.update({ authenticated: false }),
    f => f.update({ account: { id: 'bob' }, toggles: { share: false, interact: false } }),
    f => f.update({ preferences: { ...f.state().preferences, current: 'missing' } }),
  ]) {
    const f = fixture(); await flush(); await flush();
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

test('switching 网页互动 on reports registration failure while retaining the saved switch', async () => {
  const f = fixture({ site: false, origins: ['*://other.example.com/*'] }); await flush(); await flush();
  f.perform(async command => { if (command.name === 'toggle') f.interact(command.payload.interact); return { ok: true }; });
  f.browser.scripting.registerContentScripts = async () => { throw new Error('registration failed'); };
  const failed = await f.command('toggle', { interact: true });
  assert.equal(failed.ok, false);
  assert.equal(f.state().toggles.interact, true);
  const registered = [];
  f.browser.scripting.registerContentScripts = async scripts => { registered.push(...scripts); };
  const retried = await f.command('toggle', { interact: true });
  assert.equal(retried.ok, true);
  assert.deepEqual(Array.from(registered.at(-1).matches), ['http://other.example.com/*', 'https://other.example.com/*']);
});

test('automatic page admission and SPA navigation honor exact host grants with no fixed-site exceptions', async () => {
  const f = fixture({ auto: true, site: false, origins: ['https://custom.example.com/*'], url: 'https://custom.example.com/a' });
  await flush(); await flush(); await flush();
  const url = 'https://custom.example.com/b';
  f.active.url = url; f.pagePort.sender.tab.url = url;
  f.browser.tabs.onUpdated.emit(1, { url }, f.active); await flush();
  assert.equal(f.pageMessages.some(message => message.type === 'pick' && message.on), true);
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
  assert.deepEqual(f.state().toggles, { share: false, interact: false });
});

test('delayed page admission cannot bind a revoked, disabled or navigated document', async () => {
  for (const change of [
    f => f.update({ toggles: { share: false, interact: false } }),
    f => { f.host.grantedOrigins.clear(); f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] }); },
    f => { f.active.url = 'https://other.example.com/'; f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active); },
    f => { f.active.status = 'loading'; f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active); f.active.status = 'complete'; },
    f => f.update({ authenticated: false }),
    f => f.update({ account: { id: 'bob' }, toggles: { share: false, interact: false } }),
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
    assert.equal(f.pageMessages.slice(before).some(message => message.type === 'pick' && message.on), false);
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
    f => f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active),
  ]) {
    const f = fixture({ saved: [savedMark()] });
    const post = f.pagePort.postMessage;
    let flashed;
    const flash = new Promise(resolve => { flashed = resolve; });
    f.pagePort.postMessage = message => { post(message); if (message.type === 'flash') flashed(); };
    const result = f.command('locate-sticky', { stickyId: '$saved' });
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
