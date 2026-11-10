import type { Draft,Message } from '../../domain/chat/model';
import type { Viewing } from '../../domain/assets/model';

/** Retain message/draft context and current viewing, never an unreferenced browsing trail. */
export function retainedViews(views: Viewing[], messages: Message[], drafts: Draft[], current: (string | undefined)[]): Viewing[] {
  const used = new Set(current.filter((id): id is string => Boolean(id)));
  for (const message of messages) if (!message.recalled) {
    if (message.attachment?.kind === 'asset') used.add(message.attachment.assetId);
  }
  for (const draft of drafts) {
    if (draft.attachment?.kind === 'asset') used.add(draft.attachment.assetId);
  }
  return views.filter(view => used.has(view.id));
}
