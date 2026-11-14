import { QUICK_PAY_LIMITS } from '@palside/shared/rules/wallet';
import type { ChainClientConfig, ChainOrder, ChainOrderInput } from '@palside/shared/contracts/chain';
import { chainAmount, palsUnit } from '@palside/shared/chain/amount';

export const WALLET_PATH = "m/44'/60'/0'/0/0" as const;
export type PaymentPhase = 'review' | 'password' | 'signing' | 'submitting' | 'pending' | 'confirmed' | 'failed' | 'expired';
export type WalletPayment = {
  id: string; input: ChainOrderInput; order: ChainOrder; phase: PaymentPhase;
  passwordRequired: boolean; total: string; error?: string; requestId?: string;
  /** sentAt is when 付款 sent it on its way (signing began): where the chat places it until the service records the submission. */
  signed?: boolean; sentAt?: number; pendingSince?: number; quickPayResetAt?: number;
  /** While signed but not yet accepted: the service is resubmitting it because fee sponsorship refused (`sponsor`) or the reply was unclear. */
  retrying?: 'sponsor' | 'unclear';
};
export type WalletPreferences = { smallPayments: boolean; hideAmounts: boolean };
export type WalletAvailability = 'loading' | 'closed' | 'locked' | 'ready' | 'offline';
export type WalletBaseState = {
  address: string; availability: WalletAvailability; config?: ChainClientConfig;
  preferences: WalletPreferences; payment?: WalletPayment; openedNotice: boolean;
};
export function paymentTotal(order: ChainOrder): bigint { return chainAmount(order.amount); }
export function quickPayLimits(config: ChainClientConfig['quickPay']) {
  const single = BigInt(config.single), daily = BigInt(config.daily), cap = { single: BigInt(QUICK_PAY_LIMITS.single), daily: BigInt(QUICK_PAY_LIMITS.daily) };
  return { single: single < cap.single ? single : cap.single, daily: daily < cap.daily ? daily : cap.daily };
}
export function smallPaymentStatus(input: ChainOrderInput, amount: bigint, spent: bigint, decimals: number, config: ChainClientConfig['quickPay']): 'allowed' | 'password' | 'daily-limit' {
  const unit = palsUnit(decimals), limits = quickPayLimits(config);
  if (input.kind === 'transfer' && 'recipient' in input || amount <= 0n || amount > limits.single * unit) return 'password';
  return spent + amount <= limits.daily * unit ? 'allowed' : 'daily-limit';
}
export function nextUtcDay(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
export function nearestEqualPacketTotal(total: bigint, count: number, decimals: number): bigint {
  const shares = BigInt(count), minimum = palsUnit(decimals) * shares;
  const lower = total / shares * shares, upper = lower + shares;
  return lower < minimum ? minimum : total - lower <= upper - total ? lower : upper;
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
