import { MessageError,message as uiMessage } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { PAGE_SCRIPT_ID,pageAsset,pageDiff,pageMatches,pageScript,pageStatus,pageUrlHost,updatePageUrl,locateResponse,type PageConnection } from '../runtime/browser/page-layer-host.ts';
import type { LocateResult,PageDown,PageUp } from '../runtime/browser/page-protocol.ts';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import { pageScopeUrl } from '../domain/annotations/interaction.ts';
import type { Background } from './index.ts';
import type { Port,Tab } from './context.ts';


/**
 * Page scripts on the `palside/page` port. A page runs while 网页互动 is on for an 已授权网站 (registered for every tab of the
 * site), for a one-off action (locate: admitted in memory for this tab's page only), or for a running capture.
 */
export function pages(bg: Background) {
  const { browser } = bg;
  const pagePorts = new Map<Port, PageConnection>();
  /** One-off page actions admit this tab's current page without making it interactive. Memory only: navigation, context or permission changes end it. */
  type Lease = { timer?: ReturnType<typeof setTimeout> };
  const oneOffPages = new Map<number, { url: string; windowId: number; accountId: string; teamId: string; leases: Set<Lease> }>();
  function forgetOneOff(tabId: number) {
    const binding = oneOffPages.get(tabId);
    if (binding) for (const lease of binding.leases) bg.clearTimeout(lease.timer);
    oneOffPages.delete(tabId);
  }
  function releaseUnused(tabId: number) {
    const binding = oneOffPages.get(tabId);
    if (binding?.leases.size) return;
    forgetOneOff(tabId);
    for (const [port, info] of pagePorts) if (info.tabId === tabId && !allowedPage(info) && !bg.capture.capturePageAllowed(info)) stopPage(port, info);
    void pushPageStatus();
  }
  function endActions(windowId: number) {
    for (const [tabId, binding] of oneOffPages) if (binding.windowId === windowId) {
      for (const lease of binding.leases) { bg.clearTimeout(lease.timer); binding.leases.delete(lease); }
      releaseUnused(tabId);
    }
  }
  const restoring = new Map<number, Promise<void>>();
  const locating = new Map<string, { port: Port; resolve: (value: LocateResult) => void }>();
  let registration = Promise.resolve();
  let registrationKey: string | undefined;
  let statusVersion = 0;
  let permissionSync = Promise.resolve();

  const inject = (tabId: number) => browser.scripting.executeScript({ target: { tabId }, files: ['/page-layer.js'] });
  const sleep = (ms: number) => new Promise(resolve => bg.setTimeout(resolve, ms));

  function portFor(tabId: number, url: string, windowId?: number) {
    return [...pagePorts].find(([, info]) => info.tabId === tabId && info.url === url && (windowId === undefined || info.windowId === windowId))?.[0];
  }
  /** A one-off action admitted this exact page for the current account and team. */
  function oneOffPage(info: { tabId: number; url: string }) {
    const binding = oneOffPages.get(info.tabId), url = pageScopeUrl(info.url);
    return Boolean(url && binding && [...bg.panels.values()].includes(binding.windowId) && binding.url === url && binding.accountId === bg.state?.account?.id && binding.teamId === bg.state?.preferences.current && bg.teamAvailable());
  }
  function allowedPage(info: { tabId: number; windowId: number; url: string }) {
    return bg.interactivePage(info) || bg.danmaku.allows(info) || oneOffPage(info);
  }
  function stopPage(port: Port, info: PageConnection) {
    if (bg.selection.picks.get(info.windowId)?.tabId === info.tabId) bg.selection.discardPick(info.windowId);
    bg.danmaku.forget(port);
    for (const waiter of locating.values()) if (waiter.port === port) waiter.resolve('unavailable');
    if (bg.capture.captures.get(info.windowId)?.page === port) bg.capture.discardCapture(info.windowId);
    pagePorts.delete(port);
    try { port.postMessage({ type: 'off' } satisfies PageDown); } catch { /* page gone */ }
  }
  /** Every page session ends: account, team or origin access changed. */
  function clearPages() {
    for (const tabId of oneOffPages.keys()) forgetOneOff(tabId);
    bg.selection.clearSelections();
    bg.stickies.clearPendingStickies();
    bg.danmaku.clear();
    for (const windowId of bg.capture.captures.keys()) bg.capture.discardCapture(windowId);
    for (const [port, info] of pagePorts) {
      try { port.postMessage({ type: 'clear' } satisfies PageDown); } catch { /* page gone */ }
      stopPage(port, info);
    }
    for (const waiter of locating.values()) waiter.resolve('unavailable');
  }

  /** Bring the active tab of a window up to its policy: bind a connected page, or inject the page layer where 互动 runs. */
  async function restoreActivePage(windowId: number) {
    if (!bg.state?.authenticated || !bg.state.account?.id) return;
    const current = restoring.get(windowId);
    if (current) return current;
    const version = bg.policyVersion;
    const job = (async () => {
      await Promise.all([bg.signals.signalsReady, bg.danmaku.ready]);
      const accountId = bg.state?.account?.id, teamId = bg.state?.preferences.current;
      const valid = () => version === bg.policyVersion && bg.state?.account?.id === accountId && bg.state?.preferences.current === teamId && bg.state?.authenticated;
      const tab = await bg.activeTab(windowId);
      if (!valid() || !tab?.url || tab.id === undefined || tab.incognito || tab.status === 'loading' || !allowedPage({ tabId: tab.id, windowId, url: tab.url })) return;
      if (!(await accessStatus(tab.url, browser)).site || !valid()) return;
      const tabVersion = bg.tabVersions.get(tab.id);
      const active = await bg.activeTab(windowId);
      if (bg.tabVersions.get(tab.id) !== tabVersion || !valid() || active?.id !== tab.id || active.url !== tab.url || active.status === 'loading' || !allowedPage({ tabId: tab.id, windowId, url: tab.url })) return;
      const port = portFor(tab.id, tab.url);
      if (port) { bg.selection.bindSelection(port, pagePorts.get(port)!); void bg.stickies.pushStickies(port, pagePorts.get(port)!); return; }
      await inject(tab.id).catch(() => {});
    })();
    restoring.set(windowId, job);
    try { await job; } finally { if (restoring.get(windowId) === job) restoring.delete(windowId); }
  }
  function restoreAllPages() {
    for (const windowId of new Set(bg.panels.values())) if (windowId !== undefined) void restoreActivePage(windowId).catch(() => {});
  }

  /** Registers the page layer on every 已授权网站 while 网页互动 runs, and injects it into tabs already open there. Serialized. */
  function registerPageLayer() {
    const next = registration.catch(() => {}).then(updateRegistration);
    registration = next;
    return next;
  }
  async function updateRegistration() {
    const version = bg.policyVersion;
    const valid = () => version === bg.policyVersion;
    await Promise.all([bg.signals.signalsReady, bg.danmaku.ready]);
    if (!valid()) return;
    const origins = (await browser.permissions.getAll()).origins ?? [];
    if (!valid()) return;
    const matches = pageMatches(bg.state, origins, bg.danmaku.enabled() && Boolean(bg.state?.rooms?.current) && bg.panels.size > 0);
    const script = matches.length ? pageScript(matches) : undefined;
    const key = JSON.stringify(script ?? null);
    if (key === registrationKey) return;
    const ids = { ids: [PAGE_SCRIPT_ID] };
    try { await browser.scripting.unregisterContentScripts(ids); }
    catch (error) { if ((await browser.scripting.getRegisteredContentScripts(ids)).length) throw error; }
    registrationKey = undefined;
    if (!valid()) return;
    if (script) {
      await browser.scripting.registerContentScripts([script]);
      if (!valid()) { await browser.scripting.unregisterContentScripts(ids); return; }
    }
    registrationKey = key;
    if (!script) return;
    for (const tab of await browser.tabs.query({ url: matches })) {
      if (!valid()) return;
      if (tab.id === undefined || !tab.url || tab.incognito || tab.status === 'loading' || !allowedPage({ tabId: tab.id, windowId: tab.windowId, url: tab.url }) || portFor(tab.id, tab.url)) continue;
      const access = await accessStatus(tab.url, browser);
      if (!valid()) return;
      if (!access.site) continue;
      const current = await browser.tabs.get(tab.id).catch(() => undefined);
      if (!valid()) return;
      if (current?.url === tab.url && current.status !== 'loading' && !current.incognito) await inject(tab.id).catch(() => {});
    }
  }

  /** Every panel gets its window's `PageStatus`; the newest push wins. */
  async function pushPageStatus() {
    const version = ++statusVersion;
    await Promise.all([bg.signals.signalsReady, bg.danmaku.ready]);
    for (const [panel, windowId] of bg.panels) {
      if (windowId === undefined) continue;
      const tab = await bg.activeTab(windowId);
      const access = await bg.capture.tabAccess(tab);
      const favicon = tab?.url ? await bg.favicon(tab.url) : undefined;
      if (version !== statusVersion || bg.panels.get(panel) !== windowId) return;
      const status = pageStatus(windowId, tab && { ...tab, favicon }, [...pagePorts.values()], access, bg.state);
      status.signalSettings = bg.signals.signalSettings();
      bg.post(panel, { type: 'page', status });
    }
  }

  function resetPage(port: Port, info: PageConnection, url: string) {
    if (info.url === url) {
      // The page clears its overlays before this handshake, even when Chrome's URL event arrived first.
      bg.stickies.forgetStickies(port);
      void refreshPage(port, info).catch(() => {});
      return;
    }
    // A document can change its route, never its origin. Cross-origin navigation needs a fresh port and permission check.
    try { if (new URL(info.url).origin !== new URL(url).origin) { forgetOneOff(info.tabId); stopPage(port, info); return; } } catch { stopPage(port, info); return; }
    if (bg.capture.captures.get(info.windowId)?.tabId === info.tabId) bg.capture.discardCapture(info.windowId);
    if (bg.selection.picks.get(info.windowId)?.tabId === info.tabId) bg.selection.discardPick(info.windowId);
    if (pageScopeUrl(info.url) !== pageScopeUrl(url)) forgetOneOff(info.tabId);
    if (!allowedPage({ ...info, url })) { stopPage(port, info); void pushPageStatus(); return; }
    bg.danmaku.forget(port);
    updatePageUrl(info, url, bg.state);
    bg.danmaku.syncPage(port, info);
    bg.stickies.forgetStickies(port);
    bg.selection.bindSelection(port, info);
    void bg.signals.signalConfig(port, info).catch(() => {});
    void bg.stickies.pushStickies(port, info);
    void pushPageStatus();
  }
  /** Re-apply the page's current policy to a live port: selection, signals and 便利贴 follow the site's 互动 at once. */
  async function refreshPage(port: Port, info: PageConnection) {
    bg.danmaku.syncPage(port, info);
    void bg.signals.signalConfig(port, info).catch(() => {});
    void bg.stickies.pushStickies(port, info);
    const active = await bg.activeTab(info.windowId);
    if (pagePorts.get(port) === info && active?.id === info.tabId && active.url === info.url) bg.selection.bindSelection(port, info);
  }
  /** New live danmaku and reference flashes go to the pages they belong to. */
  async function routePageState(old: RuntimeState | undefined, next: RuntimeState) {
    for (const [port, info] of pagePorts) { info.asset = pageAsset(info.url, bg.state); bg.danmaku.syncPage(port, info); void bg.stickies.pushStickies(port, info); }
    for (const item of pageDiff(old, next, [...pagePorts.values()])) {
      const port = [...pagePorts].find(([, info]) => info === item.port)?.[0];
      if (!port) continue;
      const url = item.port.url, version = bg.sessionVersion;
      const valid = () => version === bg.sessionVersion && bg.state?.account?.id === next.account?.id && bg.state?.authenticated && bg.state.preferences.current === next.preferences.current && allowedPage(item.port) && pagePorts.get(port) === item.port && item.port.url === url;
      const interactive = bg.interactivePage(item.port);
      for (const flash of interactive ? item.flashes : []) {
        const target = flash.ref!.target;
        if (target.kind === 'danmaku') continue;
        const author = await bg.pagePerson(flash.author);
        if (!valid()) break;
        try { port.postMessage({ type: 'flash', target, author } satisfies PageDown); } catch { break; }
      }
    }
  }

  /** Waits for this tab's page script to connect after an injection. */
  async function waitForPort(windowId: number, tabId: number, url: string, alive: () => boolean, timeout = 8000) {
    const until = Date.now() + timeout;
    while (alive() && Date.now() < until) {
      const port = portFor(tabId, url, windowId);
      if (port) return port;
      await sleep(50);
    }
  }
  /** Connect this window's active page for one action. A page without 互动 is admitted only as a one-off, which never turns its interaction on. */
  async function openPageTools(windowId: number, senderUrl: string, action: 'pick') {
    const accountId = bg.state?.account?.id, teamId = bg.state?.preferences.current, version = bg.sessionVersion;
    const tab = (await bg.panelTab(windowId, senderUrl))?.tab;
    await bg.capture.requirePageAction(tab, action);
    const scope = pageScopeUrl(tab?.url);
    if (version !== bg.sessionVersion || !tab?.url || !scope || tab.id === undefined || !accountId || !teamId || !bg.teamAvailable() || accountId !== bg.state?.account?.id || teamId !== bg.state.preferences.current) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
    const tabId = tab.id, url = tab.url, tabVersion = bg.tabVersions.get(tabId);
    let binding = oneOffPages.get(tabId);
    const lease: Lease = {};
    if (!bg.interactivePage(tab)) {
      if (binding?.url !== scope) { forgetOneOff(tabId); binding = undefined; }
      if (!binding) { binding = { url: scope, windowId, accountId, teamId, leases: new Set() }; oneOffPages.set(tabId, binding); }
      binding.leases.add(lease);
    }
    // Each concurrent action owns its own lease. Completion never releases a newer action.
    const finish = (delay = 0) => {
      bg.clearTimeout(lease.timer);
      const release = () => {
        if (!binding || oneOffPages.get(tabId) !== binding || !binding.leases.delete(lease)) return;
        releaseUnused(tabId);
      };
      if (binding && oneOffPages.get(tabId) === binding && binding.leases.has(lease) && delay > 0) lease.timer = bg.setTimeout(release, delay);
      else release();
    };
    finish(30_000); // Includes injection and a bounded wait for the action.
    const admitted = () => bg.tabVersions.get(tabId) === tabVersion && version === bg.sessionVersion && bg.state?.account?.id === accountId && bg.state?.preferences.current === teamId && allowedPage({ tabId, windowId, url });
    try {
      const before = await bg.activeTab(windowId);
      if (!admitted() || before?.id !== tabId || before.url !== url || before.status === 'loading') throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      try { if (!portFor(tabId, url)) await inject(tabId); }
      catch { return await bg.capture.pageActionFailure(tab, action); }
      const port = await waitForPort(windowId, tabId, url, admitted);
      if (!admitted()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      if (!port) throw new MessageError(uiMessage('extension.runtime.pageActionFailed'));
      const active = await bg.activeTab(windowId);
      if (!admitted() || active?.id !== tabId || active.url !== url || active.status === 'loading') throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      return { tab, port, info: pagePorts.get(port)!, accountId, teamId, finish };
    } catch (error) { finish(); throw error; }
  }
  /** Ask a page to find a target; it answers `located`, or `unavailable` after five seconds or when the page goes. */
  function locate(port: Port, message: Extract<PageDown, { type: 'flash' }>) {
    const requestId = crypto.randomUUID();
    const result = new Promise<LocateResult>(resolve => {
      const timer = bg.setTimeout(() => finish('unavailable'), 5000);
      function finish(value: LocateResult) { bg.clearTimeout(timer); locating.delete(requestId); resolve(value); }
      locating.set(requestId, { port, resolve: finish });
    });
    port.postMessage({ ...message, requestId, focus: true } satisfies PageDown);
    return result;
  }

  /** A page script connects: admit it under the current policy, then send its config, signals, notes and selection. */
  function connectPage(port: Port) {
    const tab = port.sender?.tab, tabId = tab?.id, windowId = tab?.windowId, url = tab?.url;
    if (port.sender?.id !== browser.runtime.id || tab?.incognito || (port.sender?.frameId !== undefined && port.sender.frameId !== 0) || tabId === undefined || windowId === undefined || !url || !pageUrlHost(url)) { try { port.disconnect(); } catch { /* already closed */ } return; }
    let disconnected = false;
    const off = () => port.postMessage({ type: 'off' } satisfies PageDown);
    void (async () => {
      await Promise.all([bg.signals.signalsReady, bg.danmaku.ready]);
      const tabVersion = bg.tabVersions.get(tabId), version = bg.sessionVersion, accountId = bg.state?.account?.id, teamId = bg.state?.preferences.current, access = await accessStatus(url, browser);
      const valid = () => !disconnected && bg.tabVersions.get(tabId) === tabVersion && version === bg.sessionVersion && accountId === bg.state?.account?.id && teamId === bg.state?.preferences.current && bg.state?.authenticated && (allowedPage({ tabId, windowId, url }) || bg.capture.capturePageAllowed({ tabId, windowId, url }));
      if (!(access.site || bg.capture.capturePageAllowed({ tabId, windowId, url })) || !valid()) { off(); return; }
      const current = await browser.tabs.get(tabId).catch(() => undefined);
      if (!valid() || !current || current.url !== url || current.status === 'loading' || current.incognito) { off(); return; }
      const capture = bg.capture.captures.get(windowId);
      const active = await bg.activeTab(windowId);
      if (!valid()) { off(); return; }
      const info: PageConnection = { tabId, windowId, url, asset: pageAsset(url, bg.state), documentId: port.sender?.documentId, siteGranted: access.site };
      for (const [existing, connection] of pagePorts) if (connection.tabId === tabId && existing !== port) stopPage(existing, connection);
      const connected = pagePorts.get(port);
      if (connected && connected.url === url && connected.documentId === info.documentId) return;
      pagePorts.set(port, info);
      if (capture && capture.tabId === tabId && capture.url === url && !capture.page) capture.page = port;
      const config = await bg.danmaku.pageConfig();
      const live = () => valid() && pagePorts.get(port) === info;
      if (!live()) { if (pagePorts.get(port) === info) stopPage(port, info); return; }
      port.postMessage(config);
      bg.danmaku.syncPage(port, info);
      void bg.signals.signalConfig(port, info).catch(() => {});
      await bg.stickies.pushStickies(port, info);
      if (!live()) { if (pagePorts.get(port) === info) stopPage(port, info); return; }
      if (active?.id === tabId && active.url === url) bg.selection.bindSelection(port, info);
      void pushPageStatus();
    })().catch(() => { if (bg.capture.captures.get(windowId)?.page === port) bg.capture.discardCapture(windowId); pagePorts.delete(port); });

    port.onMessage.addListener((message: PageUp) => {
      const info = pagePorts.get(port);
      if (!info) return;
      if (!bg.state?.authenticated || !allowedPage(info) && !bg.capture.capturePageAllowed(info)) { stopPage(port, info); return; }
      switch (message.type) {
        case 'located': { const waiter = locating.get(message.requestId); if (waiter?.port === port) waiter.resolve(locateResponse(message.requestId, message) ?? 'unavailable'); break; }
        case 'url':
          resetPage(port, info, message.url);
          void bg.activeTab(info.windowId).then(active => { if (pagePorts.get(port) === info && active?.id === info.tabId && active.url === info.url) bg.selection.bindSelection(port, info); }).catch(() => {});
          break;
        case 'signal-send': void bg.signals.sendPageSignal(port, info, message).catch(() => {}); break;
        case 'stickies-located': bg.stickies.stickiesLocated(info, message.missing); void pushPageStatus(); break;
        case 'pick-error': bg.selection.pickError(info, message); break;
        case 'picked': case 'marked': void bg.selection.finishPick(port, info, message).catch(() => {}); break;
        case 'captured': case 'capture-cancel': bg.capture.captureDone(port, info, message); break;
        case 'open-room': bg.danmaku.openRoom(port, info, message.key); break;
        case 'open-panel': void browser.sidePanel.open({ windowId: info.windowId }).catch(() => {}); break;
        case 'open-sticky': bg.stickies.openStickyFromPage(info, message.id); break;
      }
    });
    port.onDisconnect.addListener(() => {
      disconnected = true;
      const connection = pagePorts.get(port);
      if (connection) { forgetOneOff(tabId); stopPage(port, connection); }
      const pick = bg.selection.picks.get(windowId);
      if (pick?.tabId === tabId && (!pick.documentId || pick.documentId === port.sender?.documentId)) bg.selection.discardPick(windowId);
      const capture = bg.capture.captures.get(windowId);
      if (capture && (capture.page === port || !capture.page && capture.tabId === tabId && capture.url === url)) bg.capture.discardCapture(windowId);
      pagePorts.delete(port);
      void pushPageStatus();
    });
  }

  return {
    pagePorts, endActions, portFor, waitForPort, allowedPage, stopPage, clearPages, restoreActivePage, restoreAllPages, registerPageLayer, pushPageStatus, routePageState, openPageTools, locate, connectPage,
    /** Which pages may run changed. A context change (account, team) ends every session; a rule change re-checks each page. */
    pagePolicyChanged(contextChanged: boolean) {
      bg.policyVersion++;
      restoring.clear();
      if (contextChanged) { bg.sessionVersion++; clearPages(); }
      else {
        // A site that gains 互动 covers its one-off pages; one that loses it takes its pages down at once.
        for (const [tabId, binding] of oneOffPages) if (bg.interactivePage(binding)) forgetOneOff(tabId);
        for (const binding of oneOffPages.values()) if (![...bg.panels.values()].includes(binding.windowId)) endActions(binding.windowId);
        bg.selection.dropSelections(context => !bg.interactivePage(context));
        for (const [port, info] of pagePorts) if (!allowedPage(info) && !bg.capture.capturePageAllowed(info)) stopPage(port, info);
        for (const [port, info] of pagePorts) void refreshPage(port, info).catch(() => {});
      }
      void registerPageLayer().catch(() => {});
    },
    /** Chrome grants changed: drop what lost access, then re-register and restore. Origin changes also end page sessions. */
    syncPermissions(originsChanged: boolean) {
      bg.policyVersion++;
      if (originsChanged) bg.sessionVersion++;
      restoring.clear();
      const granted = async (url: string) => (await accessStatus(url, browser)).site;
      permissionSync = permissionSync.catch(() => {}).then(async () => {
        await Promise.all([bg.signals.signalsReady, bg.danmaku.ready]);
        for (const [tabId, binding] of oneOffPages) if (!await granted(binding.url)) forgetOneOff(tabId);
        for (const [windowId, pick] of bg.selection.picks) if (!await granted(pick.url)) bg.selection.discardPick(windowId);
        // An activeTab capture holds its page without a site grant.
        for (const [windowId, session] of bg.capture.captures) if (!session.active && !await granted(session.url)) bg.capture.discardCapture(windowId);
        for (const [port, info] of pagePorts) if (!await granted(info.url) && !bg.capture.capturePageAllowed(info)) stopPage(port, info);
        await bg.sharing.observer.refresh();
        await registerPageLayer();
        await pushPageStatus();
        restoreAllPages();
      });
      void permissionSync.catch(() => {});
    },
    /** A tab navigated or started loading: its document-bound work ends, and a new address may leave a one-off page. */
    tabNavigated(tabId: number, change: { url?: string; status?: string }, tab: Tab) {
      if (change.url || change.status === 'loading') {
        bg.tabVersions.set(tabId, (bg.tabVersions.get(tabId) ?? 0) + 1);
        restoring.delete(tab.windowId);
        const binding = oneOffPages.get(tabId);
        if (binding && (change.status === 'loading' || change.url && binding.url !== pageScopeUrl(change.url))) forgetOneOff(tabId);
        bg.selection.dropSelections(pick => pick.tabId === tabId);
        if (change.status === 'loading') for (const [port, info] of pagePorts) if (info.tabId === tabId) stopPage(port, info);
      }
      if (change.url) for (const [port, info] of pagePorts) if (info.tabId === tabId) resetPage(port, info, change.url);
      if (tab.active && (change.status === 'complete' || change.url && change.status !== 'loading')) void restoreActivePage(tab.windowId).catch(() => {});
      void pushPageStatus();
    },
    tabClosed(tabId: number) {
      bg.danmaku.forgetTab(tabId);
      bg.tabVersions.set(tabId, (bg.tabVersions.get(tabId) ?? 0) + 1);
      forgetOneOff(tabId);
      for (const [port, info] of pagePorts) if (info.tabId === tabId) stopPage(port, info);
      bg.selection.dropSelections(pick => pick.tabId === tabId);
      void pushPageStatus();
    },
  };
}
