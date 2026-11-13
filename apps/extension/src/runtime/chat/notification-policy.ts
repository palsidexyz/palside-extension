import type { RuntimeState } from '../composition/runtime-state';
import { expired } from '../../domain/chat/expiry.ts';
import { POKE_DISPLAY } from '../../domain/annotations/social.ts';
/** A message notification names `messageId`; a 喊你来看 notification names `pokeId`. */
export type NotificationIdentity = { accountId?: unknown; messageId?: unknown; teamId?: unknown; preview?: unknown; pokeId?: unknown };

/** Shared final eligibility check for the encryption runtime and the Chrome notification host. */
export function notificationTarget(state: RuntimeState | undefined, identity: NotificationIdentity, now = Date.now()) {
  if (!state?.authenticated || !state.account || state.account.id !== identity.accountId || state.preferences.notifications === 'off') return;
  if (identity.preview !== Boolean(state.preferences.notificationPreview)) return;
  const team = state.remoteTeams.find(team => team.id === identity.teamId && team.joined);
  if (!team || team.preferences.muted) return;
  if (team.preferences.readIds.includes(String(identity.messageId))) return;
  const message = state.data.messages.find(message => message.id === identity.messageId && message.teamId === team.id && message.status === 'sent' && !message.recalled && !message.edited);
  if (!message || message.author === state.account.id || expired(message.expiresAt, now)) return;
  const mentioned = Boolean(message.mentionIds?.includes(state.account.id));
  const replied = state.data.messages.some(original => original.id === message.replyTo && original.teamId === team.id && original.author === state.account!.id);
  if (state.preferences.notifications === 'mentions' && !mentioned && !replied) return;
  return { team, message, mentioned, replied };
}

/**
 * 喊你来看 is addressed to you, so it notifies under 全部消息 and 仅 @ 和回复 alike; 关闭 and a muted squad keep it in the chat only.
 * It stays valid until it is answered, ignored or five minutes old.
 */
export function pokeNotificationTarget(state: RuntimeState | undefined, identity: NotificationIdentity, now = Date.now()) {
  if (!state?.authenticated || !state.account || state.account.id !== identity.accountId || state.preferences.notifications === 'off') return;
  if (identity.preview !== Boolean(state.preferences.notificationPreview)) return;
  const team = state.remoteTeams.find(team => team.id === identity.teamId && team.joined);
  if (!team || team.preferences.muted) return;
  const poke = state.pokes?.find(poke => poke.id === identity.pokeId && poke.teamId === team.id && poke.at + POKE_DISPLAY > now);
  return poke && { team, poke };
}
/** Either kind, for the host's withdrawal sweep. */
export function notificationValid(state: RuntimeState | undefined, identity: NotificationIdentity) {
  return identity.pokeId !== undefined ? Boolean(pokeNotificationTarget(state, identity)) : Boolean(notificationTarget(state, identity));
}
