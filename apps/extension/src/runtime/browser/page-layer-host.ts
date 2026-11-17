import { identifyPage } from '@palside/shared/navigation';
import { assetKey,pageKey } from '../../domain/annotations/interaction.ts';
import { locateResults,type AssetKey,type LocateResult,type PageStatus } from './page-protocol.ts';
import { broadOrigin,grantedHost } from './permissions.ts';
import type { RuntimeState } from '../composition/runtime-state';
import { pageCapabilities,type CapabilityAccess,type CapabilityTab } from './page-capabilities.ts';
import { SIGNAL_TTL,readSignal } from '../annotations/signals.ts';
import { allSites,defaultSiteInteraction,settingAllows,siteAllows,siteInteraction,type SiteInteraction } from '../../domain/annotations/interaction.ts';
import { iconDataUrl } from '../viewing/viewing.ts';
import { normalizeSiteHost } from '../../domain/assets/site-host.ts';


/** Only newly received live signals for this page (`pageKey`); snapshots and context changes never replay. */
export function freshPageSignals(previous: RuntimeState | undefined, next: RuntimeState, url: string, asset?: string, now = Date.now()) {
  if (!previous || previous.account?.id !== next.account?.id || pageTeam(previous) !== pageTeam(next) || !pageTeam(next)) return [];
  const seen = new Set((previous.signals ?? []).map(item => `${item.teamId}:${item.personId}:${item.id}`));
  const key = pageKey(url, asset);
  return (next.signals ?? []).filter(item => item.teamId === pageTeam(next) && key && pageKey(item.url, pageAsset(item.url, next)) === key && item.at + SIGNAL_TTL > now && readSignal(item, now) && !seen.has(`${item.teamId}:${item.personId}:${item.id}`));
}

/** A connected page script: its tab and document, the page it is on, and that page's asset and unfound notes. */
export type PageConnection = { tabId: number; windowId: number; url: string; documentId?: string; siteGranted?: boolean; asset?: AssetKey };
export function pageUrlHost(url: string | undefined) {
  try { const parsed = new URL(url!); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname : undefined; } catch { return; }
}
export function locateResponse(requestId: string, message: unknown): LocateResult | undefined {
  if (!message || typeof message !== 'object') return;
  const value = message as { type?: unknown; requestId?: unknown; result?: unknown };
  if (value.type !== 'located' || value.requestId !== requestId) return;
  return locateResults.includes(value.result as LocateResult) ? value.result as LocateResult : undefined;
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
/** Where the page layer registers: exact hosts, or every site minus the sites whose own setting keeps it off. */
export type PageRegistration = { matches: string[]; excludeMatches?: string[] };
/** The page layer's content script: top frame only, re-registered after each browser start. */
export function pageScript({ matches, excludeMatches }: PageRegistration) {
  return { id: PAGE_SCRIPT_ID, js: ['page-layer.js'], matches, ...(excludeMatches?.length ? { excludeMatches } : {}), runAt: 'document_idle' as const, persistAcrossSessions: false, allFrames: false };
}
/**
 * The page layer's registration: every 已授权网站 as Chrome granted it, while 网页互动 runs for a joined team or 弹幕 for an open room.
 * A site whose own setting keeps the layer off never receives the script, under a broad grant too, so the runtime gate is not the only boundary.
 */
export function pageRegistration(state: RuntimeState | undefined, origins: readonly string[], roomEnabled = false): PageRegistration | undefined {
  const sites = state?.preferences.siteInteraction, all = allSites(sites);
  const team = Boolean(pageTeam(state));
  if (!team && !roomEnabled || !all.on) return;
  // A site runs the page layer while 网页互动 is on there for a joined team, or with 弹幕 while a room is open.
  const runs = (value: SiteInteraction) => team && settingAllows(all, value) || roomEnabled && settingAllows(all, value, 'danmaku');
  const hostRuns = (host: string) => runs(siteInteraction(sites, host));
  if (origins.some(broadOrigin)) {
    if (!runs(defaultSiteInteraction)) return;
    const excluded = Object.keys(sites ?? {}).map(normalizeSiteHost).filter((host): host is string => Boolean(host) && !hostRuns(host!));
    return { matches: ['http://*/*', 'https://*/*'], ...(excluded.length ? { excludeMatches: [...new Set(excluded)].sort().map(host => `*://${host}/*`) } : {}) };
  }
  const matches = [...new Set(origins.flatMap(origin => {
    const host = normalizeSiteHost(grantedHost(origin));
    return !host || !hostRuns(host) ? [] : origin.startsWith('*') ? [`http://${host}/*`, `https://${host}/*`] : [`https://${host}/*`];
  }))].sort();
  return matches.length ? { matches } : undefined;
}
export function pageStatus(windowId: number, tab: (CapabilityTab & { title?: string; favicon?: string; favIconUrl?: string }) | undefined, ports: readonly PageConnection[], access: CapabilityAccess, state?: RuntimeState): PageStatus {
  const port = ports.find(port => port.windowId === windowId && port.tabId === tab?.id && (!tab?.url || port.url === tab.url));
  const url = tab?.url ?? port?.url;
  const host = pageUrlHost(url);
  const asset = port?.asset ?? (url ? pageAsset(url, state) : undefined);
  // `loading` says nothing about a document already connected: slow resources and history changes both report it.
  const capabilities = pageCapabilities(tab && { ...tab, url, ...(port ? { status: 'complete' } : {}) }, access);
  const granted = Boolean(pageTeam(state) && capabilities.interact.state === 'ready');
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
    icon: tab?.url ? iconDataUrl(tab.favIconUrl) : undefined,
    granted,
    interactive,
    signalEnabled: granted && siteAllows(sites, host, 'signal'),
    connected: Boolean(access.site && port),
  };
}
export function updatePageUrl(port: PageConnection, url: string, state?: RuntimeState) {
  port.url = url;
  port.asset = pageAsset(url, state);
}

