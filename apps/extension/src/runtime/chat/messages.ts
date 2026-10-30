import type { RuntimeState } from '../composition/runtime-state';

export type QueuedMessage = {
  id?: string;
  teamId: string;
  at: number;
};

export type TeamSendQueue = { count: number; nextAt: number; items: { id: string; at: number }[] };

/** Per team: how many sends wait, when the next goes out, and each waiting message in release order. */
export function collectSendQueue(
  queued: Iterable<QueuedMessage>,
): Record<string, TeamSendQueue> {
  const result: Record<string, TeamSendQueue> = {};
  for (const item of queued) {
    const entry = result[item.teamId] ?? {
      count: 0,
      nextAt: item.at,
      items: [],
    };
    entry.count += 1;
    entry.nextAt = Math.min(entry.nextAt, item.at);
    if (item.id) entry.items.push({ id: item.id, at: item.at });
    result[item.teamId] = entry;
  }
  for (const entry of Object.values(result)) entry.items.sort((a, b) => a.at - b.at);
  return result;
}

export function publishSendQueue(
  state: RuntimeState,
  queued: Iterable<QueuedMessage>,
  emit: () => void,
): void {
  const queue = collectSendQueue(queued);
  state.sendQueue = Object.keys(queue).length ? queue : undefined;
  emit();
}
