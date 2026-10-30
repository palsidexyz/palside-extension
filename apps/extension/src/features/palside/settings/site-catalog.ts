import { siteDefinitions } from '@palside/shared/navigation';
import { siteByDomain,siteById,siteCategories as registryCategories,type SiteCategory as RegistryCategory } from '@palside/shared/sites';
/** `plate`: the logo needs a light plate in dark mode, or a dark one in light mode (see the registry). */
export type Site = { id: string; name: string; domain: string; logo?: string; plate?: 'light' | 'dark' };
/** UI consumes the shared registry; internal token/pool capabilities stay out of the settings UI. */
export const siteCatalog: Site[] = siteDefinitions.map(({ id, name, domain }) => ({ id, name, domain, logo: `/site-logos/${id}.webp`, plate: siteById(id)?.plate }));
export function siteForUrl(url: string, sites: readonly Site[] = siteCatalog) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? sites.find(site => site.domain === parsed.hostname) : undefined; }
  catch { return undefined; }
}
/** How 添加网站 groups the catalog. Custom hosts are their own group. */
export type SiteCategory = RegistryCategory | 'custom';
export const siteCategories: SiteCategory[] = [...registryCategories, 'custom'];
export function siteCategory(domain: string): SiteCategory { return siteByDomain(domain)?.category ?? 'custom'; }
/** What the registry can do on a site, shown as tags in every site row: 代币 (recognizes token pages), 资料 (reads 代币资料). */
export function siteTags(domain: string) {
  const spec = siteByDomain(domain);
  return { token: Boolean(spec?.identify?.routes.some(route => route.kind === 'token')), profile: Boolean(spec?.profile) };
}
