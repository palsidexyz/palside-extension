import { defaultWheel,signalEmotes,signalKinds,type SignalKind,type WheelEntry } from '@palside/shared/signals';
import { identifyPage } from '@palside/shared/navigation';
import { assetKey,pageScopeUrl,readRefTarget,type RefTarget } from '../../domain/annotations/social.ts';

export const SIGNAL_EVENT = 'com.palside.signal';
/** The lasting record of a signal in the squad's chat: an encrypted room event, kept and expiring like the squad's messages. */
export const SIGNAL_RECORD_EVENT = 'com.palside.signal_record';
/** How long a signal shows, counted from when this device received it. */
export const SIGNAL_TTL = 5_000;
/** Records this device holds per squad, newest kept. */
export const SIGNAL_RECORD_LIMIT = 200;
/** Records this device writes a minute. Past it a signal still plays, with no line in the chat, so signals cannot use up the squad's chat sends. */
export const SIGNAL_RECORDS_PER_MINUTE = 20;
/** A send time in service time this far from ours is still accepted, and nothing older is. */
export const SIGNAL_CLOCK_SKEW = 15_000;
export { defaultWheel, signalEmotes, signalKinds, type SignalEmote, type SignalKind, type WheelEntry } from '@palside/shared/signals';
/**
 * Where a signal points: a few anchors, nearest first. A receiver shows the signal at the first anchor it can find on
 * its own page, so a missing word falls back to the block around it instead of the page edge. Text compares with
 * whitespace collapsed; when an exact match fails, a match that reads the same with standalone numbers equal counts if it
 * is the only one, so a ticking price still matches while table rows stay distinct. `nth`/`of` pick one of several
 * equal matches and only apply when the receiver finds exactly `of` of them. `x`/`y` are the point inside the
 * anchor's box (0–1), for a quote the box around its words: the signal lands where it was pressed, not at the words' centre.
 */
export type SignalQuoteAnchor = Extract<RefTarget, { kind: 'quote' }> & { nth: number; of: number; x: number; y: number };
/** `cls` is the class list, used only when nothing else names the element: members load the same site build. */
export type SignalElementAnchor = { kind: 'element'; tag: string; id?: string; role?: string; label?: string; text?: string; cls?: string; href?: string; src?: string; nth: number; of: number; x: number; y: number };
export type SignalChartAnchor = { kind: 'chart'; x: number; y: number };
export type SignalAnchor = SignalQuoteAnchor | SignalElementAnchor | SignalChartAnchor;
export type SignalTarget = { kind: 'page' } | { kind: 'spot'; anchors: SignalAnchor[] };
export const SIGNAL_ANCHORS = 4;
/** Equal matches an anchor may tell apart by order. In feeds and tables an equal count does not mean the same items,
 * so an anchor with more matches is skipped for a larger one. */
export const SIGNAL_MATCHES = 3;
const elementTags = new Set(['a', 'img', 'picture', 'svg', 'video', 'button', 'form', 'fieldset', 'div', 'span', 'p', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'figure', 'figcaption', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th', 'label', 'strong', 'em', 'b', 'i', 'small', 'time', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** URLs are identity only and are never fetched. */
export function signalIdentityUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000- \u007f]/u.test(value)) return;
  return pageScopeUrl(value);
}
const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const ordinal = (nth: unknown, of: unknown) => Number.isInteger(nth) && Number.isInteger(of) && (of as number) >= 1 && (of as number) <= SIGNAL_MATCHES && (nth as number) >= 0 && (nth as number) < (of as number);
export function readSignalElementAnchor(value: unknown): SignalElementAnchor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'element' || typeof v.tag !== 'string' || !elementTags.has(v.tag) || !unit(v.x) || !unit(v.y) || !ordinal(v.nth, v.of)) return;
  const result: SignalElementAnchor = { kind: 'element', tag: v.tag, nth: v.nth as number, of: v.of as number, x: v.x, y: v.y };
  for (const [key, maximum] of [['id', 128], ['role', 32], ['label', 160], ['text', 240], ['cls', 160]] as const) {
    const item = v[key];
    if (item === undefined) continue;
    if (typeof item !== 'string' || !item.trim() || item.length > maximum || /[\u0000-\u001f\u007f]/u.test(item)) return;
    if (key === 'id' && !/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(item)) return;
    if (key === 'cls' && !/^[\w-]+(?: [\w-]+)*$/.test(item)) return;
    if (key === 'role' && (!/^[a-z]+$/.test(item) || ['textbox', 'combobox', 'searchbox', 'spinbutton'].includes(item))) return;
    result[key] = item;
  }
  for (const key of ['href', 'src'] as const) {
    if (v[key] === undefined) continue;
    const url = signalIdentityUrl(v[key]);
    if (!url || url !== v[key]) return;
    result[key] = url;
  }
  if (!result.id && !result.label && !result.text && !result.cls && !result.href && !result.src) return;
  return result;
}
function readSignalAnchor(value: unknown): SignalAnchor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (v.kind === 'chart') return unit(v.x) && unit(v.y) ? { kind: 'chart', x: v.x, y: v.y } : undefined;
  if (v.kind === 'element') return readSignalElementAnchor(v);
  const quote = v.kind === 'quote' ? readRefTarget(v) : undefined;
  return quote?.kind === 'quote' && ordinal(v.nth, v.of) && unit(v.x) && unit(v.y) ? { ...quote, nth: v.nth as number, of: v.of as number, x: v.x, y: v.y } : undefined;
}
export function readSignalTarget(value: unknown): SignalTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (v.kind === 'page') return { kind: 'page' };
  if (v.kind !== 'spot' || !Array.isArray(v.anchors) || !v.anchors.length || v.anchors.length > SIGNAL_ANCHORS) return;
  const anchors = v.anchors.map(readSignalAnchor);
  return anchors.every(Boolean) ? { kind: 'spot', anchors: anchors as SignalAnchor[] } : undefined;
}
/** `asset` is the token of the sender's page when they know it, so a pool page reads as its token before the receiver looks it up. */
export type SignalPayload = { id: string; teamId: string; url: string; sentAt: number; kind: SignalKind; target: SignalTarget; emote?: string; asset?: string };
export type ReceivedSignal = SignalPayload & { personId: string; at: number };
/**
 * A signal or emote as the chat keeps it. `id` is its room event, `timestamp` the service's time for that event. A line this device just
 * sent is `pending` under the signal's own id, at this device's time, until its room event comes back and takes its place.
 */
