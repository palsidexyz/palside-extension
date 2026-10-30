import { toHex, zeroHash } from 'viem';
import { chainAmount, CHAIN_RULES, palsUnit } from '@palside/shared/chain/rules';
import type { ChainOrderInput } from '@palside/shared/contracts/chain';

function randomBelow(max: bigint): bigint {
  const bits = max.toString(2).length, bytes = Math.ceil(bits / 8), mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const value = BigInt(toHex(crypto.getRandomValues(new Uint8Array(bytes)))) & mask;
    if (value < max) return value;
  }
}
/** Allocate exact integer amounts locally; each random allocation commits an independent salt. */
export function createPacketInput(input: { kind: 'team' | 'invitation' | 'room'; scope: string; count: number; distribution: 'equal' | 'random'; total: string; blessing?: string }, decimals = 18): Extract<ChainOrderInput, { kind: 'packet' }> {
  const total = chainAmount(input.total), minimum = palsUnit(decimals);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > CHAIN_RULES.maxPacketCount || total < minimum * BigInt(input.count)) throw new Error('INVALID_PACKET_AMOUNT');
  if (input.kind === 'room' && input.distribution !== 'random' || input.kind === 'invitation' && input.distribution !== 'equal') throw new Error('INVALID_PACKET_DISTRIBUTION');
  const amounts: bigint[] = [];
  if (input.distribution === 'equal') {
    if (total % BigInt(input.count) !== 0n) throw new Error('INVALID_PACKET_AMOUNT');
    amounts.push(...Array.from({ length: input.count }, () => total / BigInt(input.count)));
  } else {
    let left = total;
    for (let remaining = input.count; remaining > 1; remaining--) {
      const cap = left - minimum * BigInt(remaining - 1), twiceMean = 2n * left / BigInt(remaining);
      const maximum = cap < twiceMean ? cap : twiceMean;
      const amount = minimum + randomBelow(maximum - minimum + 1n);
      amounts.push(amount); left -= amount;
    }
    amounts.push(left);
    for (let i = amounts.length - 1; i > 0; i--) { const j = Number(randomBelow(BigInt(i + 1))); [amounts[i], amounts[j]] = [amounts[j]!, amounts[i]!]; }
  }
  return { kind: 'packet', packet: { kind: input.kind, scope: input.scope, count: input.count, distribution: input.distribution, amounts: amounts.map(String), allocationSalts: amounts.map(() => input.distribution === 'random' ? toHex(crypto.getRandomValues(new Uint8Array(32))) : zeroHash), ...(input.blessing ? { blessing: input.blessing } : {}) } };
}
