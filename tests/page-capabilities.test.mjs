import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCapabilities } from '../apps/extension/src/runtime/browser/page-capabilities.ts';
import { pageStatus } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
import { accessStatus } from '../apps/extension/src/runtime/browser/permissions.ts';

const granted = { site: true, allUrls: true };
const page = (url, access = granted, extra = {}) => pageCapabilities({ id: 1, url, ...extra }, access);
const all = (value, expected) => Object.values(value).forEach(capability => assert.deepEqual(capability, expected));

test('browser schemes, local files, missing tabs and incognito are blocked explicitly', () => {
  for (const url of ['chrome://settings', 'chrome-extension://abc/page.html', 'edge://settings', 'about:blank', 'data:text/html,hello', 'view-source:https://example.com', 'devtools://devtools', 'ftp://example.com', 'invalid']) all(page(url), { state: 'blocked', reason: 'browser' });
  all(page('file:///tmp/example.pdf'), { state: 'blocked', reason: 'file' });
  all(pageCapabilities(undefined, granted), { state: 'blocked', reason: 'none' });
  all(pageCapabilities({ id: -1 }, granted), { state: 'blocked', reason: 'none' });
  all(page('https://example.com', granted, { incognito: true }), { state: 'blocked', reason: 'private' });
});

test('both store URLs block injection and capture but permit a public link', () => {
  for (const url of ['https://chromewebstore.google.com/detail/a', 'https://chrome.google.com/webstore', 'https://chrome.google.com/webstore/detail/a']) {
    const value = page(url);
    for (const action of ['capture', 'pick', 'danmaku']) assert.deepEqual(value[action], { state: 'blocked', reason: 'store' });
    assert.equal(value.share.state, 'ready');
  }
  for (const url of ['https://chrome.google.com/webstore-other', 'https://chromewebstore.google.com.example.com']) all(page(url), { state: 'ready' });
});

test('public-link validation alone blocks sharing private or credential-bearing URLs', () => {
  for (const url of ['http://localhost', 'http://a.localhost', 'http://intranet', 'http://router.local', 'http://127.0.0.1', 'http://10.1.2.3', 'http://172.16.0.1', 'http://192.168.1.1', 'http://[::1]', 'https://user:password@example.com', 'https://example.com:8443', 'https://example.com/?access_token=secret', 'https://example.com/#auth=secret']) {
    const value = page(url);
    assert.deepEqual(value.share, { state: 'blocked', reason: 'private' }, url);
    for (const action of ['capture', 'pick']) assert.equal(value[action].state, 'ready', url);
    assert.deepEqual(value.danmaku, { state: 'blocked', reason: 'private' }, url);
  }
});

test('loading defers possible actions while permanent blocks remain visible', () => {
  all(page('https://example.com', { site: false }, { status: 'loading' }), { state: 'pending' });
  all(pageCapabilities({ id: 1, status: 'loading' }, { site: false }), { state: 'pending' });
  all(page('chrome://settings', granted, { status: 'loading' }), { state: 'blocked', reason: 'browser' });
  assert.deepEqual(page('http://localhost', granted, { status: 'loading' }).share, { state: 'blocked', reason: 'private' });
});

test('an exact site grant readies interaction; only activeTab or all_urls readies capture', () => {
  const denied = page('https://example.com', { site: false });
  for (const action of ['capture', 'pick', 'danmaku', 'signal']) assert.equal(denied[action].state, 'access', action);
  assert.equal(denied.share.state, 'ready');
  const active = page('https://example.com', { site: false, active: true });
  assert.equal(active.capture.state, 'ready', 'activeTab: the address is visible without a site grant');
  for (const action of ['pick', 'danmaku', 'signal']) assert.equal(active[action].state, 'access', action);
  const origin = page('https://example.com', { site: true });
  assert.equal(origin.capture.state, 'access');
  assert.equal(page('https://example.com', { site: true, active: true }).capture.state, 'ready');
  for (const action of ['pick', 'danmaku', 'signal', 'share']) assert.equal(origin[action].state, 'ready', action);
  all(pageCapabilities({ id: 1 }, { site: false }), { state: 'access' });
  all(pageCapabilities({ id: 1 }, { site: false, active: true }), { state: 'access' });
  assert.deepEqual(page('https://chromewebstore.google.com/detail/a', { site: false, active: true }).capture, { state: 'blocked', reason: 'store' });
});

test('the 网页互动 switch never blocks explicit page capabilities', () => {
  const value = page('https://example.com', granted);
  assert.equal(value.pick.state, 'ready');
  assert.equal(value.danmaku.state, 'ready');
  assert.equal(value.capture.state, 'ready');
  assert.equal(value.share.state, 'ready');
  for (const token of [true, false]) all(page('https://example.com/document.pdf', granted, {}, token), { state: 'ready' });
});

test('pageStatus includes capabilities for ordinary pages, with no stale port fallback after tab closure', () => {
  const state = { preferences: { web: { share: true, interact: true } }, toggles: { share: false, interact: false } };
  const status = pageStatus(10, { id: 1, url: 'https://example.com', status: 'complete' }, [], granted, state);
  assert.equal(status.host, 'example.com');
  assert.equal(status.capabilities.pick.state, 'ready');
  assert.equal(status.interactive, false);
  assert.equal(status.capabilities.capture.state, 'ready');
  all(pageStatus(10, undefined, [{ windowId: 10, tabId: 1, url: 'https://example.com' }], granted, state).capabilities, { state: 'blocked', reason: 'none' });
});

test('permission reads ask only for the exact origin and never for tabs or all URLs', async () => {
  const origins = new Set(['https://example.com/*']);
  const asked = [];
  const host = { permissions: { contains: async request => { asked.push(request); return request.origins ? request.origins.every(origin => origins.has(origin)) : true; } } };
  assert.deepEqual(await accessStatus('https://example.com/path', host), { site: true });
  assert.deepEqual(await accessStatus('https://other.example/path', host), { site: false });
  assert.deepEqual(await accessStatus(undefined, host), { site: false });
  assert.deepEqual(await accessStatus('chrome://settings', host), { site: false });
  assert.deepEqual(asked, [{ origins: ['https://example.com/*'] }, { origins: ['https://other.example/*'] }]);
});
