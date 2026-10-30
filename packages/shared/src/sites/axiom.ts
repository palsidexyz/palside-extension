import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'axiom',
  identify: {
    chains: ['Solana', 'BNB Chain', 'Robinhood', 'Base', 'Ethereum'],
    // The pool id is address-shaped but is still a pool, never a token contract.
    routes: [{ kind: 'pool', path: '^/meme/([a-zA-Z0-9]+)/?$', chain: { query: 'chain' }, id: { group: 1 }, url: '{path}?chain={chain}', idIsAddress: true }],
  },
  layout: { chart: chartSelectors },
});
