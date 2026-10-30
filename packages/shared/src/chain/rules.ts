export const CHAIN_RULES = Object.freeze({
  orderLifetimeMs: 300_000, roomStayMs: 30_000, accountAgeMs: 86_400_000,
  tipGroupMs: 30_000, maxRoomPackets: 5, maxPacketCount: 100,
  packetsPerHour: 10, roomClaimsPerDay: 20, dailySponsoredLimit: 20,
});
/** How long grabs stay open. The escrow closes PACKET_SETTLEMENT_MS later so assigned shares still settle; then it refunds. */
export const PACKET_LIFETIMES = { team: 86_400_000, invitation: 604_800_000, room: 3_600_000 } as const;
export const PACKET_SETTLEMENT_MS = 7_200_000;
export const UINT256_MAX = (1n << 256n) - 1n;
export function palsUnit(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new RangeError('Invalid token decimals');
  return 10n ** BigInt(decimals);
}
export function chainAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new RangeError('Invalid amount');
  const amount = BigInt(value);
  if (amount > UINT256_MAX) throw new RangeError('Amount exceeds uint256');
  return amount;
}
