import { SECOND_MS, MINUTE_MS } from '@palside/shared/units';
import { CHAT_SEND_BURST, CHAT_SEND_PER_MINUTE } from '@palside/shared/rules/messages';

/** At most this many service refusals are absorbed by waiting before a send is shown as failed. */
export const THROTTLE_RETRIES = 3;
/** A refusal asking for a longer wait is a quota, not pacing; it fails at once with its own text. */
export const THROTTLE_MAX_WAIT = MINUTE_MS;

/**
 * Mirrors the service's per-team chat bucket, so a fast typist queues locally instead of being refused.
 * `reserve` hands out send times in call order; `defer` adopts a wait the service asked for.
 */
export class SendPacer {
  private readonly next = new Map<string, number>();
  private readonly interval: number;
  private readonly burst: number;
  private readonly now: () => number;
  constructor(burst = CHAT_SEND_BURST, perMinute = CHAT_SEND_PER_MINUTE, now = () => Date.now()) { this.burst = burst; this.interval = MINUTE_MS / perMinute; this.now = now; }
  /** Claims the next slot for `key` and returns the time it may be used. */
  reserve(key: string) {
    const now = this.now();
    const tat = Math.max(this.next.get(key) ?? now, now) + this.interval;
    this.next.set(key, tat);
    return Math.max(now, tat - this.interval * this.burst);
  }
  /** Another device, or a wider account bucket, used the allowance: nothing before `until`. */
  defer(key: string, until: number) { this.next.set(key, Math.max(this.next.get(key) ?? 0, until + this.interval * (this.burst - 1))); }
  clear() { this.next.clear(); }
}

/**
 * Keeps each team's sends reaching the service in the order they were made: `take` claims the next turn at once, and its `ready`
 * settles when every earlier send has been handed to the service or given up. A turn must be released either way.
 */
export class SendLanes {
  private readonly tails = new Map<string, Promise<void>>();
  take(key: string) {
    const ready = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; });
    const tail = ready.then(() => done);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return { ready, release };
  }
}

/** The wait a throttled Matrix or business response asks for, when it is short enough to absorb. */
export function throttleWait(error: unknown) {
  if (!error || typeof error !== 'object') return;
  const value = error as { httpStatus?: number; status?: number; code?: string; errcode?: string; retryAfterMs?: number; data?: { retry_after_ms?: number } };
  if ((value.httpStatus ?? value.status) !== 429 || value.code === 'UPLOAD_QUOTA') return;
  const wait = value.retryAfterMs ?? value.data?.retry_after_ms ?? SECOND_MS;
  return wait <= THROTTLE_MAX_WAIT ? Math.max(wait, 250) : undefined;
}
