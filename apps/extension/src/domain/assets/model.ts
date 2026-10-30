import type { Viewing } from '@palside/shared/models/assets';
import { websiteId } from '@palside/shared/navigation';
import type { Attachment,Message } from '../chat/model.ts';
export type { Viewing } from '@palside/shared/models/assets';

/** A chosen attachment keeps its snapshot even when live page metadata changes. */
export function assetView(attachment: Attachment | undefined): Viewing | undefined {
  if (attachment?.kind !== 'asset') return;
  return attachment.view?.id === attachment.assetId ? attachment.view : undefined;
}
export function viewingKey(view: Viewing) { return view.kind === 'asset' && view.chain && view.address ? `${view.chain}:${view.chain === 'Solana' ? view.address : view.address.toLowerCase()}` : view.kind === 'website' ? websiteId(new URL(view.url).hostname) : view.id; }
export function relatedMessages(messages: Message[], assetId: string, views: Viewing[] = []) {
  const target = views.find(v => v.id === assetId); const key = target ? viewingKey(target) : assetId;
  const matching = new Set(views.filter(v => viewingKey(v) === key).map(v => v.id)); matching.add(assetId);
  const originals = new Set(messages.filter(m => !m.recalled && (m.attachment?.kind === 'asset' && matching.has(m.attachment.assetId) || Boolean(m.ref && target && viewingKey(m.ref.view) === key))).map(m => m.id));
  return messages.filter(m => !m.recalled && (originals.has(m.id) || Boolean(m.replyTo && originals.has(m.replyTo))));
}
