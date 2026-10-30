import { normalizeAddress,publicShareUrl,type Network } from '@palside/shared/navigation';
import { normalizeSiteHost } from '../assets/site-host.ts';

/**
 * 设置 › 网页: 共享在看 (`share`) and 网页互动 (`interact`) are each 启用 or 禁用. Both start 启用. 禁用 hides the composer switch
 * and gives back the feature's Chrome permission. Per account, kept on this device.
 */
export type WebFeature = 'share' | 'interact';
export type WebFeatures = Record<WebFeature, boolean>;
export const defaultWebFeatures: WebFeatures = { share: true, interact: true };

export function readWebFeatures(input: unknown): WebFeatures | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (typeof value.share !== 'boolean' || typeof value.interact !== 'boolean' || Object.keys(value).length !== 2) return;
  return { share: value.share, interact: value.interact };
}

/** Exact public hosts, deduplicated in order; nothing when any entry is not one. */
export function readHosts(input: unknown, limit = 500): string[] | undefined {
  if (!Array.isArray(input) || input.length > limit) return;
  const hosts: string[] = [];
  for (const item of input) { const host = normalizeSiteHost(item); if (!host) return; if (!hosts.includes(host)) hosts.push(host); }
  return hosts;
}

/** The team's page features: one switch each, on every site 网页互动 runs on. 网页弹幕 has its own switch in the 弹幕 box. */
export type InteractionFeature = 'signal' | 'sticky';
export type InteractionPrefs = Record<InteractionFeature, boolean>;
export const interactionFeatures: InteractionFeature[] = ['signal', 'sticky'];
export const defaultInteraction: InteractionPrefs = { signal: true, sticky: true };

export function readInteraction(input: unknown): InteractionPrefs | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !interactionFeatures.includes(key as InteractionFeature))) return;
  if ([value.signal, value.sticky].some(item => item !== undefined && typeof item !== 'boolean')) return;
  return { ...defaultInteraction, ...value as Partial<InteractionPrefs> };
}

/** The feature's switch; without a feature, whether any of them is on, since 网页互动 has nothing to draw otherwise. */
export function interactionAllows(prefs: InteractionPrefs | undefined, feature?: InteractionFeature) {
  const value = prefs ?? defaultInteraction;
  return feature ? value[feature] : interactionFeatures.some(item => value[item]);
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
    if (!url || typeof page.title !== 'string' || page.title.length > 200) return;
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
