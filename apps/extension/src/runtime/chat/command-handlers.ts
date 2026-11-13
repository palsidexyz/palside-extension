import { DAY_MS as DAY } from '@palside/shared/units';
import { CHAT_TEXT_MAX } from '@palside/shared/rules/messages';
import { graphemeLength } from '@palside/shared/contracts/rules';
import { truncateChatText } from './text';
import { message as uiMessage, MessageError } from '@palside/i18n';
import { EventType,EventStatus,MsgType } from 'matrix-js-sdk';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import type { RevisionedDraft } from '../storage/storage';
import { validateView } from '../viewing/view-snapshot';
import { draftAttachmentPatch,emptyDraft,readQuoteRange,type Draft,type Message } from '../../domain/chat/model';
import type { Command } from '../transport/command-map';
import { READ_FLUSH_DELAY,text } from '../composition/state';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';
import { signedIn } from '../composition/signed-in';
import { liveMembers } from '../../domain/teams/model.ts';
import { keptMentions } from '../../domain/chat/mentions.ts';

type ChatCommand<Name extends Command['name']> = Extract<Command, { name: Name }>;

const joinedTeam = (runtime: RuntimeCommands['runtime'], teamId: unknown) => runtime.state.remoteTeams.find(team => team.id === teamId && team.joined);

/** 加入聊天 on a page selection: added to that squad's draft, or held for the panel to place when no squad is given or it would not fit. */
export async function externalShareCommand(this: RuntimeCommands, command: ChatCommand<'external-share'>) {
  const runtime = this.runtime, p = command.payload, scope = runtime.auth.scope(), session = runtime.auth.session;
  const input = truncateChatText(text(p.text));
  const team = joinedTeam(runtime, p.teamId);
  if (session && p.accountId === session.account.id && team) {
    const saved = runtime.state.drafts[team.id] ?? { value: emptyDraft, revision: 0 };
    const combined = [saved.value.text, input].filter(Boolean).join('\n');
    if (graphemeLength(combined) > CHAT_TEXT_MAX) {
      runtime.state.pendingShare = input; runtime.state.pendingShareTeamId = team.id;
      runtime.state.notice = uiMessage('extension.runtime.selectionTooLong');
    } else {
      runtime.state.drafts[team.id] = await scope.wait(runtime.storage.updateDraft<Draft>(session.account.id, team.id, { text: combined }, saved.revision, emptyDraft));
      runtime.state.notice = uiMessage('extension.runtime.addedToDraft', { name: team.name });
    }
  } else {
    runtime.state.pendingShare = input; runtime.state.pendingShareTeamId = undefined;
  }
  runtime.emit();
}

/** Loads one page of older messages; `loaded` once the room has no earlier page. */
export async function historyCommand(this: RuntimeCommands, command: ChatCommand<'history'>) {
  const { runtime, scope } = signedIn(this);
  const teamId = text(command.payload.teamId);
  runtime.auth.requireConnection();
  const team = runtime.state.remoteTeams.find(item => item.id === teamId);
  const room = team ? runtime.auth.client?.getRoom(team.roomId) : undefined;
  if (!room || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.syncingTeam'));
  if (runtime.state.history?.[teamId]?.loading) return;
  runtime.state.history ??= {};
  runtime.state.history[teamId] = { missingKeys: runtime.timeline.missingEvents.get(teamId)?.size ?? 0, loaded: false, loading: true };
  const history = runtime.state.history[teamId];
  runtime.emit();
  try {
    await scope.wait(runtime.auth.history(room));
    history.loaded = !room.oldState.paginationToken;
  } finally {
    if (scope.current()) { history.loading = false; runtime.emit(); }
  }
}

const showVisible = (runtime: RuntimeCommands['runtime']) => { runtime.timeline.visibleMessages = new Set([...runtime.timeline.visiblePanels.values()].flat()); };

/** A panel closed: what it showed stops counting as seen. */
export async function visibleDropCommand(this: RuntimeCommands, command: ChatCommand<'visible-drop'>) {
  const { runtime } = signedIn(this);
  const panel = text(command.payload.panel), prefix = `${panel}:`;
  runtime.rooms.dropPanel(panel);
  for (const source of runtime.timeline.visiblePanels.keys()) if (source.startsWith(prefix)) runtime.timeline.visiblePanels.delete(source);
  showVisible(runtime);
}

/** The messages a panel shows right now. A joined squad's are marked read here at once and on the service shortly after. */
export async function visibleCommand(this: RuntimeCommands, command: ChatCommand<'visible'>) {
  const { runtime } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId), sourceId = text(p.sourceId);
  const ids = Array.isArray(p.ids) ? p.ids.filter((value): value is string => typeof value === 'string') : [];
  if (ids.length) runtime.timeline.visiblePanels.set(sourceId, ids);
  else runtime.timeline.visiblePanels.delete(sourceId);
  showVisible(runtime);
  if (!teamId || !ids.length || !joinedTeam(runtime, teamId)) return;
  const pending = runtime.timeline.pendingRead.get(teamId) ?? new Set<string>();
  for (const id of ids) pending.add(id);
  runtime.timeline.pendingRead.set(teamId, pending);
  runtime.timeline.scheduleReadFlush(READ_FLUSH_DELAY);
  runtime.state.remoteTeams = runtime.state.remoteTeams.map(row => row.id === teamId ? { ...row, preferences: { ...row.preferences, readIds: [...new Set([...row.preferences.readIds, ...ids])] } } : row);
  runtime.emit();
}

