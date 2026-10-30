import { defaultWheel,signalEmotes,signalKinds,type SignalKind,type WheelEntry } from '@palside/shared/signals';
import { pageScopeUrl,readRefTarget,type RefTarget } from '../../domain/annotations/social.ts';

export const SIGNAL_EVENT = 'com.palside.signal';
export const SIGNAL_TTL = 5_000;
export { defaultWheel, signalEmotes, signalKinds, type SignalEmote, type SignalKind, type WheelEntry } from '@palside/shared/signals';
export type SignalElementTarget = { kind: 'element'; tag: string; id?: string; role?: string; label?: string; text?: string; href?: string; src?: string; path?: string; x: number; y: number };
export type SignalTarget = { kind: 'page' } | Extract<RefTarget, { kind: 'quote' }> | SignalElementTarget;
export const signalPrivateIdentity = /(?:^|[\s_\-/])(?:private|secret|password|trade|trading|balances?|holdings?|positions|orders?|orderbook|portfolio|wallet|account)(?:$|[\s_\-/])|交易|余额|持仓|订单|账户/i;
const elementTags = new Set(['a', 'img', 'picture', 'svg', 'video', 'canvas', 'div', 'span', 'p', 'section', 'article', 'figure', 'figcaption', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** URLs are identity only: never fetched, and private/authenticated links are rejected. */
export function signalIdentityUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000- \u007f]/u.test(value)) return;
  const normalized = pageScopeUrl(value);
  if (!normalized) return;
  const url = new URL(normalized);
  let path: string;
  try { path = decodeURIComponent(url.pathname + url.hash); } catch { return; }
  if (signalPrivateIdentity.test(path.replace(/([a-z])([A-Z])/g, '$1-$2'))) return;
  return normalized;
}
export function readSignalElementTarget(value: unknown): SignalElementTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'element' || typeof v.tag !== 'string' || !elementTags.has(v.tag) || typeof v.x !== 'number' || !Number.isFinite(v.x) || v.x < 0 || v.x > 1 || typeof v.y !== 'number' || !Number.isFinite(v.y) || v.y < 0 || v.y > 1) return;
  const result: SignalElementTarget = { kind: 'element', tag: v.tag, x: v.x, y: v.y };
  for (const [key, maximum] of [['id', 128], ['role', 32], ['label', 160], ['text', 240], ['path', 256]] as const) {
    const item = v[key];
    if (item === undefined) continue;
    if (typeof item !== 'string' || !item.trim() || item.length > maximum || /[\u0000-\u001f\u007f]/u.test(item) || signalPrivateIdentity.test(item.replace(/([a-z])([A-Z])/g, '$1-$2'))) return;
    if (key === 'id' && !/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(item)) return;
    if (key === 'role' && (!/^[a-z]+$/.test(item) || ['textbox', 'button', 'dialog', 'combobox', 'searchbox', 'spinbutton'].includes(item))) return;
    result[key] = item;
  }
  for (const key of ['href', 'src'] as const) {
    if (v[key] === undefined) continue;
    const url = signalIdentityUrl(v[key]);
    if (!url || url !== v[key]) return;
    result[key] = url;
  }
  if (!result.id && !result.label && !result.text && !result.href && !result.src) return;
  if (result.tag === 'canvas' && !result.id && !result.label) return;
  return result;
}
export type SignalPayload = { id: string; teamId: string; url: string; sentAt: number; kind: SignalKind; target: SignalTarget; emote?: string };
export type ReceivedSignal = SignalPayload & { personId: string; at: number };
/** What a wheel slot can hold: a signal or an emote. */
export const wheelEntries: readonly WheelEntry[] = [...signalKinds, ...signalEmotes];
export const WHEEL_SLOTS = 8;
/** The drag shortcut: the modifiers held exactly, in this order. */
export const signalModifiers = ['Control', 'Alt', 'Shift'] as const;
export type SignalModifier = typeof signalModifiers[number];
export type SignalSettings = { size: 'sm' | 'md' | 'lg'; emoteSize: 'sm' | 'md' | 'lg'; wheelSize: 'sm' | 'md' | 'lg'; sound: boolean; volume: number; key: SignalModifier[]; wheel: WheelEntry[] };
export const defaultSignalSettings: SignalSettings = { size: 'md', emoteSize: 'md', wheelSize: 'md', sound: false, volume: 30, key: ['Alt'], wheel: [...defaultWheel] };
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
  return { size: size('size'), emoteSize: size('emoteSize'), wheelSize: size('wheelSize'), sound: input.sound === true, volume: typeof input.volume === 'number' && Number.isFinite(input.volume) ? Math.max(0, Math.min(100, Math.round(input.volume))) : 30, key: normalizeSignalKey(input.key) ?? ['Alt'], wheel: normalizeWheel(input.wheel) };
}
export function readSignal(value: unknown, now = Date.now()): SignalPayload | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(v.id) || typeof v.teamId !== 'string' || !v.teamId || v.teamId.length > 200 || typeof v.url !== 'string' || v.url.length > 4096 || pageScopeUrl(v.url) !== v.url || typeof v.sentAt !== 'number' || !Number.isFinite(v.sentAt) || now - v.sentAt > SIGNAL_TTL || v.sentAt > now + 1_000 || !signalKinds.includes(v.kind as SignalKind)) return;
  const raw = v.target as Record<string, unknown> | undefined;
  const target = raw?.kind === 'page' ? { kind: 'page' as const } : raw?.kind === 'element' ? readSignalElementTarget(raw) : readRefTarget(raw);
  if (!target || target.kind !== 'page' && target.kind !== 'quote' && target.kind !== 'element') return;
  if (v.emote !== undefined && (typeof v.emote !== 'string' || !(signalEmotes as readonly string[]).includes(v.emote))) return;
  return { id: v.id, teamId: v.teamId, url: v.url, sentAt: v.sentAt, kind: v.kind as SignalKind, target, ...(v.emote !== undefined ? { emote: v.emote as string } : {}) };
}
