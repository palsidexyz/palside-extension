import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const panel = {};
const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
Object.defineProperty(globalThis, 'chrome', { configurable: true, value: panel });
const { accessStatus, broadOrigin, getHostPermissions, grantedHost, notificationsGranted, requestAllSites, requestNotifications, requestSitesAccess, requestTabs, revokeAllSites, revokeAllSitesKeepingHosts, revokeNotifications, revokeSiteAccess, revokeTabs, siteOriginPattern, tabsGranted } = await import('../apps/extension/src/runtime/browser/permissions.ts');
const { commands } = await import('../apps/extension/src/background/commands.ts');
if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
else delete globalThis.chrome;
hooks.deregister();

function connectPanel(host) {
  const messages = [], refreshes = [];
  const background = commands({
    browser: host,
    notifications: { listenNotifications() { refreshes.push('notifications'); } },
    pages: { syncPermissions(changed) { refreshes.push(['pages', changed]); } },
    roomTab: { async refresh() { refreshes.push('room'); } },
    run() { assert.fail('permission commands must stay in the background'); },
  });
  panel.permissions = {
    request: host.permissions.request,
    getAll() { assert.fail('sidepanel must read permissions through the background'); },
    contains() { assert.fail('sidepanel must read permissions through the background'); },
    remove() { assert.fail('sidepanel must remove permissions through the background'); },
  };
  panel.runtime = { async sendMessage(message) {
    assert.equal(message.type, 'palside/command');
    messages.push(message.command);
    return background.panelCommand(message.command, 'chrome-extension://test/sidepanel.html');
  } };
  return { messages, refreshes, background };
}

function fakeChrome(initialOrigins = [], initialPermissions = [], controls = {}) {
  const origins = new Set(initialOrigins);
  const permissions = new Set(initialPermissions);
  const calls = [];
  function covers(pattern, requested) {
    if (pattern === requested || pattern === '<all_urls>') return true;
    if (requested === '<all_urls>') return false;
    const match = /^(\*|https?|file):\/\/([^/]+)\//.exec(pattern);
    if (!match) return false;
    if (!URL.canParse(requested)) return false;
    const url = new URL(requested);
    const [, scheme, host] = match;
    return (scheme === '*' || `${scheme}:` === url.protocol) && (host === '*' || host === url.hostname || host.startsWith('*.') && (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))));
  }
  const host = {
    origins, grants: permissions, calls,
    permissions: {
      getAll: async () => { calls.push(['getAll']); return { origins: [...origins], permissions: [...permissions] }; },
      contains: async request => {
        calls.push(['contains', request]);
        return (request.origins ?? []).every(origin => [...origins].some(pattern => covers(pattern, origin))) && (request.permissions ?? []).every(permission => permissions.has(permission));
      },
      request: request => {
        calls.push(['request', request]);
        if (controls.deny) return Promise.resolve(false);
        for (const origin of request.origins ?? []) origins.add(origin);
        for (const permission of request.permissions ?? []) permissions.add(permission);
        return Promise.resolve(true);
      },
      remove: async request => {
        calls.push(['remove', request]);
        if (controls.removeFails) return false;
        if (!controls.retain) {
          // Chrome also drops every pattern a removed broad pattern covers.
          for (const origin of request.origins ?? []) { origins.delete(origin); if (controls.cascade) for (const other of [...origins]) if (/^https?:\/\/[^*/]+\/\*$/.test(other) && covers(origin, other.replace('/*', '/'))) origins.delete(other); }
          for (const permission of request.permissions ?? []) permissions.delete(permission);
        }
        return true;
      },
    },
  };
  Object.assign(host, connectPanel(host));
  return host;
}

test('开启 asks synchronously for every exact host in one Chrome prompt', async () => {
  const host = fakeChrome();
  const result = requestSitesAccess(['gmgn.ai', 'News.Example.com', 'gmgn.ai'], host);
  assert.deepEqual(host.calls, [['request', { origins: ['https://gmgn.ai/*', 'https://news.example.com/*'] }]]);
  assert.equal(await result, true);
  assert.deepEqual([...host.origins], ['https://gmgn.ai/*', 'https://news.example.com/*']);
  assert.deepEqual([...host.grants], []);
  assert.equal(await requestSitesAccess(['example.com'], fakeChrome([], [], { deny: true })), false);
});

