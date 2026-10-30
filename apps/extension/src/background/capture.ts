import { MessageError,errorMessage,message as uiMessage } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { pageCapabilities,type CapabilityAccess } from '../runtime/browser/page-capabilities.ts';
import type { PageAction,PageDown } from '../runtime/browser/page-protocol.ts';
import type { Background } from './index.ts';
import type { Port,Tab } from './context.ts';

/** `active`: capture has a known activeTab grant, including when the site is also granted. */
type CaptureSession = { tabId: number; url: string; teamId: string; accountId: string; panel: Port; page?: Port; active: boolean; timer: ReturnType<typeof setTimeout> };

/** How long a shortcut that opened the panel waits for that panel to connect. */
const SHORTCUT_WAIT_MS = 15_000;

/** 截图: one capture per window, from the visible tab into the page's editor, then back to the panel that asked. */
export function capture(bg: Background) {
  const { browser } = bg;
  const captures = new Map<number, CaptureSession>();

  // Memory only: a restarted worker cannot prove that Chrome still grants activeTab.
  const activeOrigins = new Map<number, string>();
  function origin(url?: string) { try { const value = new URL(url!); return /^https?:$/.test(value.protocol) ? value.origin : undefined; } catch { return; } }
  function grantActiveTab(tab: Tab) {
    const value = origin(tab.url);
    if (tab.id !== undefined && !tab.incognito && value) activeOrigins.set(tab.id, value);
  }
  function invalidateActiveTab(tabId: number, url?: string) {
    if (!url || activeOrigins.get(tabId) !== origin(url)) activeOrigins.delete(tabId);
  }
  async function tabAccess(tab: Tab | undefined): Promise<CapabilityAccess> {
    const [{ site }, allUrls] = await Promise.all([accessStatus(tab?.url, browser), browser.permissions.contains({ origins: ['<all_urls>'] })]);
    return { site, allUrls, active: tab?.id !== undefined && Boolean(origin(tab.url)) && activeOrigins.get(tab.id) === origin(tab.url) };
  }
  async function requirePageAction(tab: Tab | undefined, action: PageAction) {
    const capability = pageCapabilities(tab, await tabAccess(tab))[action];
    if (capability.state === 'ready') return;
    if (capability.state === 'access') throw Object.assign(new MessageError(uiMessage('extension.runtime.needSite')), { code: 'NEED_SITE' });
    if (capability.state === 'pending') throw new MessageError(uiMessage('extension.runtime.pagePending'));
    throw new MessageError(uiMessage(action === 'capture' ? 'extension.runtime.pageNoCapture' : 'extension.runtime.pageUnavailable'));
  }
  async function pageActionFailure(tab: Tab, action: PageAction, key = action === 'capture' ? 'extension.copy.captureFailed' : 'extension.runtime.pageActionFailed'): Promise<never> {
    // Re-read the tab: under activeTab only a fresh address shows whether Chrome still lets Palside see this page.
    const current = await browser.tabs.get(tab.id!).catch(() => undefined);
    await requirePageAction(current ?? tab, action);
    throw new MessageError(uiMessage(key));
  }
  function discardCapture(windowId: number, closeEditor = true) {
    const session = captures.get(windowId);
    captures.delete(windowId);
    if (!session) return;
    bg.clearTimeout(session.timer);
    void bg.signals.broadcastSignals().catch(() => {});
    if (!closeEditor) return;
    if (session.page) {
      bg.pages.pagePorts.delete(session.page);
      try { session.page.postMessage({ type: 'off' } satisfies PageDown); } catch { /* page gone */ }
    }
    bg.post(session.panel, { type: 'capture-cancel' });
  }
  async function grab(tab: Tab, session: CaptureSession) {
    const current = () => captures.get(tab.windowId) === session && session.accountId === bg.state?.account?.id && session.teamId === bg.state?.preferences.current && bg.teamAvailable();
    const same = (value: Tab | undefined) => value?.id === tab.id && value?.url === tab.url;
    if (!same(await bg.activeTab(tab.windowId))) { if (!current()) return null; throw new MessageError(uiMessage('extension.runtime.capturePageChanged')); }
    if (!current()) return null;
    let src: string;
    try { src = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
    catch { if (!current()) return null; return pageActionFailure(tab, 'capture'); }
    if (!current()) return null;
    const after = await bg.activeTab(tab.windowId);
    if (!current()) return null;
    if (!same(after)) throw new MessageError(uiMessage('extension.runtime.capturePageChanged'));
    if (!src.startsWith('data:image/')) throw new MessageError(uiMessage('extension.copy.captureFailed'));
    return src;
  }

  const shortcuts = new Map<number, number>();
  const api = {
    captures, tabAccess, grantActiveTab, invalidateActiveTab, requirePageAction, pageActionFailure, discardCapture,
    /** The page of a running capture, which may connect without a site grant (activeTab). */
    capturePageAllowed(info: { tabId: number; url: string; windowId: number }) {
      const session = captures.get(info.windowId);
      return Boolean(session && session.tabId === info.tabId && session.url === info.url && session.accountId === bg.state?.account?.id && session.teamId === bg.state?.preferences.current && bg.teamAvailable());
    },
    /** Panel `capture`: take the visible tab, open the editor on the page, and hand the result back on `captured`. */
    async startCapture(windowId: number, senderUrl: string, payload: Record<string, unknown>) {
      const asking = await bg.panelTab(windowId, senderUrl);
      if (!asking) return;
      return start(windowId, asking.panel, asking.tab, payload);
    },
    /**
     * The 截图 shortcut: Chrome hands the pressed tab to Palside (activeTab), which a click inside the panel never does. With a panel
     * open in that window the capture starts at once for its current team; otherwise the panel opens and it starts once that panel says hello.
     */
    shortcut(tab: Tab | undefined) {
      if (!tab || tab.id === undefined || tab.windowId === undefined || tab.incognito) return;
      grantActiveTab(tab);
      void bg.pages.pushPageStatus();
      const panel = [...bg.panels].find(([, id]) => id === tab.windowId)?.[0];
      if (panel) { fromShortcut(panel, tab.windowId); return; }
      shortcuts.set(tab.windowId, Date.now());
      // Opened inside the key press, before anything is awaited, so Chrome counts it as the user's.
      void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => { shortcuts.delete(tab.windowId); });
    },
    /** A panel said hello for its window: a shortcut pressed just before, while no panel was open there, starts its capture now. */
    panelReady(panel: Port, windowId: number) {
      const at = shortcuts.get(windowId);
      shortcuts.delete(windowId);
      if (at !== undefined && Date.now() - at < SHORTCUT_WAIT_MS) fromShortcut(panel, windowId);
    },
  };

  function fromShortcut(panel: Port, windowId: number) {
    const state = bg.state;
    void bg.activeTab(windowId)
      .then(tab => start(windowId, panel, tab, { teamId: state?.preferences.current, accountId: state?.account?.id }))
      .catch(error => bg.notifyWindow(windowId, { ok: false, message: 'Screenshot failed.', text: errorMessage(error) }));
  }

  async function start(windowId: number, panel: Port, tab: Tab | undefined, payload: Record<string, unknown>) {
      const accountId = bg.state?.account?.id, version = bg.sessionVersion;
      await requirePageAction(tab, 'capture');
      if (!tab || tab.id === undefined || !tab.url) return;
      const teamId = typeof payload.teamId === 'string' ? payload.teamId : undefined;
      const state = bg.state;
      if (version !== bg.sessionVersion || !state?.authenticated || !accountId || accountId !== state.account?.id || payload.accountId !== undefined && payload.accountId !== accountId || !teamId || teamId !== state.preferences.current || !state.remoteTeams.some(team => team.id === teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.captureContextChanged'));
      if (captures.has(windowId)) throw new MessageError(uiMessage('extension.runtime.captureInProgress'));
      const tabId = tab.id, url = tab.url;
      const session: CaptureSession = {
        tabId, url, teamId, accountId, panel, active: (await tabAccess(tab)).active === true, page: bg.pages.portFor(tabId, url),
        timer: bg.setTimeout(() => {
          if (captures.get(windowId) !== session) return;
          discardCapture(windowId);
          bg.notifyWindow(windowId, { ok: false, message: 'Screenshot timed out.', text: uiMessage('extension.runtime.captureTimedOut') });
        }, 120_000),
      };
      captures.set(windowId, session);
      void bg.signals.broadcastSignals().catch(() => {});
      const current = () => version === bg.sessionVersion && captures.get(windowId) === session;
      try {
        const src = await grab(tab, session);
        if (!src || !current()) return;
        try { await browser.scripting.executeScript({ target: { tabId }, files: ['/page-layer.js'] }); }
        catch { if (!current()) return; await pageActionFailure(tab, 'capture', 'extension.runtime.pageActionFailed'); }
        const page = await bg.pages.waitForPort(windowId, tabId, url, current);
        if (!current()) return;
        if (!page) throw new MessageError(uiMessage('extension.runtime.pageActionFailed'));
        session.page = page;
        const labels = (await bg.pageLabels()).capture;
        if (!current() || bg.pages.pagePorts.get(page)?.url !== url) return;
        page.postMessage({ type: 'capture', src, labels } satisfies PageDown);
        return { started: true };
      } catch (error) {
        if (current()) discardCapture(windowId);
        throw error;
      }
  }

  return {
    ...api,
    /** The editor finished or was cancelled on the page: release the window and hand the image to the panel that asked. */
    captureDone(port: Port, info: { tabId: number; url: string; windowId: number }, message: { type: 'captured'; src: string } | { type: 'capture-cancel' }) {
      const session = captures.get(info.windowId);
      if (!session || session.page !== port || session.tabId !== info.tabId || session.url !== info.url) return;
      const state = bg.state;
      if (session.accountId !== state?.account?.id || !state.authenticated || !state.remoteTeams.some(team => team.id === session.teamId && team.joined)) { discardCapture(info.windowId); return; }
      discardCapture(info.windowId, false);
      if (!bg.pages.allowedPage(info)) bg.pages.stopPage(port, info);
      bg.post(session.panel, message.type === 'captured' ? { type: 'captured', src: message.src, teamId: session.teamId } : { type: 'capture-cancel' });
    },
  };
}
