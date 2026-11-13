import { identifyPage,normalizeAddress,publicShareUrl,type Network } from '@palside/shared/navigation';
import { graphemeLength } from '@palside/shared/contracts/rules';
import { normalizeSiteHost } from '../assets/site-host.ts';

/** 信号 (the wheel: signals and emotes) and 共享画线 (shared drawings on TradingView charts): page features drawn from the squad's own data. */
export type InteractionFeature = 'signal' | 'chart';

/**
 * 网页互动, one setting per site: whether it runs there, and each of 弹幕, 信号 and 共享画线 on that site. A site Chrome allows with no entry
 * runs with everything on; switching 网页互动 off keeps Chrome's grant. Per account, kept on this device.
 * `ALL_SITES` holds the master switch from 设置 › 网页互动, in the same shape: off there, nothing runs on any site; a feature off there is
 * off on every site, whatever the site keeps. Each site's own choice survives and returns when the master switch comes back.
 */
export type SiteFeature = 'danmaku' | InteractionFeature;
export const siteFeatures: SiteFeature[] = ['danmaku', 'signal', 'chart'];
export type SiteInteraction = { on: boolean } & Record<SiteFeature, boolean>;
export type SiteInteractions = Record<string, SiteInteraction>;
export const defaultSiteInteraction: SiteInteraction = { on: true, danmaku: true, signal: true, chart: true };
/** Sites with their own setting; a site left at the default keeps no entry, so this counts only sites someone changed. */
const SITE_LIMIT = 2_000;
export const ALL_SITES = '*';
const siteKey = (host: unknown) => host === ALL_SITES ? ALL_SITES : normalizeSiteHost(host);

export function readSiteInteractions(input: unknown): SiteInteractions | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > SITE_LIMIT) return;
  const sites: SiteInteractions = {};
  for (const [key, item] of entries) {
    const host = siteKey(key);
    if (!host || !item || typeof item !== 'object' || Array.isArray(item)) return;
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some(field => field !== 'on' && !siteFeatures.includes(field as SiteFeature))) return;
    if (Object.values(value).some(flag => typeof flag !== 'boolean')) return;
    sites[host] = { ...defaultSiteInteraction, ...value as Partial<SiteInteraction> };
  }
  return sites;
}

/** `sites` with `host` set to `value`; a site back at the default drops its entry, so a long-used account stays inside the limit. */
export function withSiteInteraction(sites: SiteInteractions, host: string, value: SiteInteraction): SiteInteractions {
  const next: SiteInteractions = {};
  for (const [key, item] of Object.entries({ ...sites, [host]: value })) if (!isDefaultSite(item)) next[key] = item;
  return next;
}
const isDefaultSite = (item: SiteInteraction) => item.on === defaultSiteInteraction.on && siteFeatures.every(feature => item[feature] === defaultSiteInteraction[feature]);

/** The site's own setting (or the master switch for `ALL_SITES`), the default for one without an entry. */
export function siteInteraction(sites: SiteInteractions | undefined, host: string | undefined): SiteInteraction {
  const key = siteKey(host);
  return (key && sites?.[key]) || defaultSiteInteraction;
}

/** The master switch from 设置 › 网页互动. */
export function allSites(sites: SiteInteractions | undefined): SiteInteraction {
  return siteInteraction(sites, ALL_SITES);
}

/** 网页互动 runs on the site and, given a feature, that feature is on there — both by the master switch and by the site's own; Chrome's grant is checked by the caller. */
export function siteAllows(sites: SiteInteractions | undefined, host: string | undefined, feature?: SiteFeature) {
  const all = allSites(sites), value = siteInteraction(sites, host);
  return Boolean(normalizeSiteHost(host)) && all.on && value.on && (!feature || all[feature] && value[feature]);
}

/**
 * 弹幕 itself is on: the master 网页互动 switch and its 弹幕 card. Off, there is no 弹幕 anywhere — no key in the composer, no 热门, no
 * lease or count, nothing on pages. Each site's 弹幕 switch then decides whether its token pages join (`siteAllows(…, 'danmaku')`).
 */
export function danmakuOn(sites: SiteInteractions | undefined) {
  const all = allSites(sites);
  return all.on && all.danmaku;
}

/** The page layer runs for the squad while 网页互动 is on: 信号 and 共享画线 have their own switches (弹幕 joins by the open room). */
export function siteDraws(sites: SiteInteractions | undefined, host: string | undefined) {
  return siteAllows(sites, host);
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
/**
 * The page 信号 and 喊人来看 match on. A token page is its site and token, whatever route, tab or query the site
 * shows it with (`asset` names the token of a pool or chainless contract page once the server found it). Any other page is its address
 * without `www.`, trailing slash, fragment or query order; a routing fragment (`#/…`) stays.
 */
export function pageKey(value: unknown, asset?: string): string | undefined {
  const url = pageScopeUrl(value);
  if (!url) return;
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  const identity = identifyPage(url, [parsed.hostname]);
  const token = identity?.kind === 'asset' ? assetKey(identity.chain, identity.address) : asset;
  if (token) return `token:${token}@${host}`;
  parsed.searchParams.sort();
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `page:${host}${path}${parsed.search}${parsed.hash.startsWith('#/') ? parsed.hash : ''}`;
}
/** Two addresses are the same page (`pageKey`). */
export function samePage(a: unknown, b: unknown, assetA?: string, assetB?: string) {
  const key = pageKey(a, assetA);
  return Boolean(key && key === pageKey(b, assetB));
}
export function assetKey(chain: unknown, address: unknown): string | undefined {
  if (typeof chain !== 'string' || !['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'].includes(chain)) return;
  const normalized = normalizeAddress(chain as Network, address);
  return normalized ? `${chain}:${normalized}` : undefined;
}
export function viewAsset(view: { kind?: string; chain?: string; address?: string } | undefined) { return view?.kind === 'asset' ? assetKey(view.chain, view.address) : undefined; }
