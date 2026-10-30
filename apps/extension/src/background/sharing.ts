import type { DeviceState } from '@palside/shared/contracts/presence';
import { MessageError,errorMessage } from '@palside/i18n';
import type { Browser } from 'wxt/browser';
import { identifyPage,matchesSharedPage,publicShareUrl,websiteIdentity } from '@palside/shared/navigation';
import { siteProfile } from '@palside/shared/sites';
import { connectionStatus } from '../runtime/transport/connection.ts';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { hasPanelForWindow } from '../runtime/browser/panel-context.ts';
import { pageName } from '../runtime/viewing/page-title.ts';
import { createTabObserver,type ObservationPolicy } from '../runtime/browser/tab-observer.ts';
import { matchesTokenPage,readVisibleToken,resolveTokenMetadata,tokenName,type TokenPageMetadata,type TokenPageRequest } from '../runtime/viewing/token-page.ts';
import { pageView } from '../runtime/viewing/view-snapshot.ts';
import type { Background } from './index.ts';
import type { Tab } from './context.ts';
import type { Preferences } from '../domain/account/preferences.ts';

/**
 * 共享在看: while it is 启用 and switched on, a joined team is current and the service is connected, the focused panel window's
 * active tab is published as this device's 正在看. Chrome's 读取您的浏览记录 gives the address of every tab. Also device activity
 * (活跃) and link cards.
 */
