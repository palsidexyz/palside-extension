import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'axiom',
  // Token pages are /token/<contract>?chain=sol|bnb|robinhood|base|eth and need no rule; /meme/ pages name a pool.
  pools: { chains: ['Solana', 'BNB Chain', 'Robinhood', 'Base', 'Ethereum'], routes: [{ path: '^/meme/([a-zA-Z0-9]+)/?$', chain: { query: 'chain' }, id: { group: 1 }, url: '{path}?chain={chain}' }] },
  tokenUrl: { path: '/token/{id}?chain={chain}', chains: { Solana: 'sol', 'BNB Chain': 'bnb', Robinhood: 'robinhood', Base: 'base', Ethereum: 'eth' } },
  layout: { chart: chartSelectors },
});
