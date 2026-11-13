import { assetView } from '../assets/model.ts';
import type { Message } from './model.ts';

/** What a search compares: trimmed and case-folded, so a trailing IME space or a checksum address still matches. */
export function searchNeedle(query: string | undefined) { return (query ?? '').trim().toLocaleLowerCase(); }

/** Messages a search can open: sent and still readable, newest first. */
export function searchableMessages(messages: readonly Message[]) {
  return messages.filter(message => message.status === 'sent' && !message.recalled).toReversed();
}

/** Where a message matched: its own words, or the card it carries (name or address). */
export type MessageHit = { message: Message; field: 'text' | 'card' | 'none' };

/** Every searchable message that matches, newest first; without a query, every searchable message. */
export function searchMessages(messages: readonly Message[], query: string | undefined): MessageHit[] {
  const needle = searchNeedle(query);
  const hits: MessageHit[] = [];
  for (const message of searchableMessages(messages)) {
    if (!needle) { hits.push({ message, field: 'none' }); continue; }
    if (message.text.toLocaleLowerCase().includes(needle)) { hits.push({ message, field: 'text' }); continue; }
    const view = assetView(message.attachment);
    if ([view?.name, view?.address].some(value => value?.toLocaleLowerCase().includes(needle))) hits.push({ message, field: 'card' });
  }
  return hits;
}
