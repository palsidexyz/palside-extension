import { createContext } from 'react';
import { siteDefinitions } from '@palside/shared/navigation';
import type { SiteIcon } from '../../../domain/assets/site-icon';
import { readsTokens,siteByDomain,siteById,siteCategories as registryCategories,type SiteCategory as RegistryCategory } from '@palside/shared/sites';
/** `plate`: the logo needs a light plate in dark mode, or a dark one in light mode (see the registry). */
export type Site = { id: string; name: string; domain: string; logo?: string; plate?: 'light' | 'dark' };
/** UI consumes the shared registry; internal token/pool capabilities stay out of the settings UI. */
export const siteLogo = (id: string) => `/site-logos/${id}.webp`;
export const siteCatalog: Site[] = siteDefinitions.map(({ id, name, domain }) => ({ id, name, domain, logo: siteLogo(id), plate: siteById(id)?.plate }));
/** Where a site's face comes from: the catalog, and the icons this device kept for sites added outside it. */
export type SiteDirectory = { sites: readonly Site[]; live?: { siteIcons?: Readonly<Record<string, SiteIcon>> } };
/** The panel's directory, so a face drawn without the controller (a 共享在看 page, a quoted page) resolves like every other. */
export const SiteDirectoryContext = createContext<SiteDirectory>({ sites: siteCatalog });
/**
 * Any site by its exact host, the one face it has everywhere in the panel: the catalog entry, else the icon this device kept for
 * it (see the background's site icons), else the favicon the page itself offered (the tab's, or the one a friend's 共享在看 carried),
 * else no logo — drawn as its first letter.
 */
export function siteOf(c: SiteDirectory, host: string, favicon?: string): Site {
  const known = c.sites.find(site => site.domain === host);
  if (known) return known;
  const icon = c.live?.siteIcons?.[host];
  if (icon) return { id: host, name: host, domain: host, logo: icon.src, ...(icon.plate ? { plate: icon.plate } : {}) };
  return { id: host, name: host, domain: host, ...(favicon ? { logo: favicon } : {}) };
}
/** The site of an http(s) address, resolved as {@link siteOf}; nothing for any other address. */
export function siteAt(c: SiteDirectory, url: string | undefined, favicon?: string): Site | undefined {
  try { const parsed = new URL(url ?? ''); return ['https:', 'http:'].includes(parsed.protocol) && parsed.hostname ? siteOf(c, parsed.hostname, favicon) : undefined; }
  catch { return undefined; }
}
/** The catalog entry of an address, for asking whether Palside knows the site; faces use {@link siteAt}. */
export function siteForUrl(url: string, sites: readonly Site[] = siteCatalog) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? sites.find(site => site.domain === parsed.hostname) : undefined; }
  catch { return undefined; }
}
/** How 添加网站 groups the catalog. Custom hosts are their own group. */
export type SiteCategory = RegistryCategory | 'custom';
export const siteCategories: SiteCategory[] = [...registryCategories, 'custom'];
export function siteCategory(domain: string): SiteCategory { return siteByDomain(domain)?.category ?? 'custom'; }
/** What the registry can do on a site, shown as tags in every site row: 代币 (recognizes token pages). */
export function siteTags(domain: string) {
  const spec = siteByDomain(domain);
  return { token: readsTokens(spec) };
}
