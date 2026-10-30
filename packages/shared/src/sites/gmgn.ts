import { chartSelectors, defineSitePages, dexScreenerImages } from './define.ts';

export default defineSitePages({
  id: 'gmgn',
  identify: {
    chains: ['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'],
    // This route carries a contract/mint, not a trading pool.
    routes: [{ kind: 'token', path: '^/([a-z]+)/token/([^/]+)/?$', flags: 'i', chain: { group: 1 }, id: { group: 2 }, url: '/{chain:lower}/token/{id}' }],
  },
  profile: {
    // "PONS $0.1 | GMGN.AI"; price arrows may surround the symbol.
    title: { match: '\\| GMGN\\.AI', name: '^(.+?)\\s+\\$', strip: '^[\\s↑↓▲▼↗↘⬆⬇]+|[\\s↑↓▲▼↗↘⬆⬇]+$' },
    inline: 'span,strong',
    images: [dexScreenerImages, { host: 'gmgn.ai', path: '/external-res/', file: '[a-zA-Z0-9_-]{1,128}\\.(?:png|jpe?g|webp)' }],
  },
  layout: { chart: chartSelectors },
});
