import type { SiteImage, SitePages, SiteProfile, SiteSpec } from './define.ts';
import { catalog } from './catalog.ts';
import axiom from './axiom.ts';
import birdeye from './birdeye.ts';
import bullx from './bullx.ts';
import dexscreener from './dexscreener.ts';
import fomo from './fomo.ts';
import gmgn from './gmgn.ts';

export * from './define.ts';
export { siteCategories } from './catalog.ts';

const pages: readonly SitePages[] = [axiom, birdeye, bullx, dexscreener, fomo, gmgn];

/**
 * All per-site knowledge: the catalog (display, exact host, category) joined with page reading where it exists —
 * URL identification, 代币资料, receiver image allowlist and page-layer layout. Order is the display order.
 */
export const sites: readonly SiteSpec[] = catalog.map(entry => ({ ...pages.find(page => page.id === entry.id), ...entry }));

export function siteByDomain(host: string): SiteSpec | undefined { return sites.find(site => site.domain === host); }
export function siteById(id: string): SiteSpec | undefined { return sites.find(site => site.id === id); }
/** 代币资料 configuration for `readVisibleToken`; undefined means the site never reads page content. */
export function siteProfile(host: string): SiteProfile | undefined { return siteByDomain(host)?.profile; }

/** Every public logo location any site may export; receivers accept exactly this union. */
export const siteImages: readonly SiteImage[] = sites.flatMap(site => site.profile?.images ?? [])
  .filter((image, index, all) => all.findIndex(other => other.host === image.host && other.path === image.path && other.file === image.file) === index);
