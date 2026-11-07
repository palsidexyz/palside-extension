import type { SitePages, SiteSpec } from './define.ts';
import { catalog } from './catalog.ts';
import axiom from './axiom.ts';
import birdeye from './birdeye.ts';
import bullx from './bullx.ts';
import dexscreener from './dexscreener.ts';
import fomo from './fomo.ts';
import gmgn from './gmgn.ts';
import { multiChainExplorers, siteChains } from './chains.ts';

export * from './define.ts';
export { siteCategories } from './catalog.ts';

const pages: readonly SitePages[] = [axiom, birdeye, bullx, dexscreener, fomo, gmgn, ...siteChains];

/**
 * All per-site knowledge: the catalog (display, exact host, category) joined with page reading where it exists —
 * URL identification and page-layer layout. Token names and icons come from the server's token directory. Order is the display order.
 */
export const sites: readonly SiteSpec[] = catalog.map(entry => {
  const spec: SiteSpec = { ...pages.filter(page => page.id === entry.id).reduce((all, page) => ({ ...all, ...page }), {}), ...entry };
  return spec.category === 'explorer' && !spec.chain && !multiChainExplorers.has(spec.id) ? { ...spec, chain: 'none' } : spec;
});

/** Categories whose pages are about tokens: only these sites have addresses in their URLs read and looked up. */
const tokenCategories: ReadonlySet<string> = new Set(['terminal', 'dex', 'launchpad', 'market', 'analytics', 'security', 'explorer']);
/** Whether Palside reads token pages on this site: a crypto category on a chain Palside reads. */
export function readsTokens(site: SiteSpec | undefined) { return Boolean(site && tokenCategories.has(site.category) && site.chain !== 'none'); }

export function siteByDomain(host: string): SiteSpec | undefined { return sites.find(site => site.domain === host || site.aliases?.includes(host)); }
export function siteById(id: string): SiteSpec | undefined { return sites.find(site => site.id === id); }
