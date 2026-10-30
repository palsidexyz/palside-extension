import { message as uiMessage,MessageError } from '@palside/i18n';
import { EventType,EventStatus,MsgType } from 'matrix-js-sdk';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import type { RevisionedDraft } from '../storage/storage';
import { validateView } from '../viewing/view-snapshot';
import { draftAttachmentPatch,emptyDraft,readQuoteRange,type Draft,type Message } from '../../domain/chat/model';
import type { Command } from '../transport/command-map';
import { DAY,READ_FLUSH_DELAY,text } from '../composition/state';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function externalShareCommand(this: RuntimeCommands, command: Extract<Command, { name: "external-share" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      const scope = runtime.auth.scope();
      const input = text(p.text).slice(0, 4000);
      const team = runtime.state.remoteTeams.find(t => t.id === p.teamId && t.joined);
      if (runtime.auth.session && p.accountId === runtime.auth.session.account.id && team) {
        const saved = runtime.state.drafts[team.id] ?? { value: emptyDraft, revision: 0 };
        const combined = [saved.value.text, input].filter(Boolean).join('\n');
        if ([...new Intl.Segmenter().segment(combined)].length > 4000) { runtime.state.pendingShare = input; runtime.state.pendingShareTeamId = team.id; runtime.state.notice = uiMessage('extension.runtime.selectionTooLong'); }
        else { const next = await scope.wait(runtime.storage.updateDraft<Draft>(runtime.auth.session.account.id, team.id, { text: combined }, saved.revision, emptyDraft)); runtime.state.drafts[team.id] = next; runtime.state.notice = uiMessage('extension.runtime.addedToDraft', { name: team.name }); }
      } else { runtime.state.pendingShare = input; runtime.state.pendingShareTeamId = undefined; }
      runtime.emit(); return;
}

export async function historyCommand(this: RuntimeCommands, command: Extract<Command, { name: "history" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);

      runtime.auth.requireConnection();
      const team = runtime.state.remoteTeams.find(t => t.id === teamId); const room = team ? runtime.auth.client?.getRoom(team.roomId) : undefined;
      if (!room || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.syncingTeam'));
      runtime.state.history ??= {}; runtime.state.history[teamId] = { missingKeys: runtime.timeline.missingEvents.get(teamId)?.size ?? 0, loaded: false, loading: true }; runtime.emit();
      try { await scope.wait(runtime.auth.history(room)); runtime.state.history[teamId]!.loaded = !room.oldState.paginationToken; }
      finally { if (scope.current()) { runtime.state.history[teamId]!.loading = false; runtime.emit(); } }
      return;
}

export async function visibleDropCommand(this: RuntimeCommands, command: Extract<Command, { name: "visible-drop" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));

      runtime.rooms.dropPanel(text(p.panel));
      const prefix = `${text(p.panel)}:`;
      for (const source of runtime.timeline.visiblePanels.keys()) if (source.startsWith(prefix)) runtime.timeline.visiblePanels.delete(source);
      runtime.timeline.visibleMessages = new Set([...runtime.timeline.visiblePanels.values()].flat()); return;
}

export async function visibleCommand(this: RuntimeCommands, command: Extract<Command, { name: "visible" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
 const teamId = text('teamId' in p ? p.teamId : undefined);

      const ids = Array.isArray(p.ids) ? p.ids.filter((value): value is string => typeof value === 'string') : [];
      const sourceId = text(p.sourceId);
      if (ids.length) runtime.timeline.visiblePanels.set(sourceId, ids);
      else runtime.timeline.visiblePanels.delete(sourceId);
      runtime.timeline.visibleMessages = new Set([...runtime.timeline.visiblePanels.values()].flat());
      if (teamId && ids.length && runtime.state.remoteTeams.some(t => t.id === teamId && t.joined)) {
        const pending = runtime.timeline.pendingRead.get(teamId) ?? new Set<string>(); for (const read of ids) pending.add(read); runtime.timeline.pendingRead.set(teamId, pending);
        runtime.timeline.scheduleReadFlush(READ_FLUSH_DELAY);
        const team = runtime.state.remoteTeams.find(t => t.id === teamId); if (team) runtime.state.remoteTeams = runtime.state.remoteTeams.map(row => row.id === team.id ? { ...row, preferences: { ...row.preferences, readIds: [...new Set([...row.preferences.readIds, ...ids])] } } : row);
        runtime.emit();
      }
      return;
}

export async function notificationOpenCommand(this: RuntimeCommands, command: Extract<Command, { name: "notification-open" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; 
      const message = runtime.state.data.messages.find(m => m.id === p.messageId && !m.recalled && runtime.cache.expiresAt(m) > Date.now());
      if (p.accountId !== id || !message || !runtime.state.remoteTeams.some(t => t.id === message.teamId && t.joined)) throw new MessageError(uiMessage('extension.runtime.messageUnavailable'));
      if (!Number.isInteger(p.windowId) || Number(p.windowId) < 0) throw new MessageError(uiMessage('extension.runtime.reopenForMessage'));
      runtime.state.preferences.current = message.teamId; runtime.state.jumpMessageId = message.id; runtime.state.jumpWindowId = Number(p.windowId); await scope.wait(runtime.sharing.savePreferences()); return;
}

export async function attachCommand(this: RuntimeCommands, command: Extract<Command, { name: "attach" }>) {
    const { name } = command; const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== id || !runtime.state.remoteTeams.some(t => t.id === teamId && t.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      const saved = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${id}:draft:${teamId}`)) ?? { revision: 0, value: emptyDraft, updatedAt: 0 };
      if (name === 'attach' && saved.value.attachment && JSON.stringify(saved.value.attachment) !== JSON.stringify(p.attachment) && p.replace !== true) return { requiresReplace: true, revision: saved.revision };
      if (p.replace === true && p.revision !== saved.revision) throw new MessageError(uiMessage('extension.runtime.draftChanged'));
      const patch = { attachment: p.attachment as Draft['attachment'] };
      if (patch.attachment?.kind === 'asset') {
        const view = patch.attachment.view ?? runtime.state.data.views.find(v => patch.attachment?.kind === 'asset' && v.id === patch.attachment.assetId);
        if (!view) throw new MessageError(uiMessage('extension.runtime.tokenUnavailable'));
        const snapshot = validateView(view);
        if (!snapshot) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
        patch.attachment = { ...patch.attachment, view: { ...snapshot, id: view.id } };
      }
      const next = await scope.wait(runtime.storage.updateDraft<Draft>(id, teamId, draftAttachmentPatch(saved.value, patch), saved.revision, emptyDraft)); runtime.state.drafts[teamId] = next; runtime.emit(); return { attached: true };
}

export async function draftCommand(this: RuntimeCommands, command: Extract<Command, { name: "draft" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.draftAccountChanged'));
      const patch = { ...(p.patch as Partial<Draft>) };
      if (patch.attachment === null) patch.attachment = undefined; if (patch.replyTo === null) patch.replyTo = undefined; if (patch.ref === null) patch.ref = undefined;
      if (patch.automaticCard === null) patch.automaticCard = undefined;
      // A quote range only means something with its reply: it is cleared with the reply and checked like wire input.
      if ('replyRange' in patch) patch.replyRange = readQuoteRange(patch.replyRange);
      if ('replyTo' in patch && !('replyRange' in patch)) patch.replyRange = undefined;
      const next = await scope.wait(runtime.storage.updateDraft<Draft>(id, teamId, patch, Number(p.revision), emptyDraft));
      runtime.state.drafts = { ...runtime.state.drafts, [teamId]: next }; runtime.emit(); return next;
}

export async function prepareRetryCommand(this: RuntimeCommands, command: Extract<Command, { name: "prepare-retry" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const id = runtime.auth.session.account.id; 
      const messageId = text(p.id); const packet = runtime.sending.outgoing.get(messageId);
      if (p.accountId !== id || !packet || packet.message.author !== id || runtime.sending.inFlight.has(messageId)) throw new MessageError(uiMessage('extension.runtime.sendStateChanged'));
      runtime.auth.requireConnection();
      if (!runtime.state.remoteTeams.some(team => team.id === packet.message.teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.leftCannotSend'));
      if (packet.createdAt + DAY <= Date.now()) throw new MessageError(uiMessage('extension.runtime.outgoingExpired'));
      return { message: packet.message };
}

export async function sendCommand(this: RuntimeCommands, command: Extract<Command, { name: "send" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
return runtime.sending.send(p.message as Message, Number(p.revision));
}

export async function cancelSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "cancel-send" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id;  runtime.sending.outgoing.delete(text(p.id)); await scope.wait(runtime.storage.remove(`${id}:outgoing:${text(p.id)}`)); runtime.state.data.messages = runtime.state.data.messages.filter(m => m.id !== p.id || m.status === 'sent'); runtime.emit(); return;
}

export async function editCommand(this: RuntimeCommands, command: Extract<Command, { name: "edit" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      runtime.auth.requireConnection();
      const team = runtime.state.remoteTeams.find(t => t.id === teamId && t.joined); const original = runtime.state.data.messages.find(m => m.id === p.id && m.author === id && !m.recalled);
      if (!team || !original || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.messageNotEditable'));
      const { client, check } = teamSendGuard(runtime, teamId);
      const people = team.people.filter(person => team.memberIds.includes(person.id));
      await scope.wait(requireEncryptedSend(client, team.roomId, people, check)); check();
      const room = client.getRoom(team.roomId);
      let source = room?.findEventById(original.id);
      if (!source) {
        const { MatrixEvent } = await scope.wait(import('matrix-js-sdk')); check();
        source = new MatrixEvent(await scope.wait(client.fetchRoomEvent(team.roomId, original.id))); check();
      }
      await scope.wait(client.decryptEventIfNeeded(source)); check();
      if (source.isDecryptionFailure()) throw new MessageError(uiMessage('extension.runtime.messageNotDecrypted'));
      const originalContent = source.getOriginalContent();
      const newContent = { ...originalContent, msgtype: originalContent.msgtype ?? MsgType.Text, body: originalContent.msgtype === 'm.image' ? originalContent.body : text(p.text), 'com.palside.caption': originalContent.msgtype === 'm.image' ? text(p.text) : undefined, 'm.mentions': { user_ids: [] } };
      const content = { ...newContent, body: `* ${newContent.body}`, 'm.new_content': newContent, 'm.relates_to': { rel_type: 'm.replace', event_id: original.id } };
      const fingerprint = [...new Uint8Array(await scope.wait(crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ id: original.id, text: p.text, base: p.baseEditedAt })))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      check();
      const pendingKey = `${id}:edit:${fingerprint}`; let txn = await scope.wait(runtime.storage.get<string>(pendingKey)); check();
      if (!txn) { txn = crypto.randomUUID(); await scope.wait(runtime.storage.put(pendingKey, id, 'operation', txn, Date.now() + DAY)); check(); }
      await scope.wait(requireEncryptedSend(client, team.roomId, people, check)); check();
      runtime.sending.editOriginals.set(txn, { id: original.id, baseEditedAt: Number(p.baseEditedAt ?? 0) });
      try {
        const pendingRoom = client.getRoom(team.roomId);
        const pending = pendingRoom?.getEventForTxnId(txn);
        if (pending && pending.status !== EventStatus.NOT_SENT && pending.status !== EventStatus.SENT) throw new MessageError(uiMessage('common.working'));
        if (pending?.status !== EventStatus.SENT || !pending.getId()) {
          await scope.wait(pending && pendingRoom ? client.resendEvent(pending, pendingRoom) : client.sendEvent(team.roomId, EventType.RoomMessage, content as RoomMessageEventContent, txn));
        }
        await scope.wait(runtime.storage.remove(pendingKey));
      }
      finally { if (scope.current()) { runtime.sending.editOriginals.delete(txn); } }
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function recallCommand(this: RuntimeCommands, command: Extract<Command, { name: "recall" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
 runtime.auth.requireConnection(); const team = runtime.state.remoteTeams.find(t => t.id === teamId && t.joined); if (!team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable')); await scope.wait(runtime.auth.client.redactEvent(team.roomId, text(p.id)));
    await scope.wait(runtime.refresh()); return { done: true };
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
