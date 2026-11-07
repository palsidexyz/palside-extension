import { DEVICE_IDLE_SECONDS } from '@palside/shared/rules/accounts';
import type { DeviceState } from '@palside/shared/contracts/presence';
import { MessageError,errorMessage } from '@palside/i18n';
import type { Browser } from 'wxt/browser';
import { identifyPage,matchesSharedPage,publicShareUrl,websiteIdentity } from '@palside/shared/navigation';
import { tokenPage,type LookupPage } from '../runtime/viewing/page-resolver.ts';
import { connectionStatus } from '../runtime/transport/connection.ts';
import { hasPanelForWindow } from '../runtime/browser/panel-context.ts';
import { pageName } from '../runtime/viewing/page-title.ts';
import { createTabObserver,type ObservationPolicy } from '../runtime/browser/tab-observer.ts';
import { resolveTokenMetadata } from '../runtime/viewing/token-name.ts';
import { pageView } from '../runtime/viewing/view-snapshot.ts';
import type { Background } from './index.ts';
import type { Tab } from './context.ts';

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

  function observationPolicy(): ObservationPolicy | undefined {
    const state = bg.state;
    if (!state?.authenticated || !state.preferences.share || connectionStatus(state.connection) !== 'connected') return;
    const team = state.remoteTeams.find(team => team.id === state.preferences.current && team.joined);
    if (!team) return;
    const key = JSON.stringify([state.account?.id, team.id]);
    return { context: key, key };
  }
  async function activePage() {
    if (!observationPolicy() || await browser.idle.queryState(DEVICE_IDLE_SECONDS) === 'locked') return;
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
    preview: async (identity, page) => observe({ identity, host: identity.host, preview: true, title: page.title, favicon: await bg.favicon(page.url) }),
    publish: async (identity, page) => observe({ identity, host: identity.host, stable: true, title: page.title, favicon: await bg.favicon(page.url) }),
  });

  return {
    observer, observationPolicy,
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
    /** Panel `link-card`: a token or website card for a pasted link, using the active tab's title when it is that page. Token names come from the directory in the panel. */
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
      // A pool or chainless contract page is a token card once the runtime has found its token; until then, a website card.
      const lookup = identity.kind === 'pool' || identity.kind === 'address' ? identity : undefined;
      const found = lookup ? bg.state?.pages?.[lookup.url] : undefined;
      const source = lookup ? found ? tokenPage(lookup, found) : websiteIdentity(url, 'page') : identity as Exclude<typeof identity, LookupPage>;
      if (!source) return {};
      const view = pageView(source, source.kind === 'asset' ? resolveTokenMetadata(source, bg.state?.tokens?.[`${source.chain}:${source.address}`]) : { name: title ?? host, logo: favicon }, lookup && found ? lookup.kind : undefined);
      if (view.kind === 'website') view.source = host;
      return { attachment: { kind: 'asset', assetId: view.id, view } };
    },
  };
}
