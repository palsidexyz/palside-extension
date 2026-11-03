export const UINT256_MAX = (1n << 256n) - 1n;
export function palsUnit(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new RangeError('Invalid token decimals');
  return 10n ** BigInt(decimals);
}
export function chainAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new RangeError('Invalid amount');
  const amount = BigInt(value);
  if (amount >= UINT256_MAX) throw new RangeError('Amount exceeds uint256');
  return amount;
}
