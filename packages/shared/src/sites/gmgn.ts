import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'gmgn',
  tokenUrl: { path: '/{chain}/token/{id}', chains: { Robinhood: 'robinhood', Solana: 'sol', 'BNB Chain': 'bsc', Ethereum: 'eth', Base: 'base' } },
  layout: { chart: chartSelectors },
});
