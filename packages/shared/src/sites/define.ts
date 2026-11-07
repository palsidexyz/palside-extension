export type Network = 'Robinhood' | 'Solana' | 'BNB Chain' | 'Ethereum' | 'Base';
export type SiteCategory = 'terminal' | 'dex' | 'perp' | 'prediction' | 'exchange' | 'launchpad' | 'market' | 'analytics' | 'security' | 'explorer' | 'social' | 'news';

/** A route capture (`group`) or one unrepeated query parameter (`query`), optionally mapped to a network. */
export type RouteValue = { group: number } | { query: string; map?: Readonly<Record<string, Network>> };
/**
 * A trading-pool page: the server maps the pool to the one token it trades. The first matching route decides the page.
 * `url` is the canonical source path: `{chain}` is the raw chain key, `{id}` the pool and `{path}` the matched pathname
 * without a trailing slash. A route without a chain is read on Solana when the pool is a Solana account.
 */
export type SiteRoute = { path: string; flags?: string; chain: RouteValue; id: RouteValue; url: string };
/** Where a token's page is on a site, for jumps from 热门 and 详情: `{chain}` is the site's key for that network, `{id}` the contract. */
export type TokenUrl = { path: string; chains: Readonly<Partial<Record<Network, string>>> };
/**
 * How Palside reads one catalog site's pages, keyed by the catalog id. Token pages on crypto sites are read by the generic URL
 * parser (address, chain parameter, chain path segment); a site needs an entry only for what the parser cannot know.
 */
export type SitePages = {
  id: string;
  /** Pool routes; adding one also requires real route evidence in docs/reference/sites.md. */
  pools?: { chains: readonly Network[]; routes: readonly SiteRoute[] };
  /** The one chain every token on the site lives on; `none` when that chain is not one Palside reads, so no address is looked up. */
  chain?: Network | 'none';
  /** Hosts that serve the same pages, such as an old domain that now redirects. Only URL reading uses them. */
  aliases?: readonly string[];
  tokenUrl?: TokenUrl;
  /** Page-layer layout hints. Sites without them use the generic adapter. */
  layout?: { chart: readonly string[] };
};

export type SiteSpec = Omit<SitePages, 'id'> & { id: string; name: string; domain: string; category: SiteCategory; plate?: 'light' | 'dark' };

export function defineSitePages<const T extends SitePages>(pages: T): T { return pages; }

/** Chart-like blocks on the supported trading pages; generated class names change too often for exact selectors. */
export const chartSelectors = ['[class*="chart" i]', '[data-testid*="chart" i]', 'canvas'] as const;