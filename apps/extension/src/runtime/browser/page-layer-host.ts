import { visibleStickies } from '../../domain/annotations/social.ts';
import { identifyPage } from '@palside/shared/navigation';
import { siteProfile } from '@palside/shared/sites';
import { assetKey,viewAsset,pageScopeUrl } from '../../domain/annotations/interaction.ts';
import type { AssetKey,LocateResult,PageStatus } from './page-protocol.ts';
import { broadOrigin,grantedHost } from './permissions.ts';
import type { RuntimeState } from '../composition/runtime-state';
import { pageCapabilities,type CapabilityAccess,type CapabilityTab } from './page-capabilities.ts';
import { SIGNAL_TTL,readSignal } from '../annotations/signals.ts';
import { interactionAllows } from '../../domain/annotations/interaction.ts';
import { normalizeSiteHost } from '../../domain/assets/site-host.ts';

export { visibleStickies };

/** Only newly received live signals; snapshots and context changes never replay. */
export function freshPageSignals(previous: RuntimeState | undefined, next: RuntimeState, url: string, now = Date.now()) {
  if (!previous || previous.account?.id !== next.account?.id || pageTeam(previous) !== pageTeam(next) || !pageTeam(next)) return [];
  const seen = new Set((previous.signals ?? []).map(item => `${item.teamId}:${item.personId}:${item.id}`));
  return (next.signals ?? []).filter(item => item.teamId === pageTeam(next) && item.url === pageScopeUrl(url) && item.sentAt + SIGNAL_TTL > now && readSignal(item, now) && !seen.has(`${item.teamId}:${item.personId}:${item.id}`));
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
/** 网页互动 is 启用, has a feature on and is switched on in the composer. */
export function interacting(state: RuntimeState | undefined) {
  return Boolean(state?.preferences.web.interact && state.toggles.interact && interactionAllows(state.preferences.interaction));
}
export function pageTeam(state: RuntimeState | undefined) { return state?.authenticated ? state.remoteTeams.find(team => team.joined && team.id === state.preferences.current)?.id : undefined; }
export function pageAsset(url: string, state?: RuntimeState): AssetKey | undefined {
  const host = pageUrlHost(url);
  if (!host) return;
  const identity = identifyPage(url, [host]);
  if (identity?.kind === 'asset') return assetKey(identity.chain, identity.address);
  if (identity?.kind !== 'pool' || !state) return;
  const views = [...state.data.views, ...state.data.messages.flatMap(message => [message.ref?.view, message.attachment?.kind === 'asset' ? message.attachment.view : undefined]), ...Object.values(state.drafts).map(draft => draft.value.ref?.view)];
  const assets = new Set(views.flatMap(view => {
    if (!view || view.chain !== identity.chain) return [];
    const source = identifyPage(view.url, [host]), asset = viewAsset(view);
    return asset && source?.kind === 'pool' && source.url === identity.url ? [asset] : [];
  }));
  return assets.size === 1 ? [...assets][0] : undefined;
}
export const PAGE_SCRIPT_ID = 'palside-page';
/** The page layer's content script for exact host patterns: top frame only, re-registered after each browser start. */
export function pageScript(matches: string[]) {
  return { id: PAGE_SCRIPT_ID, js: ['page-layer.js'], matches, runAt: 'document_idle' as const, persistAcrossSessions: false, allFrames: false };
}
/** The page layer's registration patterns: every 已授权网站 as Chrome granted it, while 网页互动 runs for a joined team. */
export function pageMatches(state: RuntimeState | undefined, origins: readonly string[], roomEnabled = false) {
  if (!(pageTeam(state) && interacting(state)) && !roomEnabled) return [];
  if (origins.some(broadOrigin)) return ['http://*/*', 'https://*/*'];
  return [...new Set(origins.flatMap(origin => {
    const host = normalizeSiteHost(grantedHost(origin));
    return !host ? [] : origin.startsWith('*') ? [`http://${host}/*`, `https://${host}/*`] : [`https://${host}/*`];
  }))].sort();
}
export function pageStatus(windowId: number, tab: (CapabilityTab & { title?: string; favicon?: string }) | undefined, ports: readonly PageConnection[], access: CapabilityAccess, state?: RuntimeState): PageStatus {
  const port = ports.find(port => port.windowId === windowId && port.tabId === tab?.id && (!tab?.url || port.url === tab.url));
  const url = tab?.url ?? port?.url;
  const host = pageUrlHost(url);
  const asset = port?.asset ?? (url ? pageAsset(url, state) : undefined);
  const capabilities = pageCapabilities(tab && { ...tab, url }, access);
  const granted = Boolean(pageTeam(state) && capabilities.pick.state === 'ready');
  const interaction = state?.preferences.interaction;
  const interactive = Boolean(granted && interacting(state));
  const tokenProfile = Boolean(host && siteProfile(host));
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
    granted,
    interactive,
    stickyEnabled: interactive && interactionAllows(interaction, 'sticky'),
    signalEnabled: interactive && interactionAllows(interaction, 'signal'),
    connected: Boolean(access.site && port),
    tokenProfile,
    missingStickies: port?.missingStickies ?? [],
  };
}
export function pageDiff(previous: RuntimeState | undefined, state: RuntimeState, ports: readonly PageConnection[], now = Date.now()) {
  const team = pageTeam(state);
  if (!team || pageTeam(previous) !== team || previous?.account?.id !== state.account?.id) return [];
  const oldMessages = new Set(previous?.data.messages.map(message => message.id));
  const messages = state.data.messages.filter(message => message.teamId === team && message.liveArrival && message.status === 'sent' && !message.recalled && message.ref && message.ref.target.kind !== 'danmaku' && !oldMessages.has(message.id) && (message.expiresAt === undefined || message.expiresAt > now));
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
