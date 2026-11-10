import { MINUTE_MS, SECOND_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { follow } from '../apps/extension/src/background/follow.ts';

const A = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112';
const B = 'https://gmgn.ai/sol/token/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const C = 'https://dexscreener.com/solana/58oqchx4ywmvkdwllzzbi4chocc2fqcuwbkwmihlyqo2';

const G = 'generation-1', T1 = 'lead-tab-one', T2 = 'lead-tab-two', T3 = 'lead-tab-three';

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const tabs = new Map(), calls = [], panelMessages = [], pageMessages = [], timers = [];
  let nextId = 10;
  const panel = { name: 'panel' }, page = { postMessage: message => pageMessages.push(message) };
  const pagePorts = new Map();
  const session = new Map();
  const own = { id: 1, windowId: 1, url: 'https://own.example/', active: true };
  tabs.set(1, own);
  const activate = id => { for (const tab of tabs.values()) tab.active = tab.id === id; };
  const bg = {
    panels: new Map([[panel, 1]]),
    post(port, message) { panelMessages.push(message); return true; },
    pages: { pagePorts },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout(id) { if (id) timers[id - 1] = () => {}; },
    async activeTab() { return [...tabs.values()].find(tab => tab.active); },
    browser: {
      storage: { session: { async get(keys) { return Object.fromEntries([keys].flat().map(key => [key, session.get(key)])); }, async set(value) { for (const [key, item] of Object.entries(value)) session.set(key, JSON.parse(JSON.stringify(item))); } } },
      tabs: {
        async get(id) { const tab = tabs.get(id); if (!tab) throw new Error('No tab'); return tab; },
        async query() { return [...tabs.values()]; },
        async create(options) { const tab = { id: nextId++, windowId: options.windowId, url: options.url, active: false }; tabs.set(tab.id, tab); if (options.active) activate(tab.id); calls.push(['create', options]); return tab; },
        async update(id, options) { const tab = tabs.get(id); if (options.url) tab.url = options.url; if (options.active) activate(id); calls.push(['update', id, options]); return tab; },
        async remove(id) { tabs.delete(id); calls.push(['remove', id]); },
        async group(options) { calls.push(['group', options]); return options.groupId ?? 500; },
        async ungroup(ids) { calls.push(['ungroup', ids]); },
      },
    },
  };
  const service = follow(bg);
  // The two lists the assertions read: what happened to tabs, and the grouping apart from it.
  const moves = () => calls.filter(call => !['group', 'ungroup'].includes(call[0]));
  const created = at => [...tabs.keys()].filter(id => id !== 1)[at];
  /** The teammate's snapshot as the runtime holds it. */
  async function leads(open, front, gen = G) {
    bg.state = { ...bg.state, authenticated: true, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], leadTabs: [{ teamId: 'team', personId: 'mia', gen, open, ...(front ? { front } : {}), at: Date.now() }] };
    await service.routeTabs();
  }
  const start = () => service.request(1, { op: 'go', url: A, start: true, teamId: 'team', personId: 'mia' });
  return { service, bg, tabs, calls, moves, created, leads, start, activate, timers, panelMessages, pageMessages, page, pagePorts, session, panel };
}

test('跟看 opens a follow tab in front, in a group, when it starts; without snapshots it moves that tab without focus', async t => {
  const f = fixture(t);
  await f.service.request(1, { op: 'go', url: A, start: true });
  assert.deepEqual(f.moves(), [['create', { url: A, windowId: 1, active: true }]]);
  const tabId = f.created(0);
  assert.deepEqual(f.calls.find(call => call[0] === 'group'), ['group', { tabIds: [tabId], createProperties: { windowId: 1 } }]);
  await f.service.request(1, { op: 'go', url: B });
  assert.deepEqual(f.moves().at(-1), ['update', tabId, { url: B }], 'later moves never take focus');
  await f.service.request(1, { op: 'go', url: `${B}?utm_source=x` });
  assert.equal(f.moves().length, 2, 'the same page is not loaded again');
  await f.service.request(2, { op: 'go', url: A, start: true });
  assert.equal(f.moves().length, 2, 'only a window with a panel can follow');
});

test('a snapshot names the open tab; each new tab in front opens in the group, and going back switches without a reload', async t => {
  const f = fixture(t);
  await f.start();
  const first = f.created(0);
  await f.leads([T1], { tab: T1, url: A });
  assert.deepEqual(f.moves().at(-1), ['update', first, { active: true }], 'the tab already open becomes theirs: no url, no reload');
  await f.leads([T1, T2], { tab: T2, url: B });
  const second = f.created(1);
  assert.deepEqual(f.moves().at(-1), ['create', { url: B, windowId: 1, active: true }], 'you are in the group, so the front moves with them');
  assert.deepEqual(f.calls.filter(call => call[0] === 'group').at(-1), ['group', { tabIds: [second], groupId: 500 }]);
  const before = f.moves().length;
  await f.leads([T1, T2], { tab: T1, url: A });
  assert.deepEqual(f.moves().slice(before), [['update', first, { active: true }]], 'back to a known tab: no url, no reload');
  await f.leads([T1, T2], { tab: T1, url: A });
  assert.equal(f.moves().length, before + 1, 'saying the same thing again changes nothing');
});

test('on your own tab the group updates from behind; a navigation in their tab moves only its mirror', async t => {
  const f = fixture(t);
  await f.start();
  const first = f.created(0);
  await f.leads([T1], { tab: T1, url: A });
  f.activate(1);
  await f.leads([T1, T2], { tab: T2, url: B });
  const second = f.created(1);
  assert.deepEqual(f.moves().at(-1), ['create', { url: B, windowId: 1, active: false }]);
  assert.equal(f.tabs.get(1).active, true, 'your tab keeps the focus');
  await f.leads([T1, T2], { tab: T2, url: C });
  assert.deepEqual(f.moves().at(-1), ['update', second, { url: C }]);
  assert.equal(f.tabs.get(first).url, A);
  assert.equal(f.tabs.get(1).active, true);
});

test('their tab closing closes its mirror, except one you worked in; a new list leaves the old tabs as your own', async t => {
  const f = fixture(t);
  await f.start();
  await f.leads([T1], { tab: T1, url: A });
  await f.leads([T1, T2], { tab: T2, url: B });
  await f.leads([T1, T2, T3], { tab: T3, url: C });
  const [first, second, third] = [f.created(0), f.created(1), f.created(2)];
  await f.leads([T2, T3], { tab: T3, url: C });
  assert.deepEqual(f.moves().at(-1), ['remove', first]);
  f.service.touched(f.page, { tabId: second, windowId: 1, url: B });
  await f.service.request(1, { op: 'resume', url: C });
  await f.leads([T3], { tab: T3, url: C });
  assert.equal(f.tabs.has(second), false, 'continuing forgets your touch: it is theirs again');
  await f.leads([T3], { tab: T3, url: C });
  f.tabs.get(third).url = 'https://own.example/took-over';
  f.service.touched(f.page, { tabId: third, windowId: 1, url: C });
  const removes = f.moves().filter(call => call[0] === 'remove').length;
  await f.leads([], undefined);
  assert.equal(f.moves().filter(call => call[0] === 'remove').length, removes, 'paused, nothing moves');
  await f.service.request(1, { op: 'resume' });
  await f.leads([T1, T2], { tab: T2, url: B }, 'generation-2');
  assert.equal(f.tabs.has(third), true, 'a new list says nothing about the tab before it');
  assert.ok(f.calls.some(call => call[0] === 'ungroup' && call[1].includes(third)), 'it stays, as your own');
});

