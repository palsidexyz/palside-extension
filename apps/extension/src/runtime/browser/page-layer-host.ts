import { visibleStickies } from '../../domain/annotations/social.ts';
import { identifyPage } from '@palside/shared/navigation';
import { assetKey,viewAsset,pageScopeUrl } from '../../domain/annotations/interaction.ts';
import type { AssetKey,LocateResult,PageStatus } from './page-protocol.ts';
import { broadOrigin,grantedHost } from './permissions.ts';
import type { RuntimeState } from '../composition/runtime-state';
import { pageCapabilities,type CapabilityAccess,type CapabilityTab } from './page-capabilities.ts';
import { SIGNAL_TTL,readSignal } from '../annotations/signals.ts';
import { siteAllows,siteDraws } from '../../domain/annotations/interaction.ts';
import { tabIcon } from '../viewing/viewing.ts';
import { normalizeSiteHost } from '../../domain/assets/site-host.ts';
import { expired } from '../../domain/chat/expiry.ts';

export { visibleStickies };

/** Only newly received live signals; snapshots and context changes never replay. */
export function freshPageSignals(previous: RuntimeState | undefined, next: RuntimeState, url: string, now = Date.now()) {
  if (!previous || previous.account?.id !== next.account?.id || pageTeam(previous) !== pageTeam(next) || !pageTeam(next)) return [];
  const seen = new Set((previous.signals ?? []).map(item => `${item.teamId}:${item.personId}:${item.id}`));
  return (next.signals ?? []).filter(item => item.teamId === pageTeam(next) && item.url === pageScopeUrl(url) && item.at + SIGNAL_TTL > now && readSignal(item, now) && !seen.has(`${item.teamId}:${item.personId}:${item.id}`));
}

