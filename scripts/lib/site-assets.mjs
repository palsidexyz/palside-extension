import { existsSync } from 'node:fs';

/** Design-master asset folders and the public folder each host receives them in. */
export const assetFolders = [['sites', 'site-logos'], ['chains', 'chain-logos'], ['avatars', 'avatars'], ['brand', 'brand'], ['team-avatars', 'team-avatars'], ['art', 'art'], ['tokens', 'tokens']];

// Full catalogs are used by the extension and by the website's public squad portraits.
export const hostAssets = {
  extension: {
    sites: 'all', chains: 'all', avatars: 'all', brand: ['palside.svg'],
    'team-avatars': 'all', art: ['team.webp'], tokens: ['cashcat.webp', 'pons.webp', 'chump.webp'],
  },
  website: {
    sites: ['gmgn.webp', 'fomo.webp', 'axiom.webp', 'dexscreener.webp', 'bullx.webp', 'birdeye.webp', 'jupiter.webp', 'dextools.webp', 'x.webp', 'coingecko.webp', 'defillama.webp', 'tradingview.webp'],
    chains: ['robinhood.webp'], avatars: 'all', brand: ['palside.svg'],
    'team-avatars': 'all', art: [], tokens: 'all',
  },
};

/** Hosts checked out in this tree; the public export contains only the extension. */
export const presentHosts = (root = new URL('../../', import.meta.url)) => Object.keys(hostAssets).filter(host => existsSync(new URL(`apps/${host}/package.json`, root)));
