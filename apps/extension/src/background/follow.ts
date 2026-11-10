import { SECOND_MS } from '@palside/shared/units';
import { pageKey } from '@palside/shared/navigation';
import { samePage } from '../domain/annotations/interaction.ts';
import { FOLLOW_LEAD_GRACE, FOLLOW_LEAD_OPEN, FOLLOW_TABS } from '../domain/annotations/follow.ts';
import { pageAsset,pageTeam } from '../runtime/browser/page-layer-host.ts';
import type { PageDown } from '../runtime/browser/page-protocol.ts';
import type { PageConnection } from '../runtime/browser/page-layer-host.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

/** What the panel asks: follow to a page (`start` opens the follow tab in front once), pause, continue, or end. */
export type FollowRequest = { op: 'go'; url: string; start?: boolean; teamId?: string; personId?: string; title?: string } | { op: 'pause' } | { op: 'resume'; url?: string } | { op: 'stop' };
/** What the panel shows: whether the follow tabs are waiting for you, or the follow ended because its last tab closed. */
export type FollowStatus = { paused: boolean; ended?: true };

/** A navigation we started settles within this time; address changes in it (redirects, a site tidying its URL) are not yours. */
const SETTLE_MS = 5 * SECOND_MS;
/** Tab switches this close together go out as one snapshot. */
const LEAD_SEND_MS = 250;
const STORE = 'palside:follow';
const LEAD_STORE = 'palside:follow-lead';

/** One of the teammate's tabs mirrored here. No `lead` yet: opened from their shared page, before their first snapshot named it. */
type FollowTab = { tabId: number; lead?: string; key?: string; settleUntil: number; usedAt: number; touched?: true };
type Follow = { windowId: number; since: number; tabs: FollowTab[]; paused: boolean; url?: string; title?: string; named?: string; teamId?: string; personId?: string; gen?: string; front?: string; scrolledAt?: number; groupId?: number; bringFront?: true };
/** This account's tabs that came to the front while someone followed it. Ids are random, and mean nothing outside this list. */
type Lead = { teamId: string; gen: string; tabs: { tabId: number; id: string }[]; front?: { tab: string; url: string }; followedAt: number };

const randomId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);

/**
 * 跟看: the tabs the followed teammate brings to the front are mirrored in a tab group in this panel's window. Their switching
 * tabs switches here while you are in the group, and only updates it from behind while you are on your own tab, so your tabs
 * never move and focus is taken only when you start or continue. A tab opens when it first comes to their front; going back
 * to it switches without a reload. Clicking, scrolling with the wheel, typing or navigating in a follow tab pauses (you took
 * over); continuing goes back to their page. Closing the last follow tab, the panel or switching squads ends it, and the tabs
 * stay as ordinary tabs. A teammate on an older version sends no snapshots: one tab then follows their shared page.
 * Everything is remembered in session storage so a restarted worker keeps the same tabs.
 */
