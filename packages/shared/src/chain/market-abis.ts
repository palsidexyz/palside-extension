import { parseAbi } from 'viem';

// https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol
export const poolManagerAbi = parseAbi([
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
]);