test('the oldest follow tab closes beyond eight; closing one yourself keeps it closed until they go to it again; the last ends following', async t => {
  const f = fixture(t);
  await f.start();
  const open = Array.from({ length: 9 }, (_, n) => `lead-tab-${n}`);
  const url = n => `https://site${n}.example/page`;
  for (let n = 0; n < 9; n++) { t.mock.timers.tick(1000); await f.leads(open.slice(0, n + 1), { tab: open[n], url: url(n) }); }
  assert.equal(f.tabs.size, 1 + 8);
  assert.ok(![...f.tabs.values()].some(tab => tab.url === url(0)), 'the tab least recently in front went');
  const last = [...f.tabs.values()].find(tab => tab.url === url(8)).id, count = f.moves().length;
  f.service.tabClosed(last);
  f.tabs.delete(last);
  await f.leads(open, { tab: open[8], url: url(8) });
  assert.equal(f.moves().length, count, 'what you closed stays closed');
  await f.leads(open, { tab: open[7], url: url(7) });
  await f.leads(open, { tab: open[8], url: url(8) });
  assert.ok([...f.tabs.values()].some(tab => tab.url === url(8)), 'until they go to it again');
  for (const id of [...f.tabs.keys()].filter(id => id !== 1)) { f.service.tabClosed(id); f.tabs.delete(id); }
  assert.deepEqual(f.panelMessages.at(-1), { type: 'follow', status: { paused: true, ended: true } });
});

test('your own navigation or input in the tab in front pauses; ours settles; a site moving a tab behind you does not; continuing goes back', async t => {
  const f = fixture(t);
  await f.service.request(1, { op: 'go', url: A, start: true });
  const tabId = f.created(0);
  f.service.tabNavigated(tabId, { url: `${A}#redirected-by-site` }, { active: true });
  f.service.tabNavigated(tabId, { url: C }, { active: true });
  assert.deepEqual(f.panelMessages, [], 'address changes right after our navigation are the site settling');
  t.mock.timers.tick(5 * SECOND_MS);
  f.service.tabNavigated(tabId, { url: C }, { active: false });
  assert.deepEqual(f.panelMessages, [], 'a tab behind yours moved by itself');
  f.service.tabNavigated(tabId, { url: C }, { active: true });
  assert.deepEqual(f.panelMessages.at(-1), { type: 'follow', status: { paused: true } });
  await f.service.request(1, { op: 'go', url: B });
  assert.equal(f.moves().length, 1, 'a paused follow tab stays where you took it');
  await f.service.request(1, { op: 'resume', url: B });
  assert.deepEqual(f.panelMessages.at(-1), { type: 'follow', status: { paused: false } });
  assert.deepEqual(f.moves().at(-1), ['update', tabId, { url: B, active: true }]);
  f.pagePorts.set(f.page, { tabId, windowId: 1, url: B });
  f.service.pageConnected(f.page, { tabId, windowId: 1, url: B });
  assert.deepEqual(f.pageMessages.at(-1), { type: 'follow-tab', on: true }, 'the follow tab listens for your input');
  f.service.touched(f.page, { tabId, windowId: 1, url: B });
  assert.deepEqual(f.panelMessages.at(-1), { type: 'follow', status: { paused: true } });
  assert.deepEqual(f.pageMessages.at(-1), { type: 'follow-tab', on: false });
});

test('continuing brings their tab in front with the next snapshot, wherever they went meanwhile', async t => {
  const f = fixture(t);
  await f.start();
  const first = f.created(0);
  await f.leads([T1], { tab: T1, url: A });
  await f.leads([T1, T2], { tab: T2, url: B });
  const second = f.created(1);
  f.service.touched(f.page, { tabId: second, windowId: 1, url: B });
  f.activate(1);
  await f.service.request(1, { op: 'resume', url: A });
  assert.deepEqual(f.moves().at(-1), ['update', first, { active: true }], 'the page you know of shows at once');
  await f.leads([T1, T2], { tab: T2, url: B });
  assert.deepEqual(f.moves().at(-1), ['update', second, { active: true }], 'and their tab takes the front when they say so');
  assert.equal(f.tabs.get(second).active, true);
});

