import { MINUTE_MS, SECOND_MS } from '@palside/shared/units';
import { REACTION_TTL_MS } from '@palside/shared/rules/interactions';
import { assetKey,pageKey,pageScopeUrl,samePage,viewAsset } from './interaction.ts';
import type { Message } from '../chat/model';
import type { Viewing } from '../assets/model';

export { assetKey, pageKey, pageScopeUrl, samePage, viewAsset };
/** Live, never stored: relayed like reactions. */
export const POKE_EVENT = 'com.palside.poke';

/** A received 喊你来看 stays in the chat, and its desktop notification stays valid, for five minutes. */
export const POKE_DISPLAY = 5 * MINUTE_MS;
/** Service-clock tolerance on either side of the relay's lifetime: the two devices' clock calibrations can each be off a little. */
const POKE_SKEW = 5 * SECOND_MS;
export type PokeWire = { id: string; teamId: string; view: unknown; sentAt: number };
/** 喊你来看 on the wire. `sentAt` and `serviceNow` are both service time, so the receiver's own clock never decides. */
export function readPokeWire(value: unknown, serviceNow: number): PokeWire | undefined {
  if (!value || typeof value !== 'object') return;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || c.id.length > 64 || typeof c.teamId !== 'string' || !c.teamId) return;
  if (typeof c.sentAt !== 'number' || !Number.isFinite(c.sentAt) || c.sentAt < serviceNow - REACTION_TTL_MS - POKE_SKEW || c.sentAt > serviceNow + POKE_SKEW) return;
  return { id: c.id, teamId: c.teamId, view: c.view, sentAt: c.sentAt };
}
/** Whether being on `here` answers a call to `called`: the same page, or the same token on any of its pages. */
export function reachedPoke(called: Viewing, here: Pick<Viewing, 'url' | 'kind' | 'chain' | 'address'>) {
  const asset = viewAsset(called);
  return samePage(called.url, here.url) || Boolean(asset) && asset === viewAsset(here);
}
/** Chain + normalized contract: discussions group by asset. */
export type AssetKey = string;

/**
 * A quote on a page, found again at any window size: signals anchor to it. `nth` of `of`: which of several identical quotes was
 * meant, so repeated text finds the same place again.
 */
export type RefTarget = { kind: 'quote'; exact: string; prefix: string; suffix: string; nth?: number; of?: number };
/** Most identical quotes a target can tell apart. */
export const QUOTE_OCCURRENCES = 50;

export function readRefTarget(value: unknown): RefTarget | undefined {
  if (!value || typeof value !== 'object') return;
  const t = value as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (t.kind === 'quote' && text(t.exact, 400) && Array.from(t.exact as string).length >= 2 && Array.from(t.exact as string).length <= 200 && typeof t.prefix === 'string' && Array.from(t.prefix).length <= 24 && typeof t.suffix === 'string' && Array.from(t.suffix).length <= 24) {
    const occurrence = Number.isInteger(t.nth) && Number.isInteger(t.of) && (t.nth as number) >= 0 && (t.nth as number) < (t.of as number) && (t.of as number) <= QUOTE_OCCURRENCES;
    return { kind: 'quote', exact: t.exact as string, prefix: t.prefix, suffix: t.suffix, ...(occurrence ? { nth: t.nth as number, of: t.of as number } : {}) };
  }
}

/** The sender of the earliest asset card you can see. */
export function firstSharer(messages: readonly Message[], asset: AssetKey) {
  return messages.filter(m => !m.recalled && m.status === 'sent' && m.attachment?.kind === 'asset' && viewAsset(m.attachment.view) === asset)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
}

/** 喊你来看 as received: `at` is when it last arrived on this device, `count` how many times the same person called to the same page. */
export type Poke = { id: string; teamId: string; from: string; view: Viewing; at: number; count: number };
