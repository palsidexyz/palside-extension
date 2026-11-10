import type { SitePages } from './define.ts';

/**
 * Sites whose every token lives on one chain, and explorers of chains Palside does not read. Other explorers (not listed)
 * are treated as `none` too, except multi-chain ones that name the chain in their URLs.
 */
export const siteChains: readonly SitePages[] = ([
  ['pump-fun', 'Solana'], ['bags', 'Solana'], ['bonk-fun', 'Solana'], ['boop', 'Solana'], ['heaven', 'Solana'], ['moonshot', 'Solana'],
  ['photon', 'Solana'], ['trojan', 'Solana'], ['jupiter', 'Solana'], ['raydium', 'Solana'], ['meteora', 'Solana'], ['orca', 'Solana'],
  ['rugcheck', 'Solana'], ['trenchbot', 'Solana'], ['kolscan', 'Solana'],
  ['four-meme', 'BNB Chain'], ['flap', 'BNB Chain'], ['clanker', 'Base'], ['zora', 'Base'], ['aerodrome', 'Base'], ['sunpump', 'none'],
  ['etherscan', 'Ethereum'], ['basescan', 'Base'], ['bscscan', 'BNB Chain'], ['robinhood-chain', 'Robinhood'],
  ['solscan', 'Solana'], ['solana-explorer', 'Solana'], ['solana-fm', 'Solana'], ['orb', 'Solana'],
] as const).map(([id, chain]) => ({ id, chain }));
/** Sites whose token pages live on another host than the catalog domain. */
export const siteAliases: readonly SitePages[] = [
  // gopluslabs.io/token-security/… redirects to the console host with the same path.
  { id: 'goplus', aliases: ['console.gopluslabs.io'] },
];
/** Explorers covering several chains, each named in the URL. */
export const multiChainExplorers: ReadonlySet<string> = new Set(['oklink', 'blockchair']);
