import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'bullx',
  tokenUrl: { path: '/terminal?chainId={chain}&address={id}', chains: { Solana: '1399811149', Ethereum: '1', 'BNB Chain': '56', Base: '8453' } },
  layout: { chart: chartSelectors },
});