test('closing the last follow tab ends following and tells the panel; ending or closing the panel leaves the tabs, out of the group', async t => {
  const f = fixture(t);
  await f.service.request(1, { op: 'go', url: A, start: true });
  const tabId = f.created(0);
  f.service.tabClosed(tabId); f.tabs.delete(tabId);
  assert.deepEqual(f.panelMessages.at(-1), { type: 'follow', status: { paused: true, ended: true } });
  await f.service.request(1, { op: 'go', url: B, start: true });
  assert.equal(f.moves().filter(call => call[0] === 'create').length, 2, 'following again opens a new tab');
  const again = f.created(0);
  f.service.panelClosed(1);
  assert.deepEqual(f.calls.at(-1), ['ungroup', [again]]);
  assert.equal(f.tabs.has(again), true);
  await f.service.request(1, { op: 'resume' });
  assert.equal(f.moves().length, 2, 'nothing left to continue');
  assert.deepEqual(f.session.get('palside:follow'), []);
});

test('following someone else starts over: the tabs you had stay as your own', async t => {
  const f = fixture(t);
  await f.start();
  const first = f.created(0);
  await f.service.request(1, { op: 'go', url: B, start: true, teamId: 'team', personId: 'robin' });
  assert.deepEqual(f.calls.find(call => call[0] === 'ungroup'), ['ungroup', [first]]);
  assert.deepEqual(f.moves().at(-1), ['create', { url: B, windowId: 1, active: true }]);
  assert.equal(f.tabs.get(first).url, A);
});

test('a snapshot from before this follow started is not used', async t => {
  const f = fixture(t);
  f.bg.state = { authenticated: true, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], leadTabs: [{ teamId: 'team', personId: 'mia', gen: G, open: [T1], front: { tab: T1, url: B }, at: Date.now() }] };
  t.mock.timers.tick(1000);
  await f.start();
  assert.deepEqual(f.moves(), [['create', { url: A, windowId: 1, active: true }]]);
});

test('a restarted worker keeps the same follow tabs', async t => {
  const f = fixture(t);
  await f.service.request(1, { op: 'go', url: A, start: true });
  const tabId = f.created(0);
  const again = follow(f.bg);
  await again.ready;
  await again.request(1, { op: 'go', url: B });
  assert.deepEqual(f.moves().at(-1), ['update', tabId, { url: B }]);
});

