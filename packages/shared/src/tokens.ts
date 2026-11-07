import { base58 } from '@scure/base';
import type { Network } from './sites/index.ts';

/** Wire ids of the chains the token directory reads, with their display network and address family. */
export const tokenChains = ['robinhood', 'solana', 'bnb', 'ethereum', 'base'] as const;
export type TokenChain = typeof tokenChains[number];
export const evmTokenChains = ['robinhood', 'base', 'bnb', 'ethereum'] as const satisfies readonly TokenChain[];
export const tokenChainNetwork: Readonly<Record<TokenChain, Network>> = { robinhood: 'Robinhood', solana: 'Solana', bnb: 'BNB Chain', ethereum: 'Ethereum', base: 'Base' };
export const networkTokenChain = Object.fromEntries(Object.entries(tokenChainNetwork).map(([chain, network]) => [network, chain])) as Readonly<Record<Network, TokenChain>>;
export const isEvmChain = (chain: TokenChain) => chain !== 'solana';

export function isEvmAddress(value: string) { return /^0x[0-9a-fA-F]{40}$/.test(value); }
/** A base58 string that decodes to exactly 32 bytes, the shape of every Solana account. */
export function isSolanaAddress(value: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try { return base58.decode(value).length === 32; } catch { return false; }
}
/** Canonical directory address: lowercase hex for EVM chains, base58 as written for Solana; null when malformed. */
export function tokenAddress(chain: TokenChain, value: string): string | null {
  if (isEvmChain(chain)) return isEvmAddress(value) ? value.toLowerCase() : null;
  return isSolanaAddress(value) ? value : null;
}
/** Address family alone, before a chain is known. */
export function addressFamily(value: string): 'evm' | 'solana' | null {
  return isEvmAddress(value) ? 'evm' : isSolanaAddress(value) ? 'solana' : null;
}
