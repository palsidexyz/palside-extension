import { message as uiMessage, MessageError } from '@palside/i18n';
import type { RevisionedDraft } from '../storage/storage';
import { emptyDraft,type Draft } from '../../domain/chat/model';
import { imageSource } from './image-sessions';
import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { cacheUsage } from './local-data';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';
import { signedIn } from '../composition/signed-in';

type MediaCommand<Name extends Command['name']> = Extract<Command, { name: Name }>;

export async function cacheUsageCommand(this: RuntimeCommands) {
  return cacheUsage(this.runtime.storage);
}

export async function clearCacheCommand(this: RuntimeCommands) {
  return this.runtime.cache.clear();
}

/** 重新加载 a chat image whose file failed: the event is read again and decrypted afresh. */
export async function reloadImageCommand(this: RuntimeCommands, command: MediaCommand<'reload-image'>) {
  const { runtime, scope } = signedIn(this);
  runtime.auth.requireConnection();
  const message = runtime.state.data.messages.find(item => item.id === command.payload.id && !item.recalled && item.attachment?.kind === 'image');
  const team = runtime.state.remoteTeams.find(item => item.id === message?.teamId);
  if (!message || !team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.imageUnavailable'));
  const raw = await scope.wait(runtime.auth.client.fetchRoomEvent(team.roomId, message.id));
  const { MatrixEvent } = await scope.wait(import('matrix-js-sdk'));
  await scope.wait(runtime.timeline.consume(new MatrixEvent({ ...raw, room_id: team.roomId })));
  const loaded = runtime.state.data.messages.find(item => item.id === message.id);
  if (loaded?.attachment?.kind !== 'image' || !loaded.attachment.src) throw new MessageError(uiMessage('extension.runtime.imageConnectionError'));
}

/** Saves an annotated image over the draft's image, only while the draft still holds the image that was opened. */
export async function imageDraftSaveCommand(this: RuntimeCommands, command: MediaCommand<'image-draft-save'>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId);
  const joined = () => runtime.state.remoteTeams.some(team => team.id === teamId && team.joined);
  if (p.accountId !== accountId || !joined()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
  let src: string;
  try { src = imageSource(p.src); } catch { throw new MessageError(uiMessage('extension.runtime.imageSizeLimit')); }
  const saved = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${accountId}:draft:${teamId}`));
  if (!saved || !Number.isSafeInteger(p.draftRevision) || saved.revision !== p.draftRevision || saved.value.attachment?.kind !== 'image' || saved.value.attachment.src !== p.source) throw new MessageError(uiMessage('extension.runtime.draftChanged'));
  if (!joined()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
  const next = await scope.wait(runtime.storage.updateDraft<Draft>(accountId, teamId, { attachment: { ...saved.value.attachment, src } }, saved.revision, emptyDraft));
  runtime.state.drafts = { ...runtime.state.drafts, [teamId]: next };
  runtime.emit();
  return { attached: true, draftRevision: next.revision };
}

/** Uploads the account's avatar, or a squad's when `teamId` is given. */
export async function avatarCommand(this: RuntimeCommands, command: MediaCommand<'avatar'>) {
  const { runtime, session, accountId, scope } = signedIn(this);
  const p = command.payload, teamId = text(p.teamId);
  if (p.accountId !== accountId) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged'));
  const data = text(p.data);
  if (!data.startsWith('data:image/')) throw new MessageError(uiMessage('extension.runtime.invalidImageFormat'));
  const blob = await scope.wait((await scope.wait(fetch(data))).blob());
  if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged'));
  await scope.wait(runtime.api.upload(blob, 'avatar', teamId || undefined));
  await scope.wait(runtime.refresh());
  return { done: true };
}

export async function removeAvatarCommand(this: RuntimeCommands, command: MediaCommand<'remove-avatar'>) {
  const { runtime, accountId, scope } = signedIn(this);
  if (command.payload.accountId !== accountId) throw new MessageError(uiMessage('extension.runtime.avatarAccountChanged'));
  await scope.wait(runtime.api.request('media.remove', { params: { id: text(command.payload.id) } }));
  await scope.wait(runtime.refresh());
  return { done: true };
}

export const mediaHandlers = {
  'cache-usage': cacheUsageCommand,
  'clear-cache': clearCacheCommand,
  'reload-image': reloadImageCommand,
  'image-draft-save': imageDraftSaveCommand,
  'avatar': avatarCommand,
  'remove-avatar': removeAvatarCommand,
} satisfies HandlerRegistry;