test('the tabs in front while followed go out as a snapshot: random ids, no tab that never came to the front, and it shrinks when one closes', async t => {
  const f = fixture(t);
  const views = [{ id: 'view-a', url: A }, { id: 'view-b', url: B }];
  const state = (viewId, followers = [{ teamId: 'team', personId: 'kai', since: 0, until: Date.now() + MINUTE_MS }]) => ({ authenticated: true, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], data: { views }, publishedViewing: { viewId, teamId: 'team', expiresAt: Date.now() + MINUTE_MS }, followers });
  const sent = [];
  f.bg.signals = { issueHostToken: () => ({ token: 'token', release() {} }) };
  f.bg.browser.runtime = { async sendMessage(message) { sent.push(message.command); return { ok: true }; } };
  const flush = async () => { for (const fn of f.timers.splice(0)) fn(); await Promise.resolve(); };
  f.tabs.set(21, { id: 21, windowId: 1, url: A, active: true }); f.activate(21);
  f.tabs.set(23, { id: 23, windowId: 1, url: C, active: false });
  f.bg.state = state('view-a', []);
  await f.service.routeLead(); await flush();
  assert.deepEqual(sent, [], 'nobody follows, nothing is tracked or sent');
  f.bg.state = state('view-a');
  await f.service.routeLead(); await flush();
  assert.equal(sent.length, 1);
  const [{ name, payload }] = sent;
  assert.equal(name, 'follow-tabs');
  assert.equal(payload.open.length, 1);
  assert.deepEqual(payload.front, { tab: payload.open[0], url: A });
  assert.ok(!/^\d+$/.test(payload.open[0]), 'not the tab id');
  await f.service.routeLead(); await flush();
  assert.equal(sent.length, 1, 'unchanged goes out once');
  f.tabs.set(22, { id: 22, windowId: 1, url: B, active: false }); f.activate(22);
  f.bg.state = state('view-b');
  await f.service.routeLead(); await flush();
  assert.equal(sent.at(-1).payload.open.length, 2);
  assert.equal(sent.at(-1).payload.front.url, B);
  assert.equal(sent.at(-1).payload.gen, payload.gen);
  assert.ok(!JSON.stringify(sent).includes(C), 'a tab that never came to the front is never mentioned');
  f.activate(21); f.bg.state = state('view-a');
  await f.service.routeLead(); await flush();
  assert.equal(sent.at(-1).payload.front.tab, payload.open[0], 'the same tab keeps its id');
  f.service.tabClosed(22); await flush();
  assert.deepEqual(sent.at(-1).payload.open, payload.open);
  f.bg.state = state('view-a', [{ teamId: 'team', personId: 'kai', since: 0, until: Date.now() + 2 * MINUTE_MS }]);
  const count = sent.length;
  await f.service.routeLead(); await flush();
  assert.equal(sent.length, count + 1, 'a renewing follower hears it again');
  // Pausing and continuing within the grace keeps the list; after it, a new one starts.
  f.bg.state = state('view-a', []);
  await f.service.routeLead();
  t.mock.timers.tick(5 * MINUTE_MS);
  f.bg.state = state('view-a');
  await f.service.routeLead(); await flush();
  assert.equal(sent.at(-1).payload.gen, payload.gen);
  f.bg.state = state('view-a', []);
  await f.service.routeLead();
  t.mock.timers.tick(10 * MINUTE_MS + 1);
  await f.service.routeLead();
  f.bg.state = state('view-a');
  await f.service.routeLead(); await flush();
  assert.notEqual(sent.at(-1).payload.gen, payload.gen);
});

const { FOLLOW_WATCH_LIFE, FOLLOW_SKEW, nextFollowers, readFollowEvent } = await import('../apps/extension/src/domain/annotations/follow.ts');

test('follow events are bounded: a watch says on or off, a scroll carries a web page and a position between top and bottom', () => {
  const now = 5_000_000, base = { id: 'abcdef0123456789', teamId: 'team', sentAt: now };
  assert.deepEqual(readFollowEvent({ ...base, kind: 'watch', on: true }, now), { ...base, kind: 'watch', on: true });
  assert.deepEqual(readFollowEvent({ ...base, kind: 'scroll', url: A, y: 0.123456 }, now), { ...base, kind: 'scroll', url: A, y: 0.1235 });
  const tabs = { ...base, kind: 'tabs', gen: 'generation', open: ['tab-one-id', 'tab-two-id'] };
  assert.deepEqual(readFollowEvent(tabs, now), tabs);
  assert.deepEqual(readFollowEvent({ ...tabs, front: { tab: 'tab-two-id', url: A } }, now), { ...tabs, front: { tab: 'tab-two-id', url: A } });
  for (const bad of [{ ...tabs, front: { tab: 'not-in-open', url: A } }, { ...tabs, front: { tab: 'tab-one-id', url: 'javascript:1' } }, { ...tabs, front: null }, { ...tabs, open: ['x'] }, { ...tabs, gen: 'x' }, { ...tabs, open: Array.from({ length: 33 }, (_, n) => `tab-id-${n}-x`) }]) assert.equal(readFollowEvent(bad, now), undefined, JSON.stringify(bad));
  for (const bad of [{ ...base, kind: 'watch' }, { ...base, kind: 'scroll', url: A, y: 1.5 }, { ...base, kind: 'scroll', url: 'javascript:1', y: 0 }, { ...base, kind: 'watch', on: true, sentAt: now - FOLLOW_SKEW - 1 }, { ...base, id: 'x', kind: 'watch', on: true }, { ...base, kind: 'cursor' }]) assert.equal(readFollowEvent(bad, now), undefined, JSON.stringify(bad));
});