/** A desktop notification was clicked: that window's panel opens the squad at the message. */
export async function notificationOpenCommand(this: RuntimeCommands, command: ChatCommand<'notification-open'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload;
  const message = runtime.state.data.messages.find(item => item.id === p.messageId && !item.recalled && runtime.cache.expiresAt(item) > Date.now());
  if (p.accountId !== accountId || !message || !joinedTeam(runtime, message.teamId)) throw new MessageError(uiMessage('extension.runtime.messageUnavailable'));
  if (!Number.isInteger(p.windowId) || Number(p.windowId) < 0) throw new MessageError(uiMessage('extension.runtime.reopenForMessage'));
  runtime.state.preferences.current = message.teamId;
  runtime.state.jumpMessageId = message.id;
  runtime.state.jumpWindowId = Number(p.windowId);
  await scope.wait(runtime.sharing.savePreferences());
}

/** Puts an attachment into the saved draft. One already there is replaced only on `replace` against the revision that was shown. */
export async function attachCommand(this: RuntimeCommands, command: ChatCommand<'attach'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId);
  if (p.accountId !== accountId || !joinedTeam(runtime, teamId)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
  const saved = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${accountId}:draft:${teamId}`)) ?? { revision: 0, value: emptyDraft, updatedAt: 0 };
  if (saved.value.attachment && JSON.stringify(saved.value.attachment) !== JSON.stringify(p.attachment) && p.replace !== true) return { requiresReplace: true, revision: saved.revision };
  if (p.replace === true && p.revision !== saved.revision) throw new MessageError(uiMessage('extension.runtime.draftChanged'));
  let attachment = p.attachment as Draft['attachment'];
  if (attachment?.kind === 'asset') {
    const assetId = attachment.assetId;
    const view = attachment.view ?? runtime.state.data.views.find(item => item.id === assetId);
    if (!view) throw new MessageError(uiMessage('extension.runtime.tokenUnavailable'));
    const snapshot = validateView(view);
    if (!snapshot) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
    attachment = { ...attachment, view: { ...snapshot, id: view.id } };
  }
  runtime.state.drafts[teamId] = await scope.wait(runtime.storage.updateDraft<Draft>(accountId, teamId, draftAttachmentPatch(saved.value, { attachment }), saved.revision, emptyDraft));
  runtime.emit();
  return { attached: true };
}

/** Writes one draft change against the revision the panel last saw; `null` clears a field. */
export async function draftCommand(this: RuntimeCommands, command: ChatCommand<'draft'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId);
  if (p.accountId !== accountId) throw new MessageError(uiMessage('extension.runtime.draftAccountChanged'));
  const patch = { ...(p.patch as Partial<Draft>) };
  for (const key of ['attachment', 'replyTo', 'automaticCard'] as const) if (patch[key] === null) patch[key] = undefined;
  // A quote range only means something with its reply: it is cleared with the reply and checked like wire input.
  if ('replyRange' in patch) patch.replyRange = readQuoteRange(patch.replyRange);
  if ('replyTo' in patch && !('replyRange' in patch)) patch.replyRange = undefined;
  const next = await scope.wait(runtime.storage.updateDraft<Draft>(accountId, teamId, patch, Number(p.revision), emptyDraft));
  runtime.state.drafts = { ...runtime.state.drafts, [teamId]: next };
  runtime.emit();
  return next;
}

/** 重试: the failed message exactly as it was written, while it is still this account's, unsent and under a day old. */
export async function prepareRetryCommand(this: RuntimeCommands, command: ChatCommand<'prepare-retry'>) {
  const { runtime, accountId } = signedIn(this);
  const messageId = text(command.payload.id), packet = runtime.sending.outgoing.get(messageId);
  if (command.payload.accountId !== accountId || !packet || packet.message.author !== accountId || runtime.sending.inFlight.has(messageId)) throw new MessageError(uiMessage('extension.runtime.sendStateChanged'));
  runtime.auth.requireConnection();
  if (!joinedTeam(runtime, packet.message.teamId)) throw new MessageError(uiMessage('extension.runtime.leftCannotSend'));
  if (packet.createdAt + DAY <= Date.now()) throw new MessageError(uiMessage('extension.runtime.outgoingExpired'));
  return { message: packet.message };
}

export async function sendCommand(this: RuntimeCommands, command: ChatCommand<'send'>) {
  const { runtime } = signedIn(this);
  return runtime.sending.send(command.payload.message as Message, Number(command.payload.revision));
}

/** 取消 an unsent message. One still on its way is not cancelled: its result is checked first. */
export async function cancelSendCommand(this: RuntimeCommands, command: ChatCommand<'cancel-send'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const id = text(command.payload.id);
  if (runtime.sending.inFlight.has(id)) throw new MessageError(uiMessage('extension.runtime.sendStateChanged'));
  runtime.sending.outgoing.delete(id);
  await scope.wait(runtime.storage.remove(`${accountId}:outgoing:${id}`));
  runtime.state.data.messages = runtime.state.data.messages.filter(message => message.id !== id || message.status === 'sent');
  runtime.emit();
}

/**
 * Edits one's own sent message as an encrypted `m.replace`. A retried edit with the same text and base reuses its transaction, so it
 * lands once.
 */
export async function editCommand(this: RuntimeCommands, command: ChatCommand<'edit'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId);
  runtime.auth.requireConnection();
  const team = joinedTeam(runtime, teamId);
  const original = runtime.state.data.messages.find(message => message.id === p.id && message.author === accountId && !message.recalled);
  if (!team || !original || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.messageNotEditable'));
  const { client, check } = teamSendGuard(runtime, teamId);
  const people = liveMembers(team);
  await scope.wait(requireEncryptedSend(client, team.roomId, people, check)); check();
  let source = client.getRoom(team.roomId)?.findEventById(original.id);
  if (!source) {
    const { MatrixEvent } = await scope.wait(import('matrix-js-sdk')); check();
    source = new MatrixEvent(await scope.wait(client.fetchRoomEvent(team.roomId, original.id))); check();
  }
  await scope.wait(client.decryptEventIfNeeded(source)); check();
  if (source.isDecryptionFailure()) throw new MessageError(uiMessage('extension.runtime.messageNotDecrypted'));
  const originalContent = source.getOriginalContent();
  const image = originalContent.msgtype === 'm.image';
  // The original mentions still written as @name stay (with their reminder); removed ones go; an edit adds none.
  const kept = keptMentions(text(p.text), runtime.state.data.people, original.mentionIds ?? []);
  const editedMentions = people.filter(person => kept.includes(person.id) && person.matrixId).map(person => person.matrixId!);
  const newContent = { ...originalContent, msgtype: originalContent.msgtype ?? MsgType.Text, body: image ? originalContent.body : text(p.text), 'com.palside.caption': image ? text(p.text) : undefined, 'm.mentions': { user_ids: editedMentions } };
  const content = { ...newContent, body: `* ${newContent.body}`, 'm.new_content': newContent, 'm.relates_to': { rel_type: 'm.replace', event_id: original.id } };
  const digest = await scope.wait(crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ id: original.id, text: p.text, base: p.baseEditedAt }))));
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  check();
  const pendingKey = `${accountId}:edit:${fingerprint}`;
  let txn = await scope.wait(runtime.storage.get<string>(pendingKey)); check();
  if (!txn) { txn = crypto.randomUUID(); await scope.wait(runtime.storage.put(pendingKey, accountId, 'operation', txn, Date.now() + DAY)); check(); }
  await scope.wait(requireEncryptedSend(client, team.roomId, people, check)); check();
  runtime.sending.editOriginals.set(txn, { id: original.id, baseEditedAt: Number(p.baseEditedAt ?? 0) });
  try {
    const room = client.getRoom(team.roomId);
    const pending = room?.getEventForTxnId(txn);
    if (pending && pending.status !== EventStatus.NOT_SENT && pending.status !== EventStatus.SENT) throw new MessageError(uiMessage('common.working'));
    if (pending?.status !== EventStatus.SENT || !pending.getId()) {
      await scope.wait(pending && room ? client.resendEvent(pending, room) : client.sendEvent(team.roomId, EventType.RoomMessage, content as RoomMessageEventContent, txn));
    }
    await scope.wait(runtime.storage.remove(pendingKey));
  } finally {
    if (scope.current()) runtime.sending.editOriginals.delete(txn);
  }
  return { done: true };
}

/** 撤回 one's own message, or the captain's 移除: a Matrix redaction the service authorizes. */
export async function recallCommand(this: RuntimeCommands, command: ChatCommand<'recall'>) {
  const { runtime, scope } = signedIn(this);
  runtime.auth.requireConnection();
  const team = joinedTeam(runtime, text(command.payload.teamId));
  if (!team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
  await scope.wait(runtime.auth.client.redactEvent(team.roomId, text(command.payload.id)));
  return { done: true };
}

export const chatHandlers = {
  'external-share': externalShareCommand,
  'history': historyCommand,
  'visible-drop': visibleDropCommand,
  'visible': visibleCommand,
  'notification-open': notificationOpenCommand,
  'attach': attachCommand,
  'draft': draftCommand,
  'prepare-retry': prepareRetryCommand,
  'send': sendCommand,
  'cancel-send': cancelSendCommand,
  'edit': editCommand,
  'recall': recallCommand,
} satisfies HandlerRegistry;
