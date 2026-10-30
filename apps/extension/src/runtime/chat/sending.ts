import { IMAGE_LIMIT } from '../../domain/images/image-policy';
import { IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { completeTeamStart } from '../teams/onboarding.ts';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { readonlyNotice,sendFailure } from '../transport/connection';
import { messageExpiry } from './message-expiry';
import { EventType,EventStatus,MsgType } from 'matrix-js-sdk';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import { encryptAttachment } from 'matrix-encrypt-attachment';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import { ApiError } from '../transport/api';
import type { RevisionedDraft } from '../storage/storage';
import { validateView,readView } from '../viewing/view-snapshot';
import { SendPacer,THROTTLE_RETRIES,throttleWait } from './send-pacer';
import { readMessageRefTarget,readRefCaption } from '../../domain/annotations/social';
import { assetView } from '../../domain/assets/model';
import { canSend,emptyDraft,readQuoteRange,type Draft,type Message } from '../../domain/chat/model';
import type { Outgoing } from './outgoing';
import type { RuntimeDevice } from '../account/device';
import { DAY } from '../composition/state';
import { publishSendQueue } from './messages';
import type { PalsideService } from '../composition/core';

export class SendingRuntime {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  outgoing = new Map<string, Outgoing>();
  sendRequests = new Map<string, Promise<unknown>>();
  inFlight = new Set<string>();
  editOriginals = new Map<string, { id: string; baseEditedAt: number }>();
  readonly pacer = new SendPacer();
  queued = new Map<string, { teamId: string; at: number }>();
  async send(message: Message, revision: number): Promise<unknown> {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const key = `${message.teamId}:${revision >= 0 ? revision : message.id}`;
    const running = this.sendRequests.get(key); if (running) return running;
    const existing = revision >= 0 ? [...this.outgoing.values()].find(p => p.message.teamId === message.teamId && p.draftRevision === revision) : undefined;
    const request = this.doSend(existing?.message ?? message, revision); this.sendRequests.set(key, request);
    try { return await scope.wait(request); } finally { if (scope.current()) { this.sendRequests.delete(key); } }
  }
  async pace(teamId: string, messageId: string, guard: () => void) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const at = this.pacer.reserve(teamId);
    if (at <= Date.now()) return false;
    await scope.wait(this.queue(teamId, messageId, at, guard)); return true;
  }
  async queue(teamId: string, messageId: string, at: number, guard: () => void) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    this.queued.set(messageId, { teamId, at }); this.publishQueue();
    try { await scope.wait(new Promise(resolve => setTimeout(resolve, Math.max(0, at - Date.now())))); }
    finally { if (scope.current()) { this.queued.delete(messageId); this.publishQueue(); } }
    guard();
  }
  publishQueue() {
    const runtime = this.runtime;
    publishSendQueue(runtime.state, [...this.queued].map(([id, item]) => ({ id, ...item })), () => runtime.emit());
  }
  async throttled<T>(teamId: string, messageId: string, guard: () => void, work: () => Promise<T>, key = teamId): Promise<T> {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    for (let attempt = 0; ; attempt++) {
      try { return await scope.wait(work()); } catch (error) { scope.check();
        const wait = throttleWait(error);
        if (wait === undefined || attempt >= THROTTLE_RETRIES) throw error;
        this.pacer.defer(key, Date.now() + wait);
        await scope.wait(this.queue(teamId, messageId, this.pacer.reserve(key), guard));
      }
    }
  }
  async releaseDraft(session: RuntimeDevice, teamId: string, revision: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    if (!await scope.wait(runtime.storage.clearSentDraft(session.account.id, teamId, revision, emptyDraft)) || runtime.auth.session !== session) return;
    const draft = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${session.account.id}:draft:${teamId}`)); if (draft) { runtime.state.drafts[teamId] = draft; runtime.emit(); }
  }
  async doSend(message: Message, revision: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; const client = runtime.auth.client;
    const team = runtime.state.remoteTeams.find(t => t.id === message.teamId && t.joined);
    const guard = () => eligibility.check();
    if (!session) throw new MessageError(uiMessage('extension.runtime.deviceRevoked'));
    if (message.author !== session.account.id) throw new MessageError(uiMessage('extension.runtime.sendAccountChanged'));
    const displayedTeam = runtime.state.data.teams.find(t => t.id === message.teamId);
    if (displayedTeam?.readonly) throw new MessageError(readonlyNotice(displayedTeam.readonlyReason).title);
    runtime.auth.requireConnection();
    if (!client) { runtime.state.connection.messaging = 'connecting'; runtime.emit(); throw new ApiError(0, { error: 'CONNECTION_UNAVAILABLE', text: uiMessage('extension.runtime.messagingNotReady') }); }
    if (!team) throw new MessageError(uiMessage('extension.runtime.notTeamMember'));
    const eligibility = teamSendGuard(runtime, team.id);
    const people = team.people.filter(person => !person.deleted && team.memberIds.includes(person.id));
    message = this.outgoing.get(message.id)?.message ?? message;
    if (message.ref) {
      const target = readMessageRefTarget(message.ref.target); const caption = readRefCaption(message.ref.caption, target); const view = await scope.wait(readView(message.ref.view));
      guard();
      if (!target || !caption || !view || view.kind === 'website' && view.disclosure !== 'page') throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
      message = { ...message, ref: { target, caption, view } };
    }
    if (message.attachment?.kind === 'asset' && !validateView(assetView(message.attachment))) throw new MessageError(uiMessage('extension.runtime.removeInvalidToken'));
    if (!canSend(message)) throw new MessageError(uiMessage('extension.runtime.messageRequired'));
    await scope.wait(requireEncryptedSend(client, team.roomId, people, guard));
    guard();
    if (this.inFlight.has(message.id)) return;
    this.inFlight.add(message.id);
    let packet = this.outgoing.get(message.id);
    try {
      if (!packet) {
        const selected = assetView(message.attachment);
        const candidate = selected ? validateView(selected) : undefined;
        const asset = candidate;
        const attachment = asset && message.attachment?.kind === 'asset' ? { ...message.attachment, view: { ...asset, id: message.attachment.assetId } } : message.attachment;
        const now = Date.now();
        packet = { draftRevision: revision, message: { ...message, attachment, replyRange: message.replyTo ? readQuoteRange(message.replyRange) : undefined, author: session.account.id, timestamp: now, expiresAt: messageExpiry(undefined, now, team.retentionDays) }, asset, createdAt: now };
        if (message.attachment?.kind === 'asset' && !packet.asset) throw new MessageError(uiMessage('extension.runtime.removeInvalidToken'));
        await scope.wait(runtime.storage.put(`${session.account.id}:outgoing:${message.id}`, session.account.id, 'outgoing', packet, packet.createdAt + DAY)); this.outgoing.set(message.id, packet);
      }
      if (packet.createdAt + DAY <= Date.now()) throw new MessageError(uiMessage('extension.runtime.outgoingExpired'));
      message = packet.message;
      if (message.ref) runtime.cache.upsertView(message.ref.view);
      runtime.state.data.messages = [...runtime.state.data.messages.filter(m => m.id !== message.id), { ...message, failure: undefined, status: 'sending' }]; runtime.emit();
      await scope.wait(this.releaseDraft(session, team.id, packet.draftRevision ?? revision)); guard();
      const mentions = team.people.filter(p => message.mentionIds?.includes(p.id) && team.memberIds.includes(p.id)).map(p => p.matrixId);
      const content: RoomMessageEventContent & Record<string, unknown> = { 'm.mentions': { user_ids: mentions }, msgtype: MsgType.Text, body: message.text, 'com.palside.asset': packet.asset, ...(message.ref ? { 'com.palside.ref': message.ref } : {}), ...(message.replyTo ? { 'm.relates_to': { 'm.in_reply_to': { event_id: message.replyTo } }, ...(message.replyRange ? { 'com.palside.reply_range': message.replyRange } : {}) } : {}) };
      if (message.attachment?.kind === 'image') {
        const blob = await scope.wait((await scope.wait(fetch(message.attachment.src))).blob());
        if (blob.size > IMAGE_LIMIT.maxBytes || !IMAGE_MIME_TYPES.some(type => type === blob.type)) throw new MessageError(uiMessage('extension.runtime.imageSizeLimit'));
        if (!packet.file) {
          const encrypted = await scope.wait(encryptAttachment(await scope.wait(blob.arrayBuffer()))); guard();
          packet.uploadId = await scope.wait(this.throttled(team.id, message.id, guard, () => runtime.api.upload(new Blob([encrypted.data]), 'encrypted', team.id), `upload:${team.id}`));
          guard(); packet.file = { ...encrypted.info, 'com.palside.media': packet.uploadId };
          await scope.wait(runtime.storage.put(`${session.account.id}:outgoing:${message.id}`, session.account.id, 'outgoing', packet, packet.createdAt + DAY));
        }
        Object.assign(content, { msgtype: 'm.image', body: message.attachment.name, filename: message.attachment.name, file: packet.file, info: { mimetype: blob.type, size: blob.size }, 'com.palside.caption': message.text });
      }
      runtime.auth.requireConnection();
      if (!packet.eventId) {
        await scope.wait(requireEncryptedSend(client, team.roomId, people, guard));
        guard();
        await scope.wait(this.pace(team.id, message.id, guard));
        guard(); packet.attempted = true; await scope.wait(runtime.storage.put(`${session.account.id}:outgoing:${message.id}`, session.account.id, 'outgoing', packet, packet.createdAt + DAY));
        const result = await scope.wait(this.throttled(team.id, message.id, guard, async () => {
          await scope.wait(requireEncryptedSend(client, team.roomId, people, guard)); guard();
          const room = client.getRoom(team.roomId)!;
          const pending = room.getEventForTxnId(message.id);
          if (pending && pending.status !== EventStatus.NOT_SENT && pending.status !== EventStatus.SENT) throw new MessageError(uiMessage('common.working'));
          return pending?.status === EventStatus.SENT && pending.getId() ? { event_id: pending.getId()! }
            : pending ? client.resendEvent(pending, room)
            : client.sendEvent(team.roomId, EventType.RoomMessage, content, message.id);
        })); guard(); packet.eventId = result.event_id;
        packet.receivedAt = (result as typeof result & { receivedAt?: number }).receivedAt ?? packet.createdAt;
        await scope.wait(runtime.storage.put(`${session.account.id}:outgoing:${message.id}`, session.account.id, 'outgoing', packet, packet.createdAt + DAY));
      }
      guard(); if (packet.uploadId) await scope.wait(runtime.api.request('media.attach', { params: { id: packet.uploadId }, body: { eventId: packet.eventId } }));
      const confirmedId = packet.eventId;
      try { const event = await scope.wait(client.fetchRoomEvent(team.roomId, confirmedId)); guard(); await scope.wait(runtime.timeline.consume(new (await scope.wait(import('matrix-js-sdk'))).MatrixEvent({ ...event, room_id: team.roomId }))); }
      catch { scope.check();
        guard(); if (!runtime.state.data.messages.some(m => m.id === confirmedId)) {
          const confirmed: Message = { ...packet.message, clientId: packet.message.id, id: packet.eventId, status: 'sent' }; runtime.cache.eventTimes.set(confirmed.id, packet.receivedAt ?? packet.createdAt); runtime.state.data.messages.push(confirmed); await scope.wait(runtime.cache.cacheMessage(confirmed, packet.receivedAt ?? packet.createdAt));
        }
      }
      guard(); runtime.state.data.messages = runtime.state.data.messages.filter(m => m.id !== message.id);
      this.outgoing.delete(message.id); await scope.wait(runtime.storage.remove(`${session.account.id}:outgoing:${message.id}`));
      await scope.wait(runtime.storage.clearSentDraft(session.account.id, team.id, packet.draftRevision ?? revision, emptyDraft));
      const draft = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${session.account.id}:draft:${team.id}`)); if (draft) runtime.state.drafts[team.id] = draft;
      runtime.emit();
      void completeTeamStart(runtime, team.id).catch(error => runtime.diagnosticErrors.record(error));
      return { eventId: packet.eventId };
    } catch (error) { scope.check();
      const confirmedId = packet?.eventId;
      if (runtime.auth.session === session && confirmedId && runtime.state.data.messages.some(item => item.id === confirmedId && item.status === 'sent')) return { eventId: confirmedId };
      if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.sendLoginChanged'));
      const { status, detail } = sendFailure(error, Boolean(packet?.attempted), Boolean(packet?.eventId));
      if (error instanceof ApiError && (error.status === 0 && error.code !== 'CONNECTION_UNAVAILABLE' || error.status >= 500)) runtime.state.connection.service = 'unavailable';
      else if (error && typeof error === 'object' && ('httpStatus' in error && Number(error.httpStatus) >= 500 || 'name' in error && error.name === 'ConnectionError')) runtime.state.connection.messaging = 'unavailable';
      runtime.state.data.messages = runtime.state.data.messages.map(m => m.id === message.id ? { ...m, status, failure: detail } : m); runtime.emit();
      if (error instanceof ApiError && error.status === 401 || error && typeof error === 'object' && 'errcode' in error && error.errcode === 'M_UNKNOWN_TOKEN') await scope.wait(runtime.auth.expireRuntimeDevice());
      else if (error && typeof error === 'object' && ('httpStatus' in error && error.httpStatus === 403 || 'status' in error && error.status === 403)) void runtime.refresh().catch(() => {});
      // Keep local validation/storage errors visible when no outgoing bubble was created.
      const visible = runtime.state.data.messages.some(m => m.id === message.id);
      throw new ApiError(0, { error: visible ? 'MESSAGE_SEND_FAILED' : 'MESSAGE_PREPARATION_FAILED', text: detail });
    }
    finally { if (scope.current()) { this.inFlight.delete(message.id); } }
  }
}