test('hosts that are not public sites are dropped, and nothing to ask never opens a prompt', async () => {
  const host = fakeChrome();
  assert.equal(await requestSitesAccess([], host), false);
  assert.equal(await requestSitesAccess(['localhost', 'intranet', 'router.local', '127.0.0.1', '10.0.0.1', '*.example.com'], host), false);
  assert.deepEqual(host.calls, []);
  assert.equal(await requestSitesAccess(['localhost', 'example.com'], host), true);
  assert.deepEqual(host.calls, [['request', { origins: ['https://example.com/*'] }]]);
  for (const url of ['', 'example.com', '*://example.com/*', 'https://*.example.com/', '<all_urls>', 'not a URL', 'chrome://settings', 'file:///tmp/a', 'http://localhost', 'https://example.com:8443']) {
    assert.equal(await revokeSiteAccess(url), false, url);
  }
});

test('host grant reads retain Chrome patterns instead of conflating them with host rules', async () => {
  const origins = ['https://news.example.com/*', '*://*.example.org/*', 'http://*/*', '<all_urls>'];
  fakeChrome(origins, ['notifications']);
  assert.deepEqual(await getHostPermissions(), origins);
  connectPanel({ permissions: { getAll: async () => ({ permissions: ['notifications'] }) } });
  assert.deepEqual(await getHostPermissions(), []);
  assert.deepEqual(origins.map(grantedHost), ['news.example.com', undefined, undefined, undefined]);
  assert.equal(grantedHost('*://news.example.com/*'), 'news.example.com');
  assert.deepEqual(origins.map(broadOrigin), [false, false, false, true]);
  assert.equal(broadOrigin('*://*/*'), true); assert.equal(broadOrigin('https://*/*'), true);
  assert.equal(siteOriginPattern('https://News.Example.com/a?b'), 'https://news.example.com/*');
  assert.equal(siteOriginPattern('http://localhost'), undefined);
});

test('status reads preserve scheme and subdomain boundaries and report only the site grant', async () => {
  const host = fakeChrome(['https://example.com/*']);
  assert.deepEqual(await accessStatus('https://example.com/path', host), { site: true });
  for (const url of ['http://example.com', 'https://sub.example.com', 'https://other.example.com', undefined, 'chrome://settings']) {
    assert.deepEqual(await accessStatus(url, host), { site: false }, String(url));
  }
  host.origins.add('*://*.example.org/*');
  assert.deepEqual(await accessStatus('https://sub.example.org', host), { site: true });
  host.origins.add('<all_urls>');
  assert.deepEqual(await accessStatus('https://other.example.com', host), { site: true }, 'a grant made in Chrome\'s menu covers the site');
  assert.equal(host.calls.some(([kind, request]) => kind === 'request' || request?.permissions), false, 'reading status never asks or checks named permissions');
});

test('exact revocation retains other origins and verifies that access was removed', async () => {
  const host = fakeChrome(['https://example.com/*', 'http://example.com/*', 'https://other.example.com/*'], ['notifications']);
  assert.equal(await revokeSiteAccess('https://example.com/path'), true);
  assert.deepEqual([...host.origins], ['http://example.com/*', 'https://other.example.com/*']);
  assert.deepEqual([...host.grants], ['notifications']);
  for (const controls of [{ removeFails: true }, { retain: true }]) {
    fakeChrome(['https://example.com/*'], [], controls);
    assert.equal(await revokeSiteAccess('https://example.com'), false);
  }
});

test('broad grants prevent single-site revocation from claiming success', async () => {
  for (const broad of ['<all_urls>', '*://*/*', 'https://*/*', '*://*.example.com/*', '*://example.com/*']) {
    const host = fakeChrome([broad, 'https://example.com/*']);
    assert.equal(await revokeSiteAccess('https://example.com/path'), false, broad);
    assert.deepEqual([...host.origins], [broad]);
    assert.deepEqual(host.calls[0], ['remove', { origins: ['https://example.com/*'] }]);
  }
});

