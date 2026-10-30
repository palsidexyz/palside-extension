import { message as uiMessage,MessageError } from '@palside/i18n';
import type { RevisionedDraft } from '../storage/storage';
import { emptyDraft,type Draft } from '../../domain/chat/model';
import { imageSource } from './image-sessions';
import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { cacheUsage } from './local-data';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function cacheUsageCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return cacheUsage(runtime.storage);
}

export async function clearCacheCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return runtime.cache.clear();
}

export async function reloadImageCommand(this: RuntimeCommands, command: Extract<Command, { name: "reload-image" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();

      runtime.auth.requireConnection();
      const message = runtime.state.data.messages.find(m => m.id === p.id && !m.recalled && m.attachment?.kind === 'image'); const team = runtime.state.remoteTeams.find(t => t.id === message?.teamId);
      if (!message || !team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.imageUnavailable'));
      const raw = await scope.wait(runtime.auth.client.fetchRoomEvent(team.roomId, message.id)); await scope.wait(runtime.timeline.consume(new (await scope.wait(import('matrix-js-sdk'))).MatrixEvent({ ...raw, room_id: team.roomId })));
      const loaded = runtime.state.data.messages.find(m => m.id === message.id); if (loaded?.attachment?.kind !== 'image' || !loaded.attachment.src) throw new MessageError(uiMessage('extension.runtime.imageConnectionError')); return;
}

export async function imageDraftSaveCommand(this: RuntimeCommands, command: Extract<Command, { name: "image-draft-save" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== id || !runtime.state.remoteTeams.some(t => t.id === teamId && t.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      let src: string;
      try { src = imageSource(p.src); } catch { throw new MessageError(uiMessage('extension.runtime.imageSizeLimit')); }
      const saved = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${id}:draft:${teamId}`));
      if (!saved || !Number.isSafeInteger(p.draftRevision) || saved.revision !== p.draftRevision || saved.value.attachment?.kind !== 'image' || saved.value.attachment.src !== p.source) throw new MessageError(uiMessage('extension.runtime.draftChanged'));
      scope.check();
      if (!runtime.state.remoteTeams.some(t => t.id === teamId && t.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      const attachment = { ...saved.value.attachment, src };
      const next = await scope.wait(runtime.storage.updateDraft<Draft>(id, teamId, { attachment }, saved.revision, emptyDraft));
      runtime.state.drafts = { ...runtime.state.drafts, [teamId]: next }; runtime.emit();
      return { attached: true, draftRevision: next.revision };
}

export async function avatarCommand(this: RuntimeCommands, command: Extract<Command, { name: "avatar" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged'));
      const session = runtime.auth.session;
      const data = text(p.data); if (!data.startsWith('data:image/')) throw new MessageError(uiMessage('extension.runtime.invalidImageFormat'));
      const blob = await scope.wait((await scope.wait(fetch(data))).blob()); if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged')); await scope.wait(runtime.api.upload(blob, 'avatar', teamId || undefined));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function removeAvatarCommand(this: RuntimeCommands, command: Extract<Command, { name: "remove-avatar" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id;  if (p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged')); await scope.wait(runtime.api.request('media.remove', { params: { id: text(p.id) } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export const mediaHandlers = {
  'cache-usage': cacheUsageCommand,
  'clear-cache': clearCacheCommand,
  'reload-image': reloadImageCommand,
  'image-draft-save': imageDraftSaveCommand,
  'avatar': avatarCommand,
  'remove-avatar': removeAvatarCommand,
} satisfies HandlerRegistry;
