import type { ChainClientConfig, ChainOrder, ChainOrderInput } from '@palside/shared/contracts/chain';
import { chainAmount, palsUnit } from '@palside/shared/chain/rules';

export const WALLET_PATH = "m/44'/60'/0'/0/0" as const;
export const WALLET_LIMITS = Object.freeze({ single: 250n, daily: 1000n, privateKeyExposureMs: 30_000 });
export type PaymentPhase = 'review' | 'password' | 'signing' | 'submitting' | 'pending' | 'confirmed' | 'failed' | 'expired';
export type WalletPayment = {
  id: string; input: ChainOrderInput; order: ChainOrder; phase: PaymentPhase;
  passwordRequired: boolean; total: string; error?: string; requestId?: string;
  signed?: boolean;
};
export type WalletPreferences = { smallPayments: boolean; hideAmounts: boolean };
export type WalletAvailability = 'loading' | 'closed' | 'locked' | 'ready' | 'offline';
export type WalletBaseState = {
  address: string; availability: WalletAvailability; config?: ChainClientConfig;
  preferences: WalletPreferences; payment?: WalletPayment; openedNotice: boolean;
};
export function paymentTotal(order: ChainOrder): bigint { return chainAmount(order.amount); }
export function allowsSmallPayment(input: ChainOrderInput, amount: bigint, spent: bigint, decimals: number): boolean {
  const unit = palsUnit(decimals);
  return !(input.kind === 'transfer' && 'recipient' in input) && amount > 0n && amount <= WALLET_LIMITS.single * unit && spent + amount <= WALLET_LIMITS.daily * unit;
}
export function terminalPayment(phase: PaymentPhase): boolean { return phase === 'confirmed' || phase === 'failed' || phase === 'expired'; }
/** Decimal input never passes through a floating point number. */
export function parsePals(value: string, decimals: number): bigint {
  const unit = palsUnit(decimals);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) throw new Error('INVALID_AMOUNT');
  const amount = BigInt(match[1]!) * unit + BigInt((match[2] ?? '').padEnd(decimals, '0'));
  chainAmount(amount.toString());
  return amount;
}
