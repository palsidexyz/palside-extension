import { chartSelectors, defineSitePages, dexScreenerImages } from './define.ts';

export default defineSitePages({
  id: 'bullx',
  identify: {
    chains: ['Solana', 'BNB Chain', 'Ethereum', 'Base'],
    routes: [{
      kind: 'token', path: '^/terminal/?$',
      chain: { query: 'chainId', map: { '1399811149': 'Solana', '1': 'Ethereum', '56': 'BNB Chain', '8453': 'Base' } },
      id: { query: 'address' }, url: '/terminal?chainId={chain}&address={id}',
    }],
  },
  profile: { inline: 'span,strong', images: [dexScreenerImages] },
  layout: { chart: chartSelectors },
});
