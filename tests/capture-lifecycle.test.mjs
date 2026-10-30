import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import { IMAGE_LIMIT } from '../apps/extension/src/domain/images/image-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';


function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map(fn => fn(...args)); } }; }
const until = async (check, ms = 1000) => { for (const end = Date.now() + ms; !check() && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 5)); return check(); };
function fixture({ site = true, url = 'https://example.com/', imageFetch } = {}) {
  const timers = new Map();
  const timer = (fn, delay) => { if (delay !== 120_000) return setTimeout(fn, delay); const id = {}; timers.set(id, fn); return id; };
  const clearTimer = id => { if (!timers.delete(id)) clearTimeout(id); };
  const messages = [];
  const pageMessages = [];
  const imageWindows = []; const closedWindows = []; const commands = []; const opened = [];
  let pagePort;
  let state = { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false }, account: { id: 'alice' }, preferences: { current: 'one', web: { share: true, interact: true }, notifications: 'off' }, toggles: { share: false, interact: false }, remoteTeams: [{ id: 'one', joined: true }, { id: 'two', joined: true }], items: { stickies: [] }, data: { views: [], messages: [], people: [] }, drafts: {} };
  const active = { id: 1, windowId: 10, url, active: true, status: 'complete', title: 'Example' };
  const browser = {
    runtime: { id: 'qa', getURL: value => `chrome-extension://qa${value}`, getContexts: async () => [{}], sendMessage: async ({ command, type }) => type === 'palside/image-flush' ? { ok: true } : command.name === 'snapshot' ? { ok: true, value: state } : (commands.push(command), { ok: true }), onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event() },
    tabs: { query: async options => options?.url ? [] : [{ ...active }], captureVisibleTab: async () => 'data:image/png;base64,AA==', onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { get: async id => ({ id }), create: async options => { const window = { id: 100 + imageWindows.length, ...options }; imageWindows.push(window); return window; }, remove: async id => { closedWindows.push(id); browser.windows.onRemoved.emit(id); }, onRemoved: event(), onFocusChanged: event() },
    sidePanel: { open: async options => { opened.push(options); }, setPanelBehavior: async () => {} },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => { if (pagePort) browser.runtime.onConnect.emit(pagePort); return []; } },
    action: { onClicked: event() },
    commands: { onCommand: event() },
    permissions: { contains: async ({ origins } = {}) => origins ? site : false, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
  };
  const host = addBackgroundHost(browser, { origins: site ? ['<all_urls>'] : [] });
  const bg = startWorker(browser, { fetch: imageFetch, setTimeout: timer, clearTimeout: clearTimer });
  const port = { name: 'palside/panel', sender: { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' }, onMessage: event(), onDisconnect: event(), postMessage: value => messages.push(value) };
  browser.runtime.onConnect.emit(port);
  port.onMessage.emit({ type: 'hello', windowId: 10 });
  pagePort = { name: 'palside/page', sender: { id: 'qa', tab: { id: 1, windowId: 10, url }, }, onMessage: event(), onDisconnect: event(), postMessage: value => pageMessages.push(value) };
  const sendState = stateSender(browser);
  const broadcast = () => sendState(state);
  broadcast();
  const command = (name = 'capture', payload = {}) => new Promise(resolve => browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload: { ...(name.startsWith('image-session-') ? {} : { windowId: 10, teamId: 'one' }), ...payload } } }, port.sender, resolve));
  const imageCommand = (name, payload, window = imageWindows.at(-1)) => new Promise(resolve => browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload } }, { id: 'qa', url: window.url, tab: { windowId: window.id } }, resolve));
  return { bg, browser, port, pagePort, opened, messages, pageMessages, active, command, imageCommand, imageWindows, closedWindows, commands, host, timers, state: () => state, update: patch => { state = { ...state, ...patch }; broadcast(); }, expire: () => { for (const fn of [...timers.values()]) fn(); } };
}

test('the 截图 shortcut hands the pressed tab to Palside and starts the page editor for the open panel', async () => {
  const f = fixture({ site: false });
  assert.equal((await f.command()).code, 'NEED_SITE', 'a click in the panel alone cannot capture a tab without a site grant');
  f.browser.commands.onCommand.emit('capture', f.active);
  assert.ok(await until(() => f.pageMessages.some(message => message.type === 'capture')), 'the key press counts as activeTab');
  assert.deepEqual(f.opened, [], 'an open panel is reused');
});

