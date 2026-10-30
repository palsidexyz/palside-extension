import type { Message as MessageContent,Draft as DraftContent } from '@palside/shared/models/chat';
import type { TextValue } from '@palside/i18n';
import type { PageRef } from '../annotations/social.ts';
export type { Attachment } from '@palside/shared/models/chat';

/** liveArrival and failure metadata are local runtime concerns, never stored or sent as message content. */
export type Message = MessageContent & {
  liveArrival?: boolean;
  failure?: TextValue;
  clientId?: string;
  expiresAt?: number;
  replyToExpiresAt?: number;
  editedAt?: number;
  mentionIds?: string[];
  recalled?: boolean;
  removedByOwner?: boolean;
  /** A page reference travels inside the encrypted message and shares its lifetime. */
  ref?: PageRef;
  /** Which part of the replied message is quoted; see `QuoteRange`. */
  replyRange?: QuoteRange;
};
/**
 * A quoted part of the replied message, as offsets into its text at edit version `base` (its `editedAt`, 0 if never
 * edited). Only positions travel, never the words, so a reader who cannot see the original never gets an excerpt of it.
 */
export type QuoteRange = { start: number; end: number; base: number };
export type Draft = DraftContent & {
  mentions?: { id: string; label: string }[]; ref?: PageRef; replyRange?: QuoteRange;
  /** Automatic-card ownership and suppression belong to the local draft, never the message. */
  automaticCard?: { url: string; assetId: string };
  dismissedUrls?: string[];
};
export const emptyDraft: Draft = { text: '' };
/** An explicit attachment change relinquishes the generated card and suppresses its URL for this draft. */
export function draftAttachmentPatch(draft: Draft, patch: Partial<Draft>): Partial<Draft> {
  if (!('attachment' in patch) || 'automaticCard' in patch || !draft.automaticCard) return patch;
  return { ...patch, automaticCard: undefined, dismissedUrls: [...new Set([...(draft.dismissedUrls ?? []), draft.automaticCard.url])] };
}
export function characterLength(text: string) { return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length; }
/** One to three emoji and nothing else (spaces aside): shown large without a bubble. Text-presentation symbols such as © do not count. */
export function emojiOnly(text: string) {
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.replace(/\s+/g, '')), part => part.segment);
  return parts.length > 0 && parts.length <= 3 && parts.every(part => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(part) && !/\p{L}/u.test(part) && (Array.from(part).length > 1 || /\p{Emoji_Presentation}/u.test(part)));
}
export function canSend(draft: Draft) { return Boolean(draft.text.trim() || draft.attachment || draft.ref) && characterLength(draft.text) <= 4000; }
/** A quote range from storage or the wire, or undefined when it is not a well-formed, non-empty range. */
export function readQuoteRange(value: unknown): QuoteRange | undefined {
  if (!value || typeof value !== 'object') return;
  const { start, end, base } = value as Record<string, unknown>;
  if (![start, end, base].every(item => Number.isSafeInteger(item))) return;
  const range = { start: start as number, end: end as number, base: base as number };
  return range.start >= 0 && range.end > range.start && range.end <= 40_000 && range.base >= 0 ? range : undefined;
}
/** The quoted words, only while the original is readable and unedited since the quote; otherwise the reply shows as a whole-message reply. */
export function quotedFragment(original: Message | undefined, range: QuoteRange | undefined, referenceExpiresAt?: number, now = Date.now()) {
  if (!original || !range || original.recalled || original.status !== 'sent') return;
  const expiresAt = original.expiresAt ?? referenceExpiresAt;
  if (Number.isFinite(expiresAt) && expiresAt! <= now) return;
  if ((original.editedAt ?? 0) !== range.base || range.end > original.text.length) return;
  return original.text.slice(range.start, range.end).trim() || undefined;
}
export function applyMessageEdit(messages: Message[], id: string, self: string, text: string) {
  return messages.map(m => m.id === id && m.author === self && m.status === 'sent' && !m.recalled ? { ...m, text, edited: true, editedAt: Math.max(Date.now(), (m.editedAt ?? 0) + 1) } : m);
}
export function recallMessage(messages: Message[], id: string, actorId?: string) {
  return messages.map(m => m.id === id && m.status === 'sent' ? { ...m, text: '', attachment: undefined, replyTo: undefined, replyRange: undefined, recalled: true, removedByOwner: actorId ? actorId !== m.author : m.removedByOwner } : m);
}
