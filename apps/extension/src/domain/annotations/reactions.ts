import { REACTION_TTL_MS } from '@palside/shared/contracts/limits';
/** The fixed team reaction set; receivers ignore anything else. `name` selects the translated label. */
export const reactionEmojis = [
  { emoji: '🔥', name: 'fire' },
  { emoji: '🚀', name: 'rocket' },
  { emoji: '👀', name: 'eyes' },
  { emoji: '😂', name: 'laugh' },
  { emoji: '😱', name: 'shock' },
  { emoji: '👍', name: 'like' },
] as const;
export type ReactionEmoji = (typeof reactionEmojis)[number]['emoji'];
export type Reaction = { id: string; teamId: string; personId: string; emoji: ReactionEmoji; count: number; at: number };

/** Held or repeated presses travel as one reaction carrying a count. */
export const REACTION_MAX_COUNT = 20;
/** How long a received reaction stays in runtime state for panels to pick up. */
export const REACTION_DISPLAY = 6_000;

export function reactionName(emoji: string) { return reactionEmojis.find(item => item.emoji === emoji)?.name ?? 'other'; }
export function isReactionEmoji(value: unknown): value is ReactionEmoji { return reactionEmojis.some(item => item.emoji === value); }

/** Validates a decrypted reaction payload; clock skew of a few seconds is tolerated. */
export function readReaction(content: Record<string, unknown>, now = Date.now()) {
  const { id, teamId, emoji, count, sentAt } = content;
  if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id) || typeof teamId !== 'string' || !isReactionEmoji(emoji)) return;
  if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > REACTION_MAX_COUNT) return;
  if (typeof sentAt !== 'number' || sentAt < now - REACTION_TTL_MS || sentAt > now + 5_000) return;
  return { id, teamId, emoji, count: count as number };
}

/** Keeps the live window: newest last, nothing expired, at most `limit` entries. */
export function pruneReactions(reactions: readonly Reaction[], now = Date.now(), limit = 24) {
  return reactions.filter(item => item.at > now - REACTION_DISPLAY).slice(-limit);
}

/**
 * Sender batching. Taps on one emoji within `idle` (longer than the 550 ms hold repeat) merge into one send; a held press flushes at
 * least every `span`, so friends see a stream rather than one late burst. Switching emoji or team
 * flushes the previous batch first.
 */
export class ReactionBatcher {
  private pending?: { teamId: string; emoji: ReactionEmoji; count: number; since: number };
  private timer?: ReturnType<typeof setTimeout>;
  private readonly send: (teamId: string, emoji: ReactionEmoji, count: number) => void;
  private readonly idle: number;
  private readonly span: number;
  private readonly now: () => number;
  constructor(send: (teamId: string, emoji: ReactionEmoji, count: number) => void, idle = 650, span = 1_200, now = () => Date.now()) {
    this.send = send; this.idle = idle; this.span = span; this.now = now;
  }
  add(teamId: string, emoji: ReactionEmoji) {
    if (this.pending && (this.pending.teamId !== teamId || this.pending.emoji !== emoji)) this.flush();
    this.pending ??= { teamId, emoji, count: 0, since: this.now() };
    this.pending.count += 1;
    clearTimeout(this.timer);
    if (this.pending.count >= REACTION_MAX_COUNT || this.now() - this.pending.since >= this.span) { this.flush(); return; }
    this.timer = setTimeout(() => this.flush(), Math.min(this.idle, this.span - (this.now() - this.pending.since)));
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    const batch = this.pending; this.pending = undefined;
    if (batch) this.send(batch.teamId, batch.emoji, batch.count);
  }
}
