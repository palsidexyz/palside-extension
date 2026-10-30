import type { Message } from '../../../domain/chat/model';

type ReadingAnchor = { id: string; offset: number };
export type ReadingPosition = { latest: boolean; top: number; anchors: ReadingAnchor[] };
type MessageBounds = { id: string; top: number; height: number };
export const latestTolerance = 24;

/** A far jump first moves to within this distance of its target, then scrolls the rest for real. */
const glideReach = 800;
/** Where a programmatic scroll starts after the far-jump shortcut, how far it travels and for how long. */
export function glidePlan(from: number, to: number, reach = glideReach) {
  const start = Math.abs(to - from) > reach ? to - Math.sign(to - from) * reach : from;
  const path = to - start;
  return { start, path, duration: Math.abs(path) < 1 ? 0 : 300 + Math.min(Math.abs(path) / reach, 1) * 300 };
}
export const glideEase = (t: number) => 1 - (1 - t) ** 3;

/** The return trail shown in the reading navigation: the first stop, the last ones, and an ellipsis between when it grows long. */
export function trailView<T>(entries: T[], visible = 3): { entry: T; index: number; gap?: boolean }[] {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  if (indexed.length <= visible) return indexed;
  return [indexed[0]!, { ...indexed[1]!, gap: true }, ...indexed.slice(indexed.length - (visible - 1))];
}

export function captureReadingPosition(rows: MessageBounds[], top: number, height: number, latest: boolean): ReadingPosition {
  const first = rows.findIndex(row => row.top + row.height > top);
  // Keep neighbouring anchors so a deletion can preserve a surviving message.
  const anchors = first < 0 ? [] : rows.slice(Math.max(0, first - 1), first + 4)
    .sort((a, b) => Number(a.top + a.height <= top) - Number(b.top + b.height <= top))
    .filter(row => row.top < top + height || row === rows[first + 1])
    .map(row => ({ id: row.id, offset: row.top - top }));
  return { latest, top, anchors };
}

export function readingTop(position: ReadingPosition, rows: MessageBounds[], max: number): number {
  if (position.latest) return max;
  for (const anchor of position.anchors) {
    const row = rows.find(item => item.id === anchor.id);
    if (row) return Math.max(0, Math.min(max, row.top - anchor.offset));
  }
  return Math.max(0, Math.min(max, position.top));
}

export function parseReadingPosition(value: string | null): ReadingPosition | undefined {
  try {
    const p = JSON.parse(value ?? 'null');
    if (!p || typeof p.latest !== 'boolean' || !Number.isFinite(p.top) || p.top < 0 || !Array.isArray(p.anchors)) return;
    const anchors = p.anchors.filter((a: ReadingAnchor) => a && typeof a.id === 'string' && Number.isFinite(a.offset)).slice(0, 5);
    return { latest: p.latest, top: p.top, anchors };
  } catch { return; }
}

/** Window-local arrivals; account-wide unread preferences are deliberately absent. */
export class ChatArrivals {
  private seen = new Set<string>();
  private initialised = false;
  readonly pending = new Set<string>();

  update(messages: Message[], self: string) {
    const valid = new Set(messages.filter(m => m.status === 'sent' && !m.recalled && m.author !== self && (m.expiresAt === undefined || m.expiresAt > Date.now())).map(m => m.id));
    for (const id of this.pending) if (!valid.has(id)) this.pending.delete(id);
    for (const message of messages) {
      if (this.initialised && !this.seen.has(message.id) && message.liveArrival && valid.has(message.id)) this.pending.add(message.id);
      this.seen.add(message.id);
    }
    this.initialised = true;
  }

  acknowledge(ids: Iterable<string>) { for (const id of ids) this.pending.delete(id); }
  clear() { this.pending.clear(); }
}
