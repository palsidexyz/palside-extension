import { MINUTE_MS, SECOND_MS } from '@palside/shared/units';

/**
 * 跟看 between two devices, Olm to-device through the short-lived relay, never stored:
 * - `watch`: the follower tells the teammate they follow (only them) that following runs (`on`) or stopped/paused; repeated
 *   every `FOLLOW_WATCH_MS` while it runs, so a closed panel or a lost device drops out after `FOLLOW_WATCH_LIFE`.
 * - `scroll`: the followed teammate's page in front, scrolled to `y` (0 top … 1 bottom), sent only to the people following
 *   them, at most once per `FOLLOW_SCROLL_MS`. The follow tab scrolls there when it shows the same page; approximate,
 *   since windows and layouts differ.
 * - `tabs`: which of the followed teammate's tabs have come to the front since someone followed them and are still open, as
 *   random ids, and the one in front with its shared page. A snapshot, sent to the people following them when it changes and
 *   when they renew, so a late follower and a lost message both catch up. `gen` names the list: an id missing from the same
 *   list means that tab closed; a different list says nothing about the tabs before it.
 */
export const FOLLOW_EVENT = 'com.palside.follow';
export const FOLLOW_WATCH_MS = MINUTE_MS;
export const FOLLOW_WATCH_LIFE = 150 * SECOND_MS;
export const FOLLOW_SCROLL_MS = 1_500;
/** A follow event older or newer than this on the receiver's clock is dropped. */
export const FOLLOW_SKEW = 30 * SECOND_MS;
/** Follow tabs open at once; the one least recently in front closes for a new one. */
export const FOLLOW_TABS = 8;
/** Tabs of the followed account named in one snapshot. */
export const FOLLOW_LEAD_OPEN = 32;
/** The tab list outlives the last follower this long, so pausing and continuing keeps the same tabs. */
export const FOLLOW_LEAD_GRACE = 10 * MINUTE_MS;

export type FollowWire = { id: string; teamId: string; sentAt: number } & ({ kind: 'watch'; on: boolean } | { kind: 'scroll'; url: string; y: number } | { kind: 'tabs'; gen: string; open: string[]; front?: { tab: string; url: string } });
export type Follower = { teamId: string; personId: string; since: number; until: number };
export type LeadScroll = { teamId: string; personId: string; url: string; y: number; at: number };
export type LeadTabs = { teamId: string; personId: string; gen: string; open: string[]; front?: { tab: string; url: string }; at: number };

const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{8,64}$/.test(value);
const webUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value) && value.length <= 4096;

export function readFollowEvent(input: unknown, now: number): FollowWire | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (!id(value.id) || typeof value.teamId !== 'string' || !value.teamId || value.teamId.length > 200) return;
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt) || Math.abs(now - value.sentAt) > FOLLOW_SKEW) return;
  const base = { id: value.id as string, teamId: value.teamId, sentAt: value.sentAt };
  if (value.kind === 'watch' && typeof value.on === 'boolean') return { ...base, kind: 'watch', on: value.on };
  if (value.kind === 'tabs' && id(value.gen) && Array.isArray(value.open) && value.open.length <= FOLLOW_LEAD_OPEN && value.open.every(id)) {
    const front = value.front as { tab?: unknown; url?: unknown } | undefined;
    if (front === undefined) return { ...base, kind: 'tabs', gen: value.gen, open: value.open as string[] };
    if (front && id(front.tab) && value.open.includes(front.tab) && webUrl(front.url)) return { ...base, kind: 'tabs', gen: value.gen, open: value.open as string[], front: { tab: front.tab, url: front.url } };
    return;
  }
  if (value.kind === 'scroll' && webUrl(value.url)
    && typeof value.y === 'number' && value.y >= 0 && value.y <= 1) return { ...base, kind: 'scroll', url: value.url, y: Math.round(value.y * 1e4) / 1e4 };
}

/** The followers list after a `watch`: `on` adds or renews (keeping when they started), off removes; the expired leave. */
export function nextFollowers(list: readonly Follower[], teamId: string, personId: string, on: boolean, now: number): Follower[] {
  const alive = list.filter(item => item.until > now);
  const known = alive.find(item => item.teamId === teamId && item.personId === personId);
  const rest = alive.filter(item => item !== known);
  return on ? [...rest, { teamId, personId, since: known?.since ?? now, until: now + FOLLOW_WATCH_LIFE }] : rest;
}