export type SignalRecord = { id: string; teamId: string; personId: string; url: string; kind: SignalKind; target: SignalTarget; emote?: string; asset?: string; timestamp: number; expiresAt: number; pending?: true };
/** The token a record's page is, as far as the record itself can tell. */
export function signalAsset(record: { url: string; asset?: string }) {
  if (record.asset) return record.asset;
  const identity = identifyPage(record.url);
  return identity?.kind === 'asset' ? assetKey(identity.chain, identity.address) : undefined;
}
const readAsset = (value: unknown) => {
  if (typeof value !== 'string') return;
  const split = value.indexOf(':');
  return split > 0 ? assetKey(value.slice(0, split), value.slice(split + 1)) : undefined;
};
/** What a wheel slot can hold: a signal or an emote. */
export const wheelEntries: readonly WheelEntry[] = [...signalKinds, ...signalEmotes];
export const WHEEL_SLOTS = 8;
/** The drag shortcut: the modifiers held exactly, in this order. */
export const signalModifiers = ['Control', 'Alt', 'Shift'] as const;
export type SignalModifier = typeof signalModifiers[number];
export type SignalSettings = { size: 'sm' | 'md' | 'lg'; emoteSize: 'sm' | 'md' | 'lg'; wheelSize: 'sm' | 'md' | 'lg'; sound: boolean; volume: number; key: SignalModifier[]; wheel: WheelEntry[]; chartShare: boolean; chartHideAll: boolean; chartHidden: string[]; chartIntro: boolean; chartOpened: boolean };
export const defaultSignalSettings: SignalSettings = { size: 'md', emoteSize: 'md', wheelSize: 'md', sound: true, volume: 30, key: ['Alt'], wheel: [...defaultWheel], chartShare: false, chartHideAll: false, chartHidden: [], chartIntro: false, chartOpened: false };
export const isEmote = (entry: string) => (signalEmotes as readonly string[]).includes(entry);
/** A wheel entry's still, relative to the extension's signals/ directory. */
export const wheelIcon = (entry: WheelEntry) => isEmote(entry) ? `thumbs/${entry}.webp` : `art/${entry}.svg`;
/** A modifier set Palside can read from a pointer event; Meta stays the browser's. */
export function normalizeSignalKey(value: unknown): SignalModifier[] | undefined {
  if (!Array.isArray(value)) return;
  const key = signalModifiers.filter(modifier => value.includes(modifier));
  return key.length && key.length === new Set(value).size ? key : undefined;
}
/** Eight distinct entries; unknown or repeated ones give way to the defaults not yet on the wheel. */
export function normalizeWheel(value: unknown): WheelEntry[] {
  const chosen = Array.isArray(value) ? value.filter((entry, index): entry is WheelEntry => (wheelEntries as readonly unknown[]).includes(entry) && value.indexOf(entry) === index).slice(0, WHEEL_SLOTS) : [];
  for (const entry of [...defaultWheel, ...wheelEntries]) if (chosen.length < WHEEL_SLOTS && !chosen.includes(entry)) chosen.push(entry);
  return chosen;
}
export function normalizeSignalSettings(value: unknown): SignalSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const size = (key: string) => input[key] === 'sm' || input[key] === 'lg' ? input[key] : 'md';
  return { size: size('size'), emoteSize: size('emoteSize'), wheelSize: size('wheelSize'), sound: input.sound !== false, volume: typeof input.volume === 'number' && Number.isFinite(input.volume) ? Math.max(0, Math.min(100, Math.round(input.volume))) : 30, key: normalizeSignalKey(input.key) ?? ['Alt'], wheel: normalizeWheel(input.wheel) , chartShare: input.chartShare === true, chartHideAll: input.chartHideAll === true, chartIntro: input.chartIntro === true, chartOpened: input.chartOpened === true, chartHidden: Array.isArray(input.chartHidden) ? [...new Set(input.chartHidden.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 200) : [] };
}
export function readSignal(value: unknown, now = Date.now()): SignalPayload | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(v.id) || typeof v.teamId !== 'string' || !v.teamId || v.teamId.length > 200 || typeof v.url !== 'string' || v.url.length > 4096 || pageScopeUrl(v.url) !== v.url || typeof v.sentAt !== 'number' || !Number.isFinite(v.sentAt) || Math.abs(now - v.sentAt) > SIGNAL_CLOCK_SKEW || !signalKinds.includes(v.kind as SignalKind)) return;
  const target = readSignalTarget(v.target);
  if (!target) return;
  if (v.emote !== undefined && (typeof v.emote !== 'string' || !(signalEmotes as readonly string[]).includes(v.emote))) return;
  const asset = readAsset(v.asset);
  if (v.asset !== undefined && !asset) return;
  return { id: v.id, teamId: v.teamId, url: v.url, sentAt: v.sentAt, kind: v.kind as SignalKind, target, ...(v.emote !== undefined ? { emote: v.emote as string } : {}), ...(asset ? { asset } : {}) };
}