test('允许所有网站 asks for every site; removing it keeps the sites added one by one', async () => {
  const host = fakeChrome(['https://gmgn.ai/*'], [], { cascade: true });
  const result = requestAllSites(host);
  assert.deepEqual(host.calls, [['request', { origins: ['<all_urls>'] }]]);
  assert.equal(await result, true);
  assert.equal(await revokeAllSitesKeepingHosts(), true);
  assert.deepEqual(host.calls.slice(1), [['getAll'], ['remove', { origins: ['<all_urls>'] }], ['request', { origins: ['https://gmgn.ai/*'] }], ['getAll']]);
  assert.deepEqual([...host.origins], ['https://gmgn.ai/*']);
  const empty = fakeChrome(['<all_urls>']);
  assert.equal(await revokeAllSitesKeepingHosts(), true);
  assert.deepEqual(empty.calls, [['getAll'], ['remove', { origins: ['<all_urls>'] }], ['getAll']]);
});

test('notifications are the only named permission requested, read or revoked', async () => {
  const host = fakeChrome();
  assert.equal(await notificationsGranted(), false);
  const asked = requestNotifications(host);
  assert.deepEqual(host.calls.at(-1), ['request', { permissions: ['notifications'] }]);
  assert.equal(await asked, true);
  assert.equal(await notificationsGranted(), true);
  assert.equal(await revokeNotifications(), true);
  assert.equal(await notificationsGranted(), false);
  assert.equal(host.calls.some(([, request]) => request?.permissions?.includes('tabs') || request?.origins?.includes('<all_urls>')), false);
});

test('panel requests run before any message or await and refresh through the background only after a grant', async () => {
  for (const [request, expected] of [
    [() => requestSitesAccess(['example.com']), { origins: ['https://example.com/*'] }],
    [() => requestAllSites(), { origins: ['<all_urls>'] }],
    [() => requestTabs(), { permissions: ['tabs', 'favicon'] }],
    [() => requestNotifications(), { permissions: ['notifications'] }],
  ]) {
    const host = fakeChrome();
    host.permissions.request = () => assert.fail('background must not request permissions');
    const pending = request();
    assert.deepEqual(host.calls, [['request', expected]]);
    assert.deepEqual(host.messages, []);
    assert.deepEqual(host.refreshes, []);
    assert.equal(await pending, true);
    assert.deepEqual(host.messages.map(message => message.name), ['permissions-sync']);
    assert.deepEqual(host.refreshes, ['notifications', ['pages', false], 'room']);
  }
  const denied = fakeChrome([], [], { deny: true });
  assert.equal(await requestNotifications(), false);
  assert.deepEqual(denied.messages, []);
  assert.deepEqual(denied.refreshes, []);
});

test('panel permission-state reads use the background without requesting or removing access', async () => {
  const host = fakeChrome(['https://example.com/*'], ['tabs', 'favicon', 'notifications']);
  assert.deepEqual(await getHostPermissions(), ['https://example.com/*']);
  assert.equal(await tabsGranted(), true);
  assert.equal(await notificationsGranted(), true);
  assert.deepEqual(await accessStatus('https://example.com/path'), { site: true });
  assert.deepEqual(await accessStatus('http://example.com/path'), { site: false });
  assert.equal(host.messages.every(message => message.name === 'permissions-get'), true);
  assert.equal(host.calls.some(([kind]) => kind === 'request' || kind === 'remove'), false);
});

test('background removes tabs with favicon and all site grants while preserving unrelated permissions', async () => {
  const host = fakeChrome(['<all_urls>', 'https://example.com/*', '*://example.com/*'], ['tabs', 'favicon', 'notifications']);
  assert.equal(await revokeTabs(), true);
  assert.deepEqual([...host.grants], ['notifications']);
  assert.equal(await tabsGranted(), false);
  assert.deepEqual(await revokeAllSites(), ['example.com']);
  assert.deepEqual([...host.origins], []);
  assert.deepEqual([...host.grants], ['notifications']);
  assert.equal(host.calls.some(([kind]) => kind === 'request'), false);
});