test('followers renew on each heartbeat, keep when they started, leave on off or when the heartbeat stops', () => {
  let list = nextFollowers([], 'team', 'kai', true, 1000);
  assert.deepEqual(list, [{ teamId: 'team', personId: 'kai', since: 1000, until: 1000 + FOLLOW_WATCH_LIFE }]);
  list = nextFollowers(list, 'team', 'kai', true, 61_000);
  assert.deepEqual(list.map(item => [item.since, item.until]), [[1000, 61_000 + FOLLOW_WATCH_LIFE]]);
  assert.deepEqual(nextFollowers(list, 'team', 'kai', false, 62_000), []);
  assert.deepEqual(nextFollowers(list, 'team', 'mia', true, 61_000 + FOLLOW_WATCH_LIFE).map(item => item.personId), ['mia'], 'an expired follower drops out with the next event');
});

test('the shared page in front leads while someone follows; its scroll goes out once per report, and the follow tab scrolls only on the same page', async t => {
  const f = fixture(t);
  const views = [{ id: 'view-a', url: B }];
  f.bg.state = { authenticated: true, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], data: { views }, publishedViewing: { viewId: 'view-a', teamId: 'team', expiresAt: Date.now() + MINUTE_MS }, followers: [{ teamId: 'team', personId: 'kai', since: 0, until: Date.now() + MINUTE_MS }] };
  f.bg.activeTab = async () => ({ id: 7, url: B });
  const leader = { postMessage: message => f.pageMessages.push(message) }, info = { tabId: 7, windowId: 1, url: B };
  f.pagePorts.set(leader, info);
  const sent = [];
  f.bg.signals = { issueHostToken: () => ({ token: 'token', release() {} }) };
  f.bg.browser.runtime = { async sendMessage(message) { sent.push(message.command); return { ok: true }; } };
  await f.service.routeLead();
  assert.deepEqual(f.pageMessages, [{ type: 'lead', on: true }]);
  await f.service.routeLead();
  assert.equal(f.pageMessages.length, 1, 'unchanged lead is not sent again');
  await f.service.leadScrolled(leader, info, 0.5);
  assert.deepEqual(sent, [{ name: 'follow-scroll', payload: { teamId: 'team', url: B, y: 0.5, hostToken: 'token' } }]);
  f.bg.state = { ...f.bg.state, followers: [] };
  await f.service.routeLead();
  assert.deepEqual(f.pageMessages.at(-1), { type: 'lead', on: false });
  await f.service.leadScrolled(leader, info, 0.7);
  assert.equal(sent.length, 1, 'no follower, no scroll');

  // The follower side.
  f.pagePorts.clear(); f.pageMessages.length = 0;
  await f.service.request(1, { op: 'go', url: A, start: true, teamId: 'team', personId: 'mia' });
  const tabId = f.created(0);
  const follower = { postMessage: message => f.pageMessages.push(message) };
  f.pagePorts.set(follower, { tabId, windowId: 1, url: A });
  f.bg.state = { ...f.bg.state, leadScrolls: [{ teamId: 'team', personId: 'mia', url: B, y: 0.4, at: 1 }] };
  f.service.routeScroll();
  assert.deepEqual(f.pageMessages, [], 'another page does not scroll');
  f.bg.state = { ...f.bg.state, leadScrolls: [{ teamId: 'team', personId: 'mia', url: A, y: 0.4, at: 2 }] };
  f.service.routeScroll(); f.service.routeScroll();
  assert.deepEqual(f.pageMessages, [{ type: 'scroll-to', y: 0.4 }], 'the same page scrolls once per report');
  f.service.touched(follower, { tabId, windowId: 1, url: A });
  f.bg.state = { ...f.bg.state, leadScrolls: [{ teamId: 'team', personId: 'mia', url: A, y: 0.9, at: 3 }] };
  f.service.routeScroll();
  assert.equal(f.pageMessages.filter(message => message.type === 'scroll-to').length, 1, 'paused, the tab stays where you put it');
});
