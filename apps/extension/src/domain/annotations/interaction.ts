import { normalizeAddress,publicShareUrl,type Network } from '@palside/shared/navigation';
import { graphemeLength } from '@palside/shared/contracts/rules';
import { normalizeSiteHost } from '../assets/site-host.ts';

/** 信号 and 便利贴: the page features drawn from the squad's own data. */
export type InteractionFeature = 'signal' | 'sticky';
export const interactionFeatures: InteractionFeature[] = ['signal', 'sticky'];

/**
 * 网页互动, one setting per site: whether it runs there, and each of 弹幕, 信号 and 便利贴 on that site. A site Chrome allows with no entry
 * runs with everything on; switching 网页互动 off keeps Chrome's grant. Per account, kept on this device.
 */
export type SiteFeature = 'danmaku' | InteractionFeature;
export const siteFeatures: SiteFeature[] = ['danmaku', 'signal', 'sticky'];
export type SiteInteraction = { on: boolean } & Record<SiteFeature, boolean>;
export type SiteInteractions = Record<string, SiteInteraction>;
export const defaultSiteInteraction: SiteInteraction = { on: true, danmaku: true, signal: true, sticky: true };
const SITE_LIMIT = 500;

export function readSiteInteractions(input: unknown): SiteInteractions | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > SITE_LIMIT) return;
  const sites: SiteInteractions = {};
  for (const [key, item] of entries) {
    const host = normalizeSiteHost(key);
    if (!host || !item || typeof item !== 'object' || Array.isArray(item)) return;
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some(field => field !== 'on' && !siteFeatures.includes(field as SiteFeature))) return;
    if (Object.values(value).some(flag => typeof flag !== 'boolean')) return;
    sites[host] = { ...defaultSiteInteraction, ...value as Partial<SiteInteraction> };
  }
  return sites;
}

/** The site's setting, the default for a site without one. */
export function siteInteraction(sites: SiteInteractions | undefined, host: string | undefined): SiteInteraction {
  const key = normalizeSiteHost(host);
  return (key && sites?.[key]) || defaultSiteInteraction;
}

/** 网页互动 runs on the site and, given a feature, that feature is on there; Chrome's grant is checked by the caller. */
export function siteAllows(sites: SiteInteractions | undefined, host: string | undefined, feature?: SiteFeature) {
  const value = siteInteraction(sites, host);
  return Boolean(normalizeSiteHost(host)) && value.on && (!feature || value[feature]);
}

/** The page layer has something of the squad's own to draw: 信号 or 便利贴 on (弹幕 joins by the open room). */
export function siteDraws(sites: SiteInteractions | undefined, host: string | undefined) {
  return interactionFeatures.some(feature => siteAllows(sites, host, feature));
}

/** 收藏: whole websites and single pages, only for this account on this device. Never synced or shared. */
export type FavoritePage = { url: string; title: string };
export type Favorites = { sites: string[]; pages: FavoritePage[] };
export const emptyFavorites: Favorites = { sites: [], pages: [] };
const FAVORITE_LIMIT = 200;

export function readFavorites(input: unknown): Favorites | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.sites) || !Array.isArray(value.pages) || Object.keys(value).some(key => key !== 'sites' && key !== 'pages')) return;
  const sites: string[] = [];
  for (const item of value.sites) { const host = normalizeSiteHost(item); if (!host) return; if (!sites.includes(host)) sites.push(host); }
  const pages: FavoritePage[] = [];
  for (const item of value.pages) {
    if (!item || typeof item !== 'object') return;
    const page = item as Record<string, unknown>;
    const url = typeof page.url === 'string' ? pageScopeUrl(page.url) : undefined;
    if (!url || typeof page.title !== 'string' || graphemeLength(page.title) > 200) return;
    if (!pages.some(saved => saved.url === url)) pages.push({ url, title: page.title.trim() || new URL(url).hostname });
  }
  if (sites.length > FAVORITE_LIMIT || pages.length > FAVORITE_LIMIT) return;
  return { sites, pages };
}

/** Public page identity keeps semantic query parameters and drops only tracking parameters. */
export function pageScopeUrl(value: unknown): string | undefined {
  return typeof value === 'string' ? publicShareUrl(value) ?? undefined : undefined;
}
export function assetKey(chain: unknown, address: unknown): string | undefined {
  if (typeof chain !== 'string' || !['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'].includes(chain)) return;
  const normalized = normalizeAddress(chain as Network, address);
  return normalized ? `${chain}:${normalized}` : undefined;
}
export function viewAsset(view: { kind?: string; chain?: string; address?: string } | undefined) { return view?.kind === 'asset' ? assetKey(view.chain, view.address) : undefined; }
