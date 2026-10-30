import type { RuntimeState } from '../composition/runtime-state';
export type NotificationIdentity = { accountId?: unknown; messageId?: unknown; teamId?: unknown; preview?: unknown };

/** Shared final eligibility check for the encryption runtime and the Chrome notification host. */
export function notificationTarget(state: RuntimeState | undefined, identity: NotificationIdentity, now = Date.now()) {
  if (!state?.authenticated || !state.account || state.account.id !== identity.accountId || state.preferences.notifications === 'off') return;
  if (identity.preview !== Boolean(state.preferences.notificationPreview)) return;
  const team = state.remoteTeams.find(team => team.id === identity.teamId && team.joined);
  if (!team || team.preferences.muted) return;
  if (team.preferences.readIds.includes(String(identity.messageId))) return;
  const message = state.data.messages.find(message => message.id === identity.messageId && message.teamId === team.id && message.status === 'sent' && !message.recalled && !message.edited);
  if (!message || message.author === state.account.id || (message.expiresAt !== undefined && message.expiresAt <= now)) return;
  const mentioned = Boolean(message.mentionIds?.includes(state.account.id));
  const replied = state.data.messages.some(original => original.id === message.replyTo && original.teamId === team.id && original.author === state.account!.id);
  if (state.preferences.notifications === 'mentions' && !mentioned && !replied) return;
  return { team, message, mentioned, replied };
}
