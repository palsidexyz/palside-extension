import { renderMessage } from '../packages/i18n/src/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageOpener } from '../apps/extension/src/runtime/browser/open-page.ts';

const target = 'https://gmgn.ai/robinhood/token/0x39dbed3a2bd333467115de45665cc57f813c4571';
function fixture({ granted = true, activeUrl = 'https://example.com/', matches = [] } = {}) {
  const calls = { queries: [], creates: [], updates: [] };
  const active = { id: 7, windowId: 2, index: 3, active: true, url: activeUrl };
  const api = {
    windows: { getLastFocused: async () => ({ id: 2, incognito: false }) },
    permissions: { contains: async () => granted },
    tabs: {
      query: async query => { calls.queries.push(query); return query.active ? [active] : matches; },
      create: async request => { calls.creates.push(request); return { id: 20, ...request }; },
      update: async (id, request) => { calls.updates.push({ id, ...request }); },
    },
  };
  return { api, calls };
}

test('source navigation keeps an already active matching page untouched, including when only activeTab exposes it', async () => {
  const { api, calls } = fixture({ granted: false, activeUrl: `${target}?ref=old` });
  await createPageOpener(api)(target);
  assert.equal(calls.creates.length, 0); assert.equal(calls.updates.length, 0);
  assert.deepEqual(calls.queries, [{ active: true, windowId: 2 }]);
});

test('source navigation selects the most recently used authorized match within the initiating window', async () => {
  const { api, calls } = fixture({ matches: [
    { id: 8, url: target, active: false, lastAccessed: 100 },
    { id: 9, url: `${target}?ref=friend`, active: false, lastAccessed: 300 },
    { id: 10, url: `${target}?pool=different`, active: false, lastAccessed: 900 },
  ] });
  await createPageOpener(api)(target);
  assert.deepEqual(calls.updates, [{ id: 9, active: true }]);
  assert.equal(calls.creates.length, 0);
  assert.ok(calls.queries.every(query => query.windowId === 2));
});

test('without host access a source opens beside the current tab and repeated clicks share one action', async () => {
  const { api, calls } = fixture({ granted: false }); const open = createPageOpener(api);
  await Promise.all([open(target), open(`${target}?ref=friend`)]); await open(target);
  assert.deepEqual(calls.creates, [{ url: target, windowId: 2, active: true, index: 4, openerTabId: 7 }]);
  assert.equal(calls.updates.length, 0);
  assert.ok(calls.queries.every(query => query.active));
});

test('without tabs permission and without an activeTab URL a source opens in a new tab', async () => {
  const { api, calls } = fixture({ granted: false, activeUrl: undefined });
  await createPageOpener(api)(target);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].url, target);
});

test('a failed browser action can be retried and unsupported protocols never create a tab', async () => {
  const { api, calls } = fixture({ granted: false }); let failed = false;
  const create = api.tabs.create;
  api.tabs.create = async request => { if (!failed) { failed = true; throw new Error('window closed'); } return create(request); };
  const open = createPageOpener(api);
  await assert.rejects(open('javascript:alert(1)'), error => /链接/.test(renderMessage('zh-CN', error.text)));
  await assert.rejects(open(target), /window closed/); await open(target);
  assert.equal(calls.creates.length, 1);
});

test('ordinary chat links open a new adjacent tab even when the current tab already matches', async () => {
  const { api, calls } = fixture({ activeUrl: target });
  await createPageOpener(api)(target, false);
  assert.equal(calls.creates.length, 1); assert.equal(calls.creates[0].index, 4);
  assert.equal(calls.updates.length, 0);
});


test('sharing waits a full second per stable page and stops immediately', async t => {
  const { createTabObserver } = await import('../apps/extension/src/runtime/browser/tab-observer.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let policy = { key: 'account:team' }, page = { tabId: 1, windowId: 1, url: 'https://example.com/' };
  const published = []; let clears = 0;
  const observer = createTabObserver({ policy: () => policy, activePage: async () => page, clear: async () => { clears++; }, publish: async identity => { published.push(identity.url); }, activity: async () => {} });
  t.after(() => observer.dispose());
  const tick = async ms => { t.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve)); };
  await observer.refresh();
  await tick(500);
  assert.deepEqual(published, []);
  page = { ...page, tabId: 2, url: 'https://other.example/' };
  await observer.refresh();
  await tick(999);
  assert.deepEqual(published, []);
  await tick(1);
  assert.deepEqual(published, ['https://other.example']);
  await observer.refresh();
  const before = clears;
  policy = undefined;
  await observer.refresh();
  assert.equal(clears, before + 1);
  await tick(1000);
  assert.equal(published.length, 1);
});
