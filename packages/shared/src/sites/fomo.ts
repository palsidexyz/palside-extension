import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'fomo',
  tokenUrl: { path: '/tokens/{chain}/{id}', chains: { Robinhood: 'robinhood', Solana: 'solana', 'BNB Chain': 'bsc', Ethereum: 'ethereum', Base: 'base' } },
  layout: { chart: chartSelectors },
});
