import type { Message } from './model.ts';

/** Anything shown between chat messages at a confirmed time, such as a payment card. */
export type TimedEntry = { timestamp: number };

const pending = (message: Message) => message.status !== 'sent';

/**
 * The one chat order: confirmed messages by service time, then this device's unconfirmed sends in the order they were written.
 * A confirmed message's `timestamp` is its service time; an unconfirmed one's is when it was written. A send keeps its place
 * while it is pending and when it confirms, because sends in one team reach the service in the order they were written.
 * Sorts in place and returns the same array.
 */
export function orderMessages(messages: Message[]): Message[] {
  return messages.sort((a, b) => Number(pending(a)) - Number(pending(b)) || (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/**
 * Interleaves timed entries into messages that are already in chat order, without reordering either list. An entry goes
 * before the first confirmed message with a later time; unconfirmed sends stay together after every entry, because their
 * written time is not comparable with service times.
 */
export function interleaveTimed<T extends TimedEntry>(messages: readonly Message[], entries: readonly T[]): ({ message: Message } | { entry: T })[] {
  const timed = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const result: ({ message: Message } | { entry: T })[] = [];
  let next = 0;
  for (const message of messages) {
    while (next < timed.length && (pending(message) || timed[next]!.timestamp < (message.timestamp ?? 0))) result.push({ entry: timed[next++]! });
    result.push({ message });
  }
  while (next < timed.length) result.push({ entry: timed[next++]! });
  return result;
}
