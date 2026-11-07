import { chartSelectors, defineSitePages } from './define.ts';

export default defineSitePages({
  id: 'birdeye',
  // birdeye.so redirects to birdeyeterminal.com with the same path; links shared from the old domain still read.
  aliases: ['birdeye.so'],
  tokenUrl: { path: '/{chain}/token/{id}', chains: { Solana: 'solana', 'BNB Chain': 'bsc', Ethereum: 'ethereum', Base: 'base' } },
  layout: { chart: chartSelectors },
});