export function follow(bg: Background) {
  const follows = new Map<number, Follow>();
  const leading = new WeakMap<Port, boolean>();
  let lead: Lead | undefined, leadSent: string | undefined, leadTimer: ReturnType<typeof setTimeout> | undefined;
  const loaded = bg.browser.storage.session?.get([STORE, LEAD_STORE]).then(value => {
    for (const item of (value?.[STORE] as Follow[] | undefined) ?? []) if (typeof item?.windowId === 'number' && Array.isArray(item.tabs)) follows.set(item.windowId, item);
    lead = value?.[LEAD_STORE] as Lead | undefined;
  }).catch(() => {}) ?? Promise.resolve();
  function save() { void bg.browser.storage.session?.set({ [STORE]: [...follows.values()] }).catch(() => {}); }
  function saveLead() { void bg.browser.storage.session?.set({ [LEAD_STORE]: lead ?? null }).catch(() => {}); }
  /** Tab operations run one at a time: two snapshots in a row must not open the same tab twice. */
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  }
  function report(item: Follow, ended = false) {
    const status: FollowStatus = ended ? { paused: item.paused, ended: true } : { paused: item.paused };
    for (const [port, windowId] of bg.panels) if (windowId === item.windowId) bg.post(port, { type: 'follow', status });
  }
  function byTab(tabId: number) {
    for (const item of follows.values()) { const tab = item.tabs.find(tab => tab.tabId === tabId); if (tab) return { item, tab }; }
  }
  /** The follow tabs' page layers listen for your own input there while following runs. */
  function tellPages(item: Follow) {
    for (const [port, info] of bg.pages.pagePorts) if (item.tabs.some(tab => tab.tabId === info.tabId)) post(port, { type: 'follow-tab', on: !item.paused });
  }
  function post(port: Port, message: PageDown) { try { port.postMessage(message); } catch { /* page gone */ } }
  function pause(item: Follow) {
    if (item.paused) return;
    item.paused = true; save(); report(item); tellPages(item);
  }
  /** Names the group once per name, with the optional 查看和管理您的标签页组; without it the group simply stays unnamed. */
  async function nameGroup(item: Follow) {
    if (item.groupId === undefined || !item.title || item.named === item.title) return;
    if (!await bg.browser.permissions.contains({ permissions: ['tabGroups'] }).catch(() => false)) return;
    try { await bg.browser.tabGroups.update(item.groupId, { title: item.title, color: 'green' }); item.named = item.title; save(); }
    catch { /* The group is gone; the next tab makes it again. */ }
  }
  /** Chrome keeps the tabs together without asking for any permission; a group the user dissolved is simply made again. */
  async function group(item: Follow, tabId: number) {
    const fresh = () => { item.named = undefined; return bg.browser.tabs.group({ tabIds: [tabId], createProperties: { windowId: item.windowId } }); };
    try { item.groupId = item.groupId === undefined ? await fresh() : await bg.browser.tabs.group({ tabIds: [tabId], groupId: item.groupId }).catch(fresh); }
    catch { /* Ungrouped still follows. */ }
    await nameGroup(item);
  }
  function ungroup(tabIds: number[]) { if (tabIds.length) void bg.browser.tabs.ungroup(tabIds as [number, ...number[]]).catch(() => {}); }
  /** Their tab closed. Yours to keep if you worked in it; the window's last tab stays, closing it would close the window. */
  async function closeTab(item: Follow, tab: FollowTab) {
    item.tabs = item.tabs.filter(other => other !== tab);
    if (tab.touched) { ungroup([tab.tabId]); return; }
    if ((await bg.browser.tabs.query({ windowId: item.windowId })).length > 1) await bg.browser.tabs.remove(tab.tabId).catch(() => {});
  }
  /** Sends a follow tab to a page, or opens one; the oldest goes when there are too many. */
  async function place(item: Follow, tab: FollowTab | undefined, lead: string | undefined, url: string, active: boolean) {
    const key = pageKey(url);
    if (!key) return;
    const found = tab && await bg.browser.tabs.get(tab.tabId).catch(() => undefined);
    if (follows.get(item.windowId) !== item) return;
    const now = Date.now();
    if (tab && found?.id !== undefined && found.windowId === item.windowId) {
      // Chrome shows the tab's address only for a granted site; otherwise the last page we sent it to stands in.
      const there = found.url ? pageKey(found.url) === key : tab.key === key;
      if (lead) tab.lead = lead;
      tab.key = key; tab.usedAt = now;
      if (!there) tab.settleUntil = now + SETTLE_MS;
      if (!there || active) await bg.browser.tabs.update(tab.tabId, { ...(there ? {} : { url }), ...(active ? { active: true } : {}) });
      return;
    }
    if (tab) item.tabs = item.tabs.filter(other => other !== tab);
    const created = await bg.browser.tabs.create({ url, windowId: item.windowId, active });
    if (created.id === undefined) return;
    item.tabs.push({ tabId: created.id, ...(lead ? { lead } : {}), key, settleUntil: now + SETTLE_MS, usedAt: now });
    await group(item, created.id);
    while (item.tabs.length > FOLLOW_TABS) {
      const oldest = item.tabs.filter(other => other.tabId !== created.id).sort((a, b) => a.usedAt - b.usedAt)[0];
      if (!oldest) break;
      await closeTab(item, oldest);
    }
  }
  /** Brings the tabs in line with the teammate's latest snapshot. Saying the same thing again changes nothing. */
  async function applyLead(item: Follow) {
    const state = bg.state, snapshot = state?.leadTabs?.find(value => value.teamId === item.teamId && value.personId === item.personId && value.teamId === pageTeam(state));
    if (item.paused || !snapshot || snapshot.at < item.since) return;
    const open = new Set(snapshot.open), restarted = item.gen !== undefined && item.gen !== snapshot.gen;
    for (const tab of [...item.tabs]) {
      if (!tab.lead || open.has(tab.lead)) continue;
      // A new list says nothing about these: they were not closed, the teammate just started over. They stay, as your own.
      if (restarted) { item.tabs = item.tabs.filter(other => other !== tab); ungroup([tab.tabId]); } else await closeTab(item, tab);
    }
    item.gen = snapshot.gen;
    const front = snapshot.front, changed = front?.tab !== item.front, key = front && pageKey(front.url);
    if (front && key) {
      const tab = item.tabs.find(other => other.lead === front.tab) ?? item.tabs.find(other => other.lead === undefined);
      // A tab you closed comes back only when they go to it again.
      if (changed || item.bringFront || tab && tab.key !== key) {
        const here = (await bg.activeTab(item.windowId))?.id;
        await place(item, tab, front.tab, front.url, Boolean(item.bringFront) || changed && item.tabs.some(other => other.tabId === here));
        delete item.bringFront;
      }
      item.front = front.tab; item.url = front.url;
    }
    if (follows.get(item.windowId) === item) { save(); tellPages(item); }
  }
  function end(windowId: number, tellPanel: boolean) {
    const item = follows.get(windowId);
    if (!item) return;
    follows.delete(windowId); save();
    item.paused = true; tellPages(item);
    ungroup(item.tabs.map(tab => tab.tabId));
    if (tellPanel) report(item, true);
  }

  /** Who hears the snapshot changes when followers come or renew, so a late follower and a lost message both catch up. */
  function sendLead(followers: readonly { personId: string; until: number }[]) {
    if (!lead) return;
    const { teamId, gen } = lead;
    const sign = JSON.stringify([gen, lead.tabs.map(tab => tab.id), lead.front ?? null, followers.map(item => [item.personId, item.until])]);
    if (sign === leadSent) return;
    leadSent = sign;
    bg.clearTimeout(leadTimer);
    leadTimer = bg.setTimeout(() => {
      leadTimer = undefined;
      if (lead?.gen !== gen || pageTeam(bg.state) !== teamId) return;
      const host = bg.signals.issueHostToken(async () => lead?.gen === gen && pageTeam(bg.state) === teamId);
      if (!host) { leadSent = undefined; return; }
      const payload = { teamId, gen, open: lead.tabs.map(tab => tab.id), ...(lead.front ? { front: lead.front } : {}), hostToken: host.token };
      void bg.browser.runtime.sendMessage({ target: 'palside/offscreen', command: { name: 'follow-tabs', payload } })
        .catch(() => { leadSent = undefined; })
        .finally(() => host.release());
    }, LEAD_SEND_MS);
  }
  /** Records the tab in front while it shows the shared page; a tab that never comes to the front is never mentioned. */
  async function trackLead(teamId: string | undefined, followers: readonly { personId: string; until: number }[], shared: string | undefined) {
    const state = bg.state, now = Date.now();
    if (lead && (lead.teamId !== teamId || !followers.length && now - lead.followedAt > FOLLOW_LEAD_GRACE)) { lead = undefined; leadSent = undefined; saveLead(); }
    if (!followers.length || !teamId) return;
    lead ??= { teamId, gen: randomId(), tabs: [], followedAt: now };
    lead.followedAt = now;
    if (shared) for (const windowId of new Set(bg.panels.values())) {
      const tab = windowId === undefined ? undefined : await bg.activeTab(windowId);
      if (!lead || tab?.id === undefined || !tab.url || !samePage(shared, tab.url, pageAsset(shared, state), pageAsset(tab.url, state))) continue;
      let known = lead.tabs.find(item => item.tabId === tab.id);
      if (!known) { known = { tabId: tab.id, id: randomId() }; lead.tabs = [...lead.tabs, known].slice(-FOLLOW_LEAD_OPEN); }
      lead.front = { tab: known.id, url: shared };
      break;
    }
    saveLead(); sendLead(followers);
  }

  return {
    ready: loaded,
    /** A panel's request, for that panel's own window. */
    async request(windowId: number, request: FollowRequest) {
      await loaded;
      if (![...bg.panels.values()].includes(windowId)) return;
      if (request.op === 'stop') { end(windowId, false); return; }
      await serial(async () => {
        let item = follows.get(windowId);
        if (request.op === 'go') {
          // Following someone else starts over: what was open stays as your own tabs.
          if (item && request.personId && item.personId && item.personId !== request.personId) { end(windowId, false); item = undefined; }
          if (!item) { item = { windowId, since: Date.now(), tabs: [], paused: false }; follows.set(windowId, item); }
          if (request.teamId && request.personId) { item.teamId = request.teamId; item.personId = request.personId; }
          if (request.title) { item.title = request.title; await nameGroup(item); }
          item.url = request.url;
          // Once the teammate's snapshots name the tabs, those decide; their shared page moves the one tab only until then.
          if (item.gen === undefined && !item.paused) await place(item, item.tabs.find(tab => tab.lead === undefined), undefined, request.url, Boolean(request.start));
          if (follows.get(windowId) === item) { save(); tellPages(item); await applyLead(item); }
        } else if (!item) return;
        else if (request.op === 'pause') pause(item);
        else {
          item.paused = false; item.tabs.forEach(tab => { delete tab.touched; }); report(item);
          const url = request.url ?? item.url ?? '';
          if (item.gen === undefined) { if (url) await place(item, item.tabs[0], undefined, url, true); } else {
            // Their next snapshot says which tab is in front; the page you know of is shown meanwhile, if one is open.
            item.bringFront = true;
            const key = url ? pageKey(url) : undefined, known = key ? item.tabs.find(tab => tab.key === key) : undefined;
            if (known) await bg.browser.tabs.update(known.tabId, { active: true });
          }
          if (follows.get(windowId) === item) { save(); tellPages(item); }
        }
      });
    },
    /** A follow tab moved: ours settles, a site moving a tab behind you is its own business, yours pauses. */
    tabNavigated(tabId: number, change: { url?: string }, chromeTab?: { active?: boolean }) {
      const found = byTab(tabId);
      if (!found || found.item.paused || change.url === undefined || chromeTab?.active === false) return;
      if (pageKey(change.url) === found.tab.key || Date.now() < found.tab.settleUntil) return;
      found.tab.touched = true;
      pause(found.item);
    },
    /** A tab closed: maybe one of this account's own, maybe one you closed in the group. Closing the last one ends following. */
    tabClosed(tabId: number) {
      if (lead?.tabs.some(item => item.tabId === tabId)) {
        const id = lead.tabs.find(item => item.tabId === tabId)?.id;
        lead.tabs = lead.tabs.filter(item => item.tabId !== tabId);
        if (lead.front?.tab === id) delete lead.front;
        saveLead();
        const teamId = lead.teamId, now = Date.now();
        sendLead((bg.state?.followers ?? []).filter(item => item.teamId === teamId && item.until > now));
      }
      const found = byTab(tabId);
      if (!found) return;
      found.item.tabs = found.item.tabs.filter(tab => tab !== found.tab);
      if (found.item.tabs.length) save(); else end(found.item.windowId, true);
    },
    /** The last panel of a window closed: following was that panel's. The tabs stay as ordinary tabs. */
    panelClosed(windowId: number) { end(windowId, false); },
    /** You clicked, scrolled or typed in a follow tab. */
    touched(_port: Port, info: PageConnection) { const found = byTab(info.tabId); if (found) { found.tab.touched = true; pause(found.item); } },
    pageConnected(port: Port, info: PageConnection) { const found = byTab(info.tabId); if (found) post(port, { type: 'follow-tab', on: !found.item.paused }); },
    /** The followed teammate's tabs changed. */
    async routeTabs() { await loaded; await serial(async () => { for (const item of follows.values()) await applyLead(item); }); },
    /** Where the followed teammates scrolled: a follow tab showing the same page follows while following runs. */
    routeScroll() {
      const state = bg.state;
      for (const item of follows.values()) {
        if (item.paused || !item.tabs.length || !item.personId) continue;
        const scroll = state?.leadScrolls?.find(value => value.teamId === item.teamId && value.personId === item.personId && value.teamId === pageTeam(state));
        if (!scroll || scroll.at === item.scrolledAt) continue;
        for (const [port, info] of bg.pages.pagePorts) {
          if (!item.tabs.some(tab => tab.tabId === info.tabId) || !samePage(scroll.url, info.url, pageAsset(scroll.url, state), info.asset)) continue;
          item.scrolledAt = scroll.at;
          post(port, { type: 'scroll-to', y: scroll.y });
        }
      }
    },
    /** Pages that lead: someone follows this account, and the page is the one it shares, in front of a window with a panel. */
    async routeLead() {
      await loaded;
      const state = bg.state, teamId = pageTeam(state), now = Date.now();
      const followers = teamId ? (state?.followers ?? []).filter(item => item.teamId === teamId && item.until > now) : [];
      const followed = followers.length > 0;
      const shared = state?.publishedViewing?.teamId === teamId ? state?.data.views.find(view => view.id === state.publishedViewing?.viewId)?.url : undefined;
      await Promise.all([...bg.pages.pagePorts].map(async ([port, info]) => {
        let on = false;
        if (followed && shared && samePage(shared, info.url, pageAsset(shared, state), info.asset) && [...bg.panels.values()].includes(info.windowId)) on = (await bg.activeTab(info.windowId))?.id === info.tabId;
        if (leading.get(port) === on) return;
        leading.set(port, on);
        post(port, { type: 'lead', on });
      }));
      await serial(() => trackLead(teamId, followers, shared));
    },
    /** The leading page scrolled: through a one-time host token the offscreen document re-checks before it relays. */
    async leadScrolled(port: Port, info: PageConnection, y: number) {
      if (!leading.get(port) || !Number.isFinite(y) || y < 0 || y > 1) return;
      const teamId = pageTeam(bg.state), url = info.url;
      if (!teamId) return;
      const canSend = async () => Boolean(leading.get(port) && bg.pages.pagePorts.get(port) === info && info.url === url && pageTeam(bg.state) === teamId && (await bg.activeTab(info.windowId))?.id === info.tabId);
      const host = bg.signals.issueHostToken(canSend);
      if (!host) return;
      try { await bg.browser.runtime.sendMessage({ target: 'palside/offscreen', command: { name: 'follow-scroll', payload: { teamId, url, y, hostToken: host.token } } }); }
      catch { /* a lost scroll is replaced by the next */ }
      finally { host.release(); }
    },
    sendStatus(port: Port, windowId: number) { const item = follows.get(windowId); if (item) bg.post(port, { type: 'follow', status: { paused: item.paused } }); },
  };
}