test('failed removals do not restore sites or report removed host grants', async () => {
  const host = fakeChrome(['<all_urls>', 'https://example.com/*'], ['tabs', 'favicon', 'notifications'], { removeFails: true });
  assert.equal(await revokeAllSitesKeepingHosts(), false);
  await assert.rejects(revokeAllSites());
  assert.equal(await revokeTabs(), false);
  assert.equal(await revokeNotifications(), false);
  assert.deepEqual([...host.origins], ['<all_urls>', 'https://example.com/*']);
  assert.equal(host.calls.some(([kind]) => kind === 'request'), false);
});

test('permission commands reject arbitrary permissions and malformed removal payloads before touching Chrome', async () => {
  const host = fakeChrome();
  for (const payload of [
    { kind: 'downloads' }, { kind: 'site' }, { kind: 'site', url: 42 },
    { kind: 'tabs', url: 'https://example.com' }, { kind: 'sites', origins: ['<all_urls>'] },
  ]) {
    await assert.rejects(host.background.panelCommand({ name: 'permissions-remove', payload }, 'chrome-extension://test/sidepanel.html'));
  }
  await assert.rejects(host.background.panelCommand({ name: 'permissions-sync', payload: { granted: true } }, 'chrome-extension://test/sidepanel.html'));
  assert.deepEqual(host.calls, []);
  assert.deepEqual(host.refreshes, []);
});

test('permission request and background failures propagate without claiming success', async () => {
  const host = fakeChrome();
  panel.permissions.request = () => Promise.reject(new Error('gesture unavailable'));
  await assert.rejects(requestTabs(), /gesture unavailable/);
  assert.deepEqual(host.messages, []);
  panel.runtime.sendMessage = async () => ({ ok: false, code: 'PERMISSION_FAILED', message: 'Permission failed' });
  await assert.rejects(revokeNotifications(), { code: 'PERMISSION_FAILED' });
});


test('broad removal verifies absence and exact-site restoration, including denial', async () => {
  for (const controls of [{ retain: true }, { cascade: true, deny: true }]) {
    fakeChrome(['<all_urls>', 'https://example.com/*'], [], controls);
    assert.equal(await revokeAllSitesKeepingHosts(), false);
  }
  fakeChrome(['https://example.com/*'], [], { retain: true });
  await assert.rejects(revokeAllSites());
});

test('requests cannot race an outstanding removal and can retry in a later click', async () => {
  const host = fakeChrome(['https://example.com/*']);
  let finish;
  const remove = host.permissions.remove;
  host.permissions.remove = async request => { await new Promise(resolve => { finish = resolve; }); return remove(request); };
  const removing = revokeAllSites();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(requestSitesAccess(['example.com']));
  assert.equal(host.calls.some(([kind]) => kind === 'request'), false);
  finish();
  assert.deepEqual(await removing, ['example.com']);
  assert.equal(await requestSitesAccess(['example.com']), true);
});

test('removal waits for a prompt already started in the click', async () => {
  const host = fakeChrome();
  let finish;
  panel.permissions.request = request => new Promise(resolve => { finish = () => { for (const origin of request.origins) host.origins.add(origin); resolve(true); }; });
  const asking = requestSitesAccess(['example.com']);
  const removing = revokeAllSites();
  await Promise.resolve();
  assert.equal(host.calls.some(([kind]) => kind === 'remove'), false);
  finish();
  assert.equal(await asking, true);
  assert.deepEqual(await removing, ['example.com']);
  assert.deepEqual([...host.origins], []);
});

test('queued removals recheck the initiating intent before dispatch', async () => {
  const host = fakeChrome();
  let finish;
  panel.permissions.request = () => new Promise(resolve => { finish = resolve; });
  const asking = requestNotifications();
  let current = true;
  const removing = revokeNotifications(() => current);
  current = false; finish(true);
  await asking; assert.equal(await removing, false);
  assert.equal(host.calls.some(([kind]) => kind === 'remove'), false);
});
