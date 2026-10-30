import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'dexscreener',
  identify: {
    chains: ['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'],
    // Pool identifiers must be resolved by the sender. Never treat them as token contracts.
    routes: [{ kind: 'pool', path: '^/([a-z]+)/([a-zA-Z0-9]+)/?$', chain: { group: 1 }, id: { group: 2 }, url: '{path}' }],
  },
  layout: { chart: chartSelectors },
});