test('the 截图 shortcut opens the panel when none is open and captures once it connects', async () => {
  const f = fixture({ site: false });
  f.port.onDisconnect.emit();
  f.browser.commands.onCommand.emit('capture', f.active);
  assert.deepEqual(f.opened, [{ windowId: 10 }], 'the panel opens inside the key press');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.pageMessages.some(message => message.type === 'capture'), false);
  const panel = { name: 'palside/panel', sender: { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' }, onMessage: event(), onDisconnect: event(), postMessage: () => {} };
  f.browser.runtime.onConnect.emit(panel);
  panel.onMessage.emit({ type: 'hello', windowId: 10 });
  assert.ok(await until(() => f.pageMessages.some(message => message.type === 'capture')));
  f.browser.commands.onCommand.emit('other', f.active);
});

test('panel capture runs under activeTab without a site grant; a tab whose address Chrome hides needs the site', async () => {
  const granted = fixture({ site: false });
  granted.browser.action.onClicked.emit(granted.active);
  const started = await granted.command();
  assert.equal(started.value.started, true);
  assert.ok(granted.pageMessages.some(message => message.type === 'capture'));
  const hidden = fixture({ site: false });
  delete hidden.active.url;
  const result = await hidden.command();
  assert.equal(result.code, 'NEED_SITE');
  assert.equal(result.text.key, 'extension.runtime.needSite');
  assert.equal(hidden.pageMessages.some(message => message.type === 'capture'), false);
});

test('visible URLs, tabs and exact grants cannot prove screenshot access; toolbar grants expire across origins and closure', async () => {
  const f = fixture({ site: false });
  // The fixture exposes URLs as tabs permission would, without issuing an activeTab grant.
  assert.equal((await f.command()).code, 'NEED_SITE');
  f.host.grantedOrigins.add('https://example.com/*');
  assert.equal((await f.command()).code, 'NEED_SITE');
  f.browser.action.onClicked.emit(f.active);
  assert.equal((await f.command()).value.started, true);
  f.pagePort.onMessage.emit({ type: 'capture-cancel' });
  f.active.url = 'https://example.com/next';
  f.pagePort.sender.tab.url = f.active.url;
  f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active);
  assert.equal((await f.command()).value.started, true, 'same-origin navigation retains activeTab');
  f.pagePort.onMessage.emit({ type: 'capture-cancel' });
  f.active.url = 'https://other.example/';
  f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active);
  f.active.url = 'https://example.com/';
  f.browser.tabs.onUpdated.emit(1, { url: f.active.url }, f.active);
  assert.equal((await f.command()).code, 'NEED_SITE', 'returning does not resurrect the grant');
  f.browser.action.onClicked.emit(f.active);
  f.browser.tabs.onRemoved.emit(1, { windowId: 10 });
  assert.equal((await f.command()).code, 'NEED_SITE', 'a reused tab id has no grant');
  assert.equal((await fixture({ site: false }).command()).code, 'NEED_SITE', 'a fresh worker has no grant record');
});

test('panel capture starts the page editor after site access', async () => {
  const fixtureState = fixture();
  const result = await fixtureState.command();
  assert.equal(result.value.started, true);
  assert.equal(fixtureState.pageMessages.find(message => message.type === 'capture').type, 'capture');
  fixtureState.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,annotated' });
  assert.equal(fixtureState.messages.at(-1).type, 'captured');
  assert.equal(fixtureState.messages.at(-1).src, 'data:image/png;base64,annotated');
  assert.equal(fixtureState.messages.at(-1).teamId, 'one');
  assert.equal(fixtureState.timers.size, 0);
});

test('unsupported pages remain unavailable', async () => {
  const fixtureState = fixture({ url: 'chrome://settings' });
  const result = await fixtureState.command();
  assert.equal(result.text.key, 'extension.runtime.pageNoCapture');
});

test('capture errors distinguish permission loss from a temporary API failure', async () => {
  const f = fixture();
  f.browser.tabs.captureVisibleTab = async () => { throw new Error('quota'); };
  assert.equal((await f.command()).text.key, 'extension.copy.captureFailed');
  assert.equal(f.timers.size, 0);
  // Losing the site and the tab's activeTab grant (Chrome hides its address again) turns the failure into a site request.
  f.browser.tabs.captureVisibleTab = async () => { f.host.grantedOrigins.clear(); delete f.active.url; throw new Error('denied'); };
  assert.equal((await f.command()).code, 'NEED_SITE');
});

