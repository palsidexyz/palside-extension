/** A short, bounded memory of failed images avoids repeat requests when cards remount. */
export class TokenImageFailures {
  private entries = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  has(source: string) {
    const expires = this.entries.get(source);
    if (expires === undefined) return false;
    if (expires <= this.now()) { this.entries.delete(source); return false; }
    return true;
  }
  remember(source: string) {
    const now = this.now();
    for (const [key, expires] of this.entries) if (expires <= now) this.entries.delete(key);
    this.entries.delete(source); this.entries.set(source, now + 60_000);
    while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
  }
  forget(source: string) { this.entries.delete(source); }
}
export const tokenImageFailures = new TokenImageFailures();