export function sharing(bg: Background) {
  const { browser } = bg;
  let idle: DeviceState = 'away';
  let reported: DeviceState | undefined;
  /** When a resume, enable or preference change replied before its state arrived: the sharing policy that follows within 10 s claims this device. */
  let claimAt = 0;
  const tokenMetadata = new Map<string, { value?: TokenPageMetadata; attempts: number; at: number; policy: number; preferences: Preferences | undefined }>();

  function observationPolicy(): ObservationPolicy | undefined {
    const state = bg.state;
    if (!state?.authenticated || !state.preferences.web.share || !state.toggles.share || connectionStatus(state.connection) !== 'connected') return;
    const team = state.remoteTeams.find(team => team.id === state.preferences.current && team.joined);
    if (!team) return;
    const key = JSON.stringify([state.account?.id, team.id]);
    return { context: key, key };
  }
  async function activePage() {
    if (!observationPolicy() || await browser.idle.queryState(60) === 'locked') return;
    const window = await browser.windows.getLastFocused();
    if (!window.focused || window.incognito || window.id === undefined || ![...bg.panels.values()].includes(window.id)) return;
    const tab = await bg.activeTab(window.id);
    if (tab?.id === undefined || tab.incognito || !tab.url) return;
    return { tabId: tab.id, windowId: window.id, url: tab.url, title: tab.title, loading: tab.status === 'loading' };
  }
  async function observe(payload: Record<string, unknown>) {
    const reply = await bg.run({ name: 'page', payload });
    if (!reply.ok) throw new MessageError(reply.text ?? errorMessage(reply));
  }
  const observer = (bg.env.createTabObserver ?? createTabObserver)({
    policy: observationPolicy, activePage,
    clear: async (preparing = false) => { if (bg.state?.authenticated) await bg.run({ name: 'page', payload: { clear: true, preparing } }).catch(() => {}); },
    activity: () => observe({ activity: true }),
    failed: () => observe({ failed: true }),
    metadata: (identity, page) => observe({ identity, host: identity.host, metadata: true, context: { tabId: page.tabId, windowId: page.windowId } }),
    preview: async (identity, page) => observe({ identity, host: identity.host, preview: true, title: page.title, favicon: await bg.favicon(page.url), context: { tabId: page.tabId, windowId: page.windowId } }),
    publish: async (identity, page) => observe({ identity, host: identity.host, stable: true, title: page.title, favicon: await bg.favicon(page.url), context: { tabId: page.tabId, windowId: page.windowId } }),
  });

  /** The token's name and icon from the page: only registry token sites with a page profile, with this site's access and 代币数据 on. */
  async function readTokenPage(request: TokenPageRequest) {
    if (!request?.identity || !request.context || !['viewing', 'share'].includes(request.purpose)) return;
    if (!siteProfile(request.identity.host)) return;
    // Preference snapshots and Chrome policy versions identify the policy revision.
    const preferences = bg.state?.preferences, version = bg.policyVersion, document = bg.tabVersions.get(request.context.tabId);
    const accountId = bg.state?.account?.id, policy = observationPolicy()?.key;
    const eligible = () => bg.policyVersion === version && bg.tabVersions.get(request.context.tabId) === document && bg.state?.preferences === preferences && !preferences?.tokenOff?.includes(request.identity.host) &&
      bg.state?.authenticated && bg.state.account?.id === request.accountId && bg.state.preferences.current === request.teamId && bg.state.remoteTeams.some(team => team.id === request.teamId && team.joined) &&
      (request.purpose === 'share' || observationPolicy()?.key === policy);
    if (!eligible() || request.purpose === 'viewing' && !policy) return;
    const page = async () => {
      const window = await browser.windows.getLastFocused();
      if (!window.focused || window.incognito || window.id !== request.context.windowId || ![...bg.panels.values()].includes(window.id)) return;
      if (await browser.idle.queryState(60) === 'locked') return;
      const tab = await bg.activeTab(window.id);
      return tab?.id === request.context.tabId && !tab.incognito && tab.status !== 'loading' && tab.url && matchesTokenPage(tab.url, request.identity) ? tab : undefined;
    };
    const tab = await page();
    if (tab?.id === undefined || !tab.url || !(await accessStatus(tab.url, browser)).site || !eligible() || accountId !== bg.state?.account?.id) return;
    const key = JSON.stringify([accountId, request.teamId, request.context.windowId, tab.id, document, tab.url, request.identity.host, request.identity.chain, request.identity.address]);
    let saved = tokenMetadata.get(key);
    if (!saved || saved.policy !== version || saved.preferences !== preferences || Date.now() - saved.at > 60_000) {
      saved = { attempts: 0, at: Date.now(), policy: version, preferences }; tokenMetadata.set(key, saved);
      if (tokenMetadata.size > 100) tokenMetadata.delete(tokenMetadata.keys().next().value!);
    }
    if (saved.value) return saved.value;
    if (saved.attempts >= 3) return;
    saved.attempts++;
    try {
      // Chrome also checks site access when executing this isolated read.
      const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: readVisibleToken, args: [{ href: tab.url, host: request.identity.host, address: request.identity.address, chain: request.identity.chain }, siteProfile(request.identity.host) ?? null] });
      const after = await page();
      if (!after || after.url !== tab.url || !(await accessStatus(tab.url, browser)).site || !eligible()) return;
      const result = results.find(result => result.frameId === 0)?.result;
      if (tokenName(result?.name)) saved.value = result;
      return saved.value;
    } catch { return; }
  }

  return {
    observer, observationPolicy, readTokenPage,
    /** 活跃: an open panel or recent input on this device; reported once per change. */
    updateDeviceState(value?: DeviceState) {
      if (value) idle = value;
      const next = bg.panels.size > 0 || idle === 'active' ? 'active' : 'away';
      if (next === reported) return;
      reported = next;
      void bg.run({ name: 'device-state', payload: { state: next } }).catch(() => { reported = undefined; });
    },
    /** The sharing policy changed: refresh, claiming this device if a panel action asked for it within the last 10 seconds. */
    sharingPolicyChanged() {
      const claim = Date.now() - claimAt < 10_000 && Boolean(observationPolicy());
      if (claim) claimAt = 0;
      void observer.refresh(claim, true);
    },
    /** A panel action that may turn sharing on replied: claim this device now, or once the state that turns it on arrives. */
    claimSharing() {
      if (!observationPolicy()) claimAt = Date.now();
      else void observer.refresh(true, true);
    },
    /** The offscreen document asks whether a shared URL is what this device's focused panel window shows now. */
    async sharedPageVisible(url: unknown) {
      const page = await activePage(), policy = observationPolicy();
      if (!page || page.loading || !policy) return false;
      const contexts = await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL' as Browser.runtime.ContextType] });
      if (!hasPanelForWindow(contexts, [...bg.panels].map(([port, windowId]) => ({ documentId: port.sender?.documentId, documentUrl: port.sender?.url, windowId })), page.windowId)) return false;
      return matchesSharedPage(page.url, url as string);
    },
    /** Panel `link-card`: a token or website card for a pasted link, using the active tab's title and token read when it is that page. */
    async linkCard(windowId: number, senderUrl: string, value: unknown) {
      const input = typeof value === 'string' ? value.trim() : '';
      const url = publicShareUrl(input);
      if (!url) return {};
      const host = new URL(url).hostname;
      const identity = identifyPage(url, undefined, 'page');
      if (!identity) return {};
      // Chrome gives the active tab's address and title only where Palside may read it.
      let tab: Tab | undefined;
      try { tab = (await bg.panelTab(windowId, senderUrl))?.tab; } catch { tab = undefined; }
      const current = tab?.url === input;
      const title = current ? pageName(tab?.title, host) : undefined;
      const favicon = await bg.favicon(current ? tab?.url : url);
      const source = identity.kind === 'pool' ? websiteIdentity(url, 'page') : identity;
      if (!source) return {};
      const accountId = bg.state?.account?.id;
      const confirmed = source.kind === 'asset' && current && tab?.id !== undefined && accountId
        ? await readTokenPage({ identity: source, context: { tabId: tab.id, windowId }, accountId, teamId: bg.state!.preferences.current, purpose: 'share' })
        : undefined;
      const view = pageView(source, source.kind === 'asset' ? resolveTokenMetadata(source, confirmed) : { name: title ?? host, logo: favicon });
      if (view.kind === 'website') view.source = host;
      return { attachment: { kind: 'asset', assetId: view.id, view } };
    },
  };
}
