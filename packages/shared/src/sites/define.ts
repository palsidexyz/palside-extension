export type Network = 'Robinhood' | 'Solana' | 'BNB Chain' | 'Ethereum' | 'Base';
export type SiteCategory = 'terminal' | 'dex' | 'perp' | 'prediction' | 'exchange' | 'launchpad' | 'market' | 'analytics' | 'security' | 'explorer' | 'social' | 'news';

/** A route capture (`group`) or one unrepeated query parameter (`query`), optionally mapped to a network. */
export type RouteValue = { group: number } | { query: string; map?: Readonly<Record<string, Network>> };
/**
 * The first route whose `path` matches decides the page: a valid chain and id give an asset or pool, anything else a website.
 * `url` is the canonical source path: `{chain}` is the raw chain key, `{chain:lower}` its lowercase form,
 * `{id}` the normalized contract and `{path}` the matched pathname without a trailing slash.
 */
export type SiteRoute = { kind: 'token' | 'pool'; path: string; flags?: string; chain: RouteValue; id: RouteValue; url: string; idIsAddress?: boolean };
/** One public image location: the reader accepts the `path` prefix, receivers the full `path` + `file` pattern. */
export type SiteImage = { host: string; path: string; file: string };
/**
 * 代币资料: plain data passed as an `executeScript` argument, so it must stay JSON-serializable.
 * `title.match` recognizes the site's title format and `title.name` captures the symbol in group 1;
 * `strip` removes decorations before validation. `inline` lists leaf labels that may repeat the title symbol.
 */
export type SiteProfile = { title?: { match: string; flags?: string; name: string; strip?: string }; inline: string; images: readonly SiteImage[] };
/** How Palside reads one catalog site's pages, keyed by the catalog id. Sites without it are shared by name only. */
export type SitePages = {
  id: string;
  /** Route coverage; adding a chain or route also requires real route evidence in docs/reference/sites.md. */
  identify?: { chains: readonly Network[]; routes: readonly SiteRoute[] };
  profile?: SiteProfile;
  /** Page-layer layout hints. Sites without them use the generic adapter. */
  layout?: { chart: readonly string[] };
};

export type SiteSpec = Omit<SitePages, 'id'> & { id: string; name: string; domain: string; category: SiteCategory; plate?: 'light' | 'dark' };

export function defineSitePages<const T extends SitePages>(pages: T): T { return pages; }

/** Chart-like blocks on the supported trading pages; generated class names change too often for exact selectors. */
export const chartSelectors = ['[class*="chart" i]', '[data-testid*="chart" i]', 'canvas'] as const;
/** DEX Screener's public CDN, which several token pages reuse for logos. */
export const dexScreenerImages: SiteImage = { host: 'cdn.dexscreener.com', path: '/cms/images/', file: '[a-zA-Z0-9_-]{1,256}(?:\\.(?:png|jpe?g|webp))?' };