test('capture injection failure is transient even when page interaction is switched off', async () => {
  const f = fixture();
  f.update({ toggles: { share: false, interact: false } });
  f.browser.scripting.executeScript = async () => { throw new Error('injection'); };
  assert.equal((await f.command()).text.key, 'extension.runtime.pageActionFailed');
  assert.equal(f.timers.size, 0);
});

test('one-off page actions distinguish missing permission, forbidden pages, loading and injection failure', async () => {
  const open = f => f.bg.pages.openPageTools(10, f.port.sender.url, 'pick');
  await assert.rejects(open(fixture({ site: false })), { code: 'NEED_SITE' });
  await assert.rejects(open(fixture({ site: false, url: 'chrome://settings' })), { text: { key: 'extension.runtime.pageUnavailable' } });
  const f = fixture();
  f.active.status = 'loading';
  await assert.rejects(open(f), { text: { key: 'extension.runtime.pagePending' } });
  f.active.status = 'complete';
  f.browser.scripting.executeScript = async () => { throw new Error('PDF injection refused'); };
  await assert.rejects(open(f), { text: { key: 'extension.runtime.pageActionFailed' } });
});

test('the editor holds the reservation until cancellation, then capture can restart', async () => {
  const f = fixture();
  assert.equal((await f.command()).value.started, true);
  assert.equal((await f.command()).text.key, 'extension.runtime.captureInProgress');
  f.pagePort.onMessage.emit({ type: 'capture-cancel' });
  assert.equal(f.timers.size, 0);
  assert.equal((await f.command()).value.started, true);
  f.pagePort.onMessage.emit({ type: 'capture-cancel' });
});

test('navigation, tab switches, tab removal, page disconnection and panel disconnection cancel editing', async () => {
  for (const cancel of [
    f => f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active),
    f => f.pagePort.onMessage.emit({ type: 'url', url: 'https://example.com/next' }),
    f => f.browser.tabs.onActivated.emit({ windowId: 10 }),
    f => f.browser.tabs.onRemoved.emit(1, { windowId: 10 }),
    f => f.pagePort.onDisconnect.emit(),
    f => f.port.onDisconnect.emit(),
  ]) {
    const f = fixture();
    await f.command();
    cancel(f);
    f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,LATE' });
    assert.equal(f.messages.some(message => message.type === 'captured'), false);
    assert.equal(f.timers.size, 0);
  }
});

test('navigation invalidates an in-flight bitmap and releases the window for another capture', async () => {
  const f = fixture();
  let resolveCapture;
  const waiting = new Promise(resolve => { resolveCapture = resolve; });
  f.browser.tabs.captureVisibleTab = () => waiting;
  const result = f.command();
  await new Promise(resolve => setImmediate(resolve));
  f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  resolveCapture('data:image/png;base64,LATE');
  await result;
  assert.equal(f.pageMessages.some(message => message.type === 'capture'), false);
  f.browser.tabs.captureVisibleTab = async () => 'data:image/png;base64,FRESH';
  assert.equal((await f.command()).value.started, true);
  f.pagePort.onMessage.emit({ type: 'capture-cancel' });
});

test('team and account switches cancel captures before any late image can be delivered', async () => {
  const f = fixture();
  await f.command();
  f.update({ preferences: { ...f.state().preferences, current: 'two' } });
  f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,OK' });
  assert.equal(f.messages.some(message => message.type === 'captured'), false);
  await f.command('capture', { teamId: 'two' });
  f.update({ account: { id: 'bob' } });
  f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,WRONG' });
  assert.equal(f.messages.filter(message => message.type === 'captured').length, 0);
  assert.equal(f.timers.size, 0);
});

test('capture requires a valid explicit team and rejects a stale account', async () => {
  const f = fixture();
  for (const payload of [{ teamId: undefined }, { teamId: 'missing' }, { accountId: 'bob' }]) assert.equal((await f.command('capture', payload)).text.key, 'extension.runtime.captureContextChanged');
});

