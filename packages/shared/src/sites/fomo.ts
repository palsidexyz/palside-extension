import { chartSelectors, defineSitePages, dexScreenerImages } from './define.ts';

export default defineSitePages({
  id: 'fomo',
  identify: {
    chains: ['Robinhood', 'Solana', 'BNB Chain', 'Ethereum', 'Base'],
    routes: [{ kind: 'token', path: '^/tokens/([a-z]+)/([^/]+)/?$', flags: 'i', chain: { group: 1 }, id: { group: 2 }, url: '/tokens/{chain:lower}/{id}' }],
  },
  profile: {
    // "Market cap $1 | PONS | fomo": the symbol is the segment before the last bar.
    title: { match: '\\|\\s*fomo\\s*$', flags: 'i', name: '([^|]*)\\|[^|]*$' },
    inline: 'span,strong,div.leading-tight.truncate',
    images: [dexScreenerImages, { host: 'metadata.mobula.io', path: '/assets/logos/', file: '[a-fA-F0-9]{64}\\.png' }],
  },
  layout: { chart: chartSelectors },
});
