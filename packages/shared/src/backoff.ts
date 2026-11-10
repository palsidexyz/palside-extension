/** Retry delay after the given failed attempt (1-based): doubles from baseMs up to maxMs, then ±20% jitter. */
export function retryDelayMs(attempt: number, { baseMs, maxMs }: { baseMs: number; maxMs: number }, random: () => number = Math.random): number {
  const delay = Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(attempt, 1) - 1, 30));
  return Math.round(delay * (0.8 + 0.4 * random()));
}