test('timeout and permission revocation end the whole capture session', async () => {
  const f = fixture();
  await f.command();
  f.expire();
  assert.equal(f.timers.size, 0);
  assert.equal(f.messages.at(-1).message.key, 'extension.runtime.captureTimedOut');
  await f.command();
  f.host.grantedOrigins.clear();
  f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.timers.size, 0);
  f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,LATE' });
  assert.equal(f.messages.some(message => message.type === 'captured'), false);
});

test('page script registration is serialized and unrelated state does not re-register or scan notifications', async () => {
  const f = fixture();
  await new Promise(resolve => setImmediate(resolve));
  let running = 0, maximum = 0, registrations = 0, queries = 0, notifications = 0;
  f.browser.scripting.registerContentScripts = async () => { running++; maximum = Math.max(maximum, running); registrations++; await new Promise(resolve => setTimeout(resolve, 5)); running--; };
  const query = f.browser.tabs.query;
  f.browser.tabs.query = options => { if (options?.url) queries++; return query(options); };
  f.browser.permissions.contains = async request => request.permissions?.includes('notifications') ? true : request.origins ? true : true;
  f.browser.notifications = { getAll: async () => { notifications++; return {}; } };
  f.update({ toggles: { share: false, interact: true } });
  for (let i = 0; i < 3; i++) f.browser.permissions.onAdded.emit({ origins: ['https://gmgn.ai/*'] });
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(maximum, 1);
  assert.equal(registrations, 1);
  const previousQueries = queries;
  const roomTabs = () => f.commands.filter(command => command.name === 'room-tab').length;
  const previousRoomTabs = roomTabs();
  for (let i = 0; i < 5; i++) f.update({ revision: i });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registrations, 1);
  assert.equal(queries, previousQueries);
  assert.equal(roomTabs(), previousRoomTabs, 'active-tab observation does not repeat an unchanged room source');
  assert.equal(notifications, 0);
  f.update({ data: { ...f.state().data, messages: [{ id: 'arrived', teamId: 'one', author: 'peer', status: 'sent' }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications, 1);
});

test('page capabilities are pushed after load, tab activation, site switches and permission changes', async () => {
  const f = fixture();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const last = () => f.messages.filter(message => message.type === 'page').at(-1).status.capabilities;
  await flush();
  assert.equal(last().pick.state, 'ready');
  f.active.status = 'loading';
  f.browser.tabs.onUpdated.emit(1, { status: 'loading' }, f.active);
  await flush();
  assert.equal(last().pick.state, 'pending');
  f.active.status = 'complete';
  f.browser.tabs.onUpdated.emit(1, { status: 'complete' }, f.active);
  await flush();
  assert.equal(last().pick.state, 'ready');
  f.update({ toggles: { share: false, interact: true } });
  await flush();
  assert.equal(last().pick.state, 'ready');
  assert.equal(f.messages.filter(message => message.type === 'page').at(-1).status.interactive, true);
  f.active.url = 'https://other.example';
  f.browser.tabs.onActivated.emit({ windowId: 10 });
  await flush();
  assert.equal(last().pick.state, 'ready');
  f.host.grantedOrigins.clear();
  f.browser.permissions.onRemoved.emit({ origins: ['<all_urls>'] });
  await flush();
  assert.equal(last().pick.state, 'access');
  assert.equal(last().share.state, 'ready');
});

const imageBytes = 'data:image/png;base64,AA==';
function attachImage(f, src = imageBytes) {
  f.update({ drafts: { one: { revision: 4, value: { attachment: { kind: 'image', src, name: 'capture.png' } } } } });
  return { teamId: 'one', mode: 'edit', source: { src, name: 'capture.png' } };
}

test('image window commands preserve draft identity and reject stale revisions or another window', async () => {
  const f = fixture(); const payload = attachImage(f);
  const opened = await f.command('image-session-open', payload);
  assert.equal(opened.ok, true); const session = opened.value;
  assert.equal(session.draftRevision, 4); assert.equal(session.windowOpen, true);
  assert.equal(new URL(f.imageWindows[0].url).searchParams.get('session'), session.id);
  assert.equal(f.imageWindows[0].url.includes('base64'), false);
  assert.equal((await f.imageCommand('image-session-read', { id: session.id }, { ...f.imageWindows[0], id: 999 })).ok, false);
  const updated = await f.imageCommand('image-session-update', { id: session.id, expectedRevision: 0, document: { operations: [] } });
  assert.equal(updated.ok, true); assert.equal(updated.value.revision, 1);
  assert.equal((await f.imageCommand('image-session-save', { id: session.id, expectedRevision: 0, src: imageBytes })).code, 'IMAGE_SESSION_CONFLICT');
  assert.equal(f.commands.filter(command => command.name === 'image-draft-save').length, 0);
  const saved = await f.imageCommand('image-session-save', { id: session.id, expectedRevision: 1, src: imageBytes });
  assert.equal(saved.ok, true); assert.equal(saved.value.status, 'saved');
  const write = f.commands.find(command => command.name === 'image-draft-save');
  assert.equal(write.payload.teamId, 'one'); assert.equal(write.payload.draftRevision, 4); assert.equal(write.payload.source, imageBytes);
  assert.equal((await f.imageCommand('image-session-save', { id: session.id, expectedRevision: 2, src: imageBytes })).code, 'IMAGE_SESSION_CLOSED');
  assert.equal(f.commands.filter(command => command.name === 'image-draft-save').length, 1);
});

test('returning an image session retains edits while logout invalidates its window commands', async () => {
  const f = fixture(); const opened = await f.command('image-session-open', attachImage(f)); const id = opened.value.id;
  await f.imageCommand('image-session-update', { id, expectedRevision: 0, document: { operations: ['stroke'] } });
  const returned = await f.command('image-session-return', { id });
  assert.equal(returned.ok, true); assert.equal(returned.value.windowOpen, false);
  assert.deepEqual(returned.value.document, { operations: ['stroke'] }); assert.equal(f.closedWindows.length, 1);
  assert.equal((await f.imageCommand('image-session-update', { id, expectedRevision: 1, document: null })).ok, false);
  f.update({ authenticated: false, account: undefined });
  assert.equal((await f.command('image-session-read', { id })).ok, false);
});

test('image window open converts an owned blob and rejects oversized image bytes', async () => {
  let blob = new Blob([new Uint8Array([0])], { type: 'image/png' });
  const f = fixture({ imageFetch: async () => ({ ok: true, blob: async () => blob }) });
  const payload = attachImage(f, 'blob:chrome-extension://qa/source');
  const opened = await f.command('image-session-open', payload);
  assert.equal(opened.ok, true); assert.equal(opened.value.source.src, imageBytes);
  blob = { size: IMAGE_LIMIT.maxBytes + 1, type: 'image/png' };
  const refused = await f.command('image-session-open', payload);
  assert.equal(refused.code, 'IMAGE_SESSION_INVALID'); assert.equal(f.imageWindows.length, 1);
});

test('an activeTab capture admits its page port without a site grant and survives unrelated permission changes', async () => {
  const f = fixture({ site: false });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  // Without a capture, the same tab's page port is refused: activeTab alone never admits a page.
  f.browser.runtime.onConnect.emit(f.pagePort); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1)?.type, 'off');
  f.pageMessages.length = 0;
  f.browser.action.onClicked.emit(f.active);
  assert.equal((await f.command()).value.started, true);
  assert.ok(f.pageMessages.some(message => message.type === 'capture'), 'the tab given by activeTab is admitted for the capture');
  f.browser.permissions.onAdded.emit({ permissions: ['notifications'] }); await flush(); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'capture', 'a notification grant does not end the activeTab capture');
  f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,annotated' });
  assert.equal(f.messages.at(-1).type, 'captured');
});

test('a capture made under a site grant ends when that grant is removed', async () => {
  const f = fixture();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.command()).value.started, true);
  f.host.grantedOrigins.clear();
  f.browser.permissions.onRemoved.emit({ origins: ['https://example.com/*'] }); await flush(); await flush(); await flush();
  assert.equal(f.pageMessages.at(-1).type, 'off');
  f.pagePort.onMessage.emit({ type: 'captured', src: 'data:image/png;base64,LATE' });
  assert.equal(f.messages.some(message => message.type === 'captured'), false);
});

test('offscreen state enters the worker only through revisioned patches', () => {
  const f = fixture(), state = f.bg.state;
  f.browser.runtime.onMessage.emit({ type: 'palside/state', state: { ...state, notice: 'unaccepted' } }, { id: 'qa', url: 'chrome-extension://qa/offscreen.html' }, () => {});
  assert.equal(f.bg.state, state);
  f.update({ notice: 'accepted' });
  assert.equal(f.bg.state.notice, 'accepted');
});
