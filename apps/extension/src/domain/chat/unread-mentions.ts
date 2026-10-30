import type { Message } from './model';

/** The caller supplies one team's messages and its account-wide read IDs, including historical mentions. */
export function unreadMentions(messages: readonly Message[], selfId: string, readIds: readonly string[], now = Date.now()): Message[] {
  const read = new Set(readIds);
  return messages.filter(message => message.status === 'sent' && !message.recalled && !message.removedByOwner && message.author !== selfId &&
    message.mentionIds?.includes(selfId) && !read.has(message.id) && (message.expiresAt === undefined || message.expiresAt > now))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type UnreadCounts = { unread: number; mentions: number };

/** Unread and unread-@me counts per team, from loaded messages and each team's account-wide read IDs. Teams absent from `readIds` count zero. */
export function teamUnreadCounts(messages: readonly Message[], selfId: string, readIds: ReadonlyMap<string, ReadonlySet<string>>, now = Date.now()): Map<string, UnreadCounts> {
  const counts = new Map<string, UnreadCounts>();
  for (const message of messages) {
    const read = readIds.get(message.teamId);
    if (!read || message.status !== 'sent' || message.recalled || message.removedByOwner || message.author === selfId || read.has(message.id) ||
      (message.expiresAt !== undefined && message.expiresAt <= now)) continue;
    const count = counts.get(message.teamId) ?? { unread: 0, mentions: 0 };
    count.unread++;
    if (message.mentionIds?.includes(selfId)) count.mentions++;
    counts.set(message.teamId, count);
  }
  return counts;
}