/** A connected page script: its tab and document, the page it is on, and that page's asset and unfound notes. */
export type PageConnection = { tabId: number; windowId: number; url: string; documentId?: string; siteGranted?: boolean; asset?: AssetKey; missingStickies?: string[] };
export function pageUrlHost(url: string | undefined) {
  try { const parsed = new URL(url!); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname : undefined; } catch { return; }
}
export function locateResponse(requestId: string, message: unknown): LocateResult | undefined {
  if (!message || typeof message !== 'object') return;
  const value = message as { type?: unknown; requestId?: unknown; result?: unknown };
  if (value.type !== 'located' || value.requestId !== requestId) return;
  return ['shown', 'missing', 'hidden', 'other-site', 'unavailable'].includes(value.result as string) ? value.result as LocateResult : undefined;
}
export function pageTeam(state: RuntimeState | undefined) { return state?.authenticated ? state.remoteTeams.find(team => team.joined && team.id === state.preferences.current)?.id : undefined; }
/** The tab's token: read from the URL, or for a pool or chainless contract page the token the server found for it (see `PageResolver`). */
export function pageAsset(url: string, state?: RuntimeState): AssetKey | undefined {
  const identity = pageIdentity(url);
  if (identity?.kind === 'asset') return assetKey(identity.chain, identity.address);
  if (identity?.kind !== 'pool' && identity?.kind !== 'address') return;
  return (state?.pages?.[identity.url] ?? undefined) as AssetKey | undefined;
}
/** A pool or chainless contract page the server has not answered for yet: the page the runtime should look up. */
export function pageLookup(url: string, state?: RuntimeState) {
  const identity = pageIdentity(url);
  return (identity?.kind === 'pool' || identity?.kind === 'address') && state?.pages?.[identity.url] === undefined ? identity : undefined;
}
function pageIdentity(url: string) { const host = pageUrlHost(url); return host ? identifyPage(url, [host]) : null; }
export const PAGE_SCRIPT_ID = 'palside-page';
/** The page layer's content script for exact host patterns: top frame only, re-registered after each browser start. */
export function pageScript(matches: string[]) {
  return { id: PAGE_SCRIPT_ID, js: ['page-layer.js'], matches, runAt: 'document_idle' as const, persistAcrossSessions: false, allFrames: false };
}
/** The page layer's registration patterns: every 已授权网站 as Chrome granted it, while 网页互动 runs for a joined team. */
export function pageMatches(state: RuntimeState | undefined, origins: readonly string[], roomEnabled = false) {
  const sites = state?.preferences.siteInteraction;
  const team = Boolean(pageTeam(state));
  // A site runs the page layer while 网页互动 is on there with 信号 or 便利贴 for a joined team, or with 弹幕 while a room is open.
  const runs = (host: string) => team && siteDraws(sites, host) || roomEnabled && siteAllows(sites, host, 'danmaku');
  if (!team && !roomEnabled) return [];
  if (origins.some(broadOrigin)) return ['http://*/*', 'https://*/*'];
  return [...new Set(origins.flatMap(origin => {
    const host = normalizeSiteHost(grantedHost(origin));
    return !host || !runs(host) ? [] : origin.startsWith('*') ? [`http://${host}/*`, `https://${host}/*`] : [`https://${host}/*`];
  }))].sort();
}
export function pageStatus(windowId: number, tab: (CapabilityTab & { title?: string; favicon?: string; favIconUrl?: string }) | undefined, ports: readonly PageConnection[], access: CapabilityAccess, state?: RuntimeState): PageStatus {
  const port = ports.find(port => port.windowId === windowId && port.tabId === tab?.id && (!tab?.url || port.url === tab.url));
  const url = tab?.url ?? port?.url;
  const host = pageUrlHost(url);
  const asset = port?.asset ?? (url ? pageAsset(url, state) : undefined);
  const capabilities = pageCapabilities(tab && { ...tab, url }, access);
  const granted = Boolean(pageTeam(state) && capabilities.pick.state === 'ready');
  const sites = state?.preferences.siteInteraction;
  const interactive = Boolean(granted && siteAllows(sites, host));
  return {
    windowId,
    tabId: tab?.id,
    url,
    host,
    asset,
    capabilities,
    access,
    title: tab?.url ? tab.title : undefined,
    favicon: tab?.url ? tab.favicon : undefined,
    icon: tab?.url ? tabIcon(tab.favIconUrl) : undefined,
    granted,
    interactive,
    stickyEnabled: granted && siteAllows(sites, host, 'sticky'),
    signalEnabled: granted && siteAllows(sites, host, 'signal'),
    connected: Boolean(access.site && port),
    missingStickies: port?.missingStickies ?? [],
  };
}
export function pageDiff(previous: RuntimeState | undefined, state: RuntimeState, ports: readonly PageConnection[], now = Date.now()) {
  const team = pageTeam(state);
  if (!team || pageTeam(previous) !== team || previous?.account?.id !== state.account?.id) return [];
  const oldMessages = new Set(previous?.data.messages.map(message => message.id));
  const messages = state.data.messages.filter(message => message.teamId === team && message.liveArrival && message.status === 'sent' && !message.recalled && message.ref && message.ref.target.kind !== 'danmaku' && !oldMessages.has(message.id) && !expired(message.expiresAt, now));
  const samePage = (a: string, b: string) => Boolean(pageScopeUrl(a) && pageScopeUrl(a) === pageScopeUrl(b));
  // The background admits and removes ports under the site 互动 policy or a one-off action.
  return ports.filter(port => pageScopeUrl(port.url)).map(port => ({
    port,
    flashes: messages.filter(message => { const ref = message.ref!; const asset = viewAsset(ref.view); return ref.target.kind === 'quote' ? samePage(ref.view.url, port.url) : asset ? asset === port.asset : samePage(ref.view.url, port.url); }),
  })).filter(item => item.flashes.length);
}

export function updatePageUrl(port: PageConnection, url: string, state?: RuntimeState) {
  if (port.url !== url) port.missingStickies = [];
  port.url = url;
  port.asset = pageAsset(url, state);
}
export function pageStickies(port: PageConnection, state: RuntimeState | undefined, now = Date.now()) {
  const team = pageTeam(state), host = pageUrlHost(port.url), url = pageScopeUrl(port.url);
  if (!state || !team || !url || !host) return [];
  const hidden = new Set(state.preferences.hiddenStickies);
  return visibleStickies(state.items, team, { url }, now).filter(item => item.target?.kind === 'quote' && !hidden.has(item.id));
}

/** A native selection belongs to the account, team and document it was offered on, not whichever panel is open at completion. */
export type PickContext = { contextId: string; accountId: string; teamId: string; tabId: number; windowId: number; url: string; documentId?: string; requestId?: string };
export function currentPick(context: PickContext | undefined, page: PageConnection & { documentId?: string }, state: RuntimeState | undefined) {
  return Boolean(context && state?.authenticated && context.accountId === state.account?.id && context.teamId === pageTeam(state) && context.tabId === page.tabId && context.windowId === page.windowId && context.url === page.url && (!context.documentId || context.documentId === page.documentId));
}
