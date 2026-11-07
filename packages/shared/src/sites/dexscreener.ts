import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'dexscreener',
  // The id is a pool or a token; the server checks for pool getters and otherwise reads it as the token.
  pools: { chains: ['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'], routes: [{ path: '^/([a-z]+)/([a-zA-Z0-9]+)/?$', chain: { group: 1 }, id: { group: 2 }, url: '{path}' }] },
  tokenUrl: { path: '/{chain}/{id}', chains: { Robinhood: 'robinhood', Solana: 'solana', 'BNB Chain': 'bsc', Ethereum: 'ethereum', Base: 'base' } },
  layout: { chart: chartSelectors },
});
