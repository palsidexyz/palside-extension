import { chartSelectors, defineSitePages, dexScreenerImages } from './define.ts';

export default defineSitePages({
  id: 'birdeye',
  identify: {
    chains: ['Solana', 'BNB Chain', 'Ethereum', 'Base'],
    // The live site redirects shared query links to /<network>/token/<contract>.
    // Both are public source routes; the network in the canonical path is authoritative.
    routes: [
      { kind: 'token', path: '^/([a-z]+)/token/([^/]+)/?$', chain: { group: 1 }, id: { group: 2 }, url: '/{chain}/token/{id}' },
      { kind: 'token', path: '^/token/([^/]+)/?$', chain: { query: 'chain' }, id: { group: 1 }, url: '/token/{id}?chain={chain}' },
    ],
  },
  profile: { inline: 'span,strong', images: [dexScreenerImages] },
  layout: { chart: chartSelectors },
});
