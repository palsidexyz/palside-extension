import { nearestEqualPacketTotal } from '../../domain/wallet/model';
import { toHex, zeroHash } from 'viem';
import { chainAmount, palsUnit } from '@palside/shared/chain/amount';
import { CHAIN_RULES } from '@palside/shared/rules/wallet';
import type { ChainOrderInput } from '@palside/shared/contracts/chain';

function randomBelow(max: bigint): bigint {
  const bits = max.toString(2).length, bytes = Math.ceil(bits / 8), mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const value = BigInt(toHex(crypto.getRandomValues(new Uint8Array(bytes)))) & mask;
    if (value < max) return value;
  }
}
/** Allocate exact amounts locally (random shares in whole PALS); each random allocation commits an independent salt. */
export function createPacketInput(input: { kind: 'team' | 'room'; scope: string; count: number; distribution: 'equal' | 'random'; total: string; blessing?: string }, decimals = 18): Extract<ChainOrderInput, { kind: 'packet' }> {
  const total = chainAmount(input.total), minimum = palsUnit(decimals);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > CHAIN_RULES.maxPacketCount || total < minimum * BigInt(input.count)) throw new Error('INVALID_PACKET_AMOUNT');
  if (input.kind === 'room' && input.distribution !== 'random') throw new Error('INVALID_PACKET_DISTRIBUTION');
  const amounts: bigint[] = [];
  if (input.distribution === 'equal') {
    if (nearestEqualPacketTotal(total, input.count, decimals) !== total) throw new Error('INVALID_PACKET_AMOUNT');
    amounts.push(...Array.from({ length: input.count }, () => total / BigInt(input.count)));
  } else {
    // Shares are whole PALS; only a fractional part typed into the total stays on one share.
    let left = total / minimum;
    for (let remaining = input.count; remaining > 1; remaining--) {
      const cap = left - BigInt(remaining - 1), twiceMean = 2n * left / BigInt(remaining);
      const maximum = cap < twiceMean ? cap : twiceMean;
      const amount = 1n + randomBelow(maximum);
      amounts.push(amount * minimum); left -= amount;
    }
    amounts.push(left * minimum + total % minimum);
    for (let i = amounts.length - 1; i > 0; i--) { const j = Number(randomBelow(BigInt(i + 1))); [amounts[i], amounts[j]] = [amounts[j]!, amounts[i]!]; }
  }
  return { kind: 'packet', packet: { kind: input.kind, scope: input.scope, count: input.count, distribution: input.distribution, amounts: amounts.map(String), allocationSalts: amounts.map(() => input.distribution === 'random' ? toHex(crypto.getRandomValues(new Uint8Array(32))) : zeroHash), ...(input.blessing ? { blessing: input.blessing } : {}) } };
}
