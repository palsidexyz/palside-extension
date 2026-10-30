import type { RuntimeState } from '../../../runtime/composition/runtime-state';

/** Boundary wakeups only: packets expire and leave the room ten minutes later, and a payment's quote lapses. */
export function walletDeadlines(state: Pick<RuntimeState, 'chainRoom' | 'chainTeam' | 'wallet'> | undefined, now: number): number[] {
  if (!state) return [];
  const deadlines = [
    ...(state.chainRoom?.packets ?? []).flatMap(item => [item.expiresAt, item.expiresAt + 600_000]),
    ...(state.chainTeam?.packets ?? []).map(item => item.packet.expiresAt),
    state.wallet?.payment?.order.expiresAt,
  ];
  return deadlines.filter((time): time is number => typeof time === 'number' && time > now);
}
