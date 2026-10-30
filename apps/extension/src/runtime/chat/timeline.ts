import { READ_IDS_LIMIT,IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { notificationTarget } from './notification-policy';
import { messageExpiry } from './message-expiry';
import type { MatrixEvent } from 'matrix-js-sdk';
import { decryptAttachment } from 'matrix-encrypt-attachment';
import { ApiError } from '../transport/api';
import type { RevisionedDraft } from '../storage/storage';
import { readView } from '../viewing/view-snapshot';
import { STICKY_EVENT,readTeamEvent,readMessageRefTarget,readRefCaption } from '../../domain/annotations/social';
import { emptyDraft,readQuoteRange,type Draft,type Message } from '../../domain/chat/model';
import { publicShareUrl } from '@palside/shared/navigation';
import type { RuntimeDevice } from '../account/device';
import { SNAPSHOT_INTERVAL,text } from '../composition/state';
import type { PalsideService } from '../composition/core';

export class TimelineRuntime {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  missingEvents = new Map<string, Set<string>>();
  edits = new Map<string, { text: string; timestamp: number; author: string; teamId: string; expiresAt: number }>();
  redactions = new Map<string, boolean>();
  readyForLiveEvents = false;
  notifying = new Map<string, RuntimeDevice>();
  visibleMessages = new Set<string>();
  visiblePanels = new Map<string, string[]>();
  pendingRead = new Map<string, Set<string>>();
  readTimer?: ReturnType<typeof setTimeout>;
  async consume(event: MatrixEvent, liveArrival = false) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!session || event.status) return;
    const roomId = event.getRoomId();
    let team = runtime.state.remoteTeams.find(t => t.roomId === roomId); if (!team) return;
    const teamId = team.id, timestamp = event.getTs();
    const readableTeam = () => {
      if (runtime.auth.session !== session) return;
      const current = runtime.cache.readableTeam(teamId, timestamp, roomId);
      return current && messageExpiry(event.getUnsigned()?.['xyz.palside.expires_at'], timestamp, current.retentionDays) > Date.now() ? current : undefined;
    };
    const eventId = event.getId(); if (!eventId) return;
    if (event.isEncrypted() && event.isBeingDecrypted()) return;
    if (event.isEncrypted() && event.shouldAttemptDecryption()) await scope.wait(runtime.auth.client?.decryptEventIfNeeded(event));
    if (runtime.auth.session !== session) return;
    team = runtime.state.remoteTeams.find(t => t.id === teamId && t.roomId === roomId); if (!team) return;
    if (!event.isRedaction() && !readableTeam()) return;
    if (event.isDecryptionFailure()) {
      const missing = this.missingEvents.get(team.id) ?? new Set<string>(); missing.add(eventId); this.missingEvents.set(team.id, missing);
      runtime.state.history ??= {}; runtime.state.history[team.id] = { missingKeys: missing.size, loaded: false, loading: false }; runtime.emit(); return;
    }
    this.missingEvents.get(team.id)?.delete(eventId);
    if (runtime.state.history?.[team.id]) runtime.state.history[team.id]!.missingKeys = this.missingEvents.get(team.id)?.size ?? 0;
    if (event.isRedaction()) {
      const target = event.getAssociatedId();
      if (target) {
        // The gateway performs redactions with its service account and sets the
        // reason after checking author/owner permission; sender is not the actor.
        const removedByOwner = event.getContent().reason === 'owner';
        runtime.state.data.messages = runtime.state.data.messages.map(m => m.id === target ? { ...m, text: '', attachment: undefined, ref: undefined, replyTo: undefined, replyRange: undefined, replyToExpiresAt: undefined, mentionIds: [], recalled: true, removedByOwner } : m);
        this.redactions.set(target, removedByOwner); this.edits.delete(target);
        runtime.cache.pruneViews();
        const mediaKey = `${session.account.id}:cache:media:event:${target}`;
        await scope.wait(runtime.storage.remove(mediaKey)); if (runtime.auth.session !== session) return; runtime.cache.evictCachedContent([mediaKey]);
        const removed = runtime.state.data.messages.find(m => m.id === target); const timestamp = runtime.cache.eventTimes.get(target);
        if (removed && timestamp) await scope.wait(runtime.cache.cacheMessage(removed, timestamp)); else await scope.wait(runtime.storage.remove(`${session.account.id}:cache:${target}`));
        const removedStickies = runtime.interactions.stickyRecords.filter(item => item.id === target || item.edits === target);
        runtime.interactions.stickyRecords = runtime.interactions.stickyRecords.filter(item => !removedStickies.includes(item));
        runtime.interactions.refreshStickies();
        // Persist the tombstone before removing cached records, including when redaction arrives before the original.
        await scope.wait(runtime.interactions.rememberAnnotationDeletion(target, team.id, Math.max(Date.now(), event.getTs()) + team.retentionDays * 86_400_000));
        for (const item of removedStickies) await scope.wait(runtime.storage.remove(`${session.account.id}:cache:item:${item.id}`));
      }
      runtime.emit(); return;
    }
    if (!event.isEncrypted()) return;
    const teamEvent = event.getType() === STICKY_EVENT ? readTeamEvent(STICKY_EVENT, event.getContent()) : undefined;
    if (teamEvent?.kind === 'sticky') {
      if (!event.isEncrypted() || event.isRedacted() || this.redactions.has(eventId)) return;
      const expiresAt = messageExpiry(event.getUnsigned()?.['xyz.palside.expires_at'], timestamp, team.retentionDays);
      const person = team.people.find(p => p.matrixId === event.getSender());
      if (!person || !team.memberIds.includes(person.id)) return;
      if (teamEvent.edits && this.redactions.has(teamEvent.edits)) return;
      const item = { ...teamEvent, id: eventId, teamId: team.id, author: person.id, timestamp, expiresAt };
      runtime.cache.evictCachedContent(await scope.wait(runtime.storage.cache(session.account.id, `item:${eventId}`, { kind: 'stickies', item }, expiresAt)));
      const current = readableTeam();
      if (!current) { await scope.wait(runtime.storage.remove(`${session.account.id}:cache:item:${eventId}`)); return; }
      item.expiresAt = messageExpiry(item.expiresAt, timestamp, current.retentionDays);
      runtime.interactions.upsertSticky(item);
      runtime.emit(); return;
    }
    if (event.getType() !== 'm.room.message' || event.isDecryptionFailure()) return;
    const expiresAt = messageExpiry(event.getUnsigned()?.['xyz.palside.expires_at'], timestamp, team.retentionDays);
    const content = event.getContent();
    const person = team.people.find(p => p.matrixId === event.getSender());
    if (!person) { await scope.wait(runtime.refresh()); if (runtime.state.remoteTeams.find(t => t.id === teamId)?.people.some(p => p.matrixId === event.getSender())) await scope.wait(this.consume(event, liveArrival)); return; }
    const relation = content['m.relates_to'];
    if (relation?.rel_type === 'm.replace' && typeof relation.event_id === 'string') {
      const original = runtime.state.data.messages.find(m => m.id === relation.event_id && m.author === person.id && !m.recalled);
      const latest = this.edits.get(relation.event_id);
      if (typeof content['m.new_content']?.body === 'string' && !this.redactions.has(relation.event_id) && (!latest || timestamp > latest.timestamp)) this.edits.set(relation.event_id, { text: text(content['m.new_content'].msgtype === 'm.image' ? content['m.new_content']['com.palside.caption'] : content['m.new_content'].body).slice(0, 40_000), timestamp, author: person.id, teamId: team.id, expiresAt });
      if (original && typeof content['m.new_content']?.body === 'string' && timestamp > (original.editedAt ?? 0)) {
        original.text = text(content['m.new_content'].msgtype === 'm.image' ? content['m.new_content']['com.palside.caption'] : content['m.new_content'].body).slice(0, 40_000); original.edited = true; original.editedAt = timestamp; original.mentionIds = [];
        await scope.wait(runtime.cache.cacheMessage(original, runtime.cache.eventTimes.get(original.id)!)); runtime.emit();
      }
      return;
    }
    const asset = await scope.wait(readView(content['com.palside.asset']));
    team = readableTeam(); if (!team) return;
    const fallbackAssetUrl = !asset && typeof content['com.palside.asset']?.url === 'string' ? publicShareUrl(content['com.palside.asset'].url) : null;
    if (asset) asset.id = `${asset.id}:event:${eventId}:asset`;
    const transactionId = person.id === session.account.id ? event.getTxnId() ?? event.getUnsigned().transaction_id : undefined;
    const refContent = content['com.palside.ref'] as Record<string, unknown> | undefined; const refTarget = readMessageRefTarget(refContent?.target); const refCaption = readRefCaption(refContent?.caption, refTarget); const refView = await scope.wait(readView(refContent?.view)); const ref = refTarget && refCaption && refView ? { target: refTarget, caption: refCaption, view: refView } : undefined;
    team = readableTeam(); if (!team) return;
    const message: Message = { clientId: transactionId, id: eventId, teamId: team.id, author: person.id, text: text(content.body).slice(0, 40_000), time: '', timestamp, expiresAt, status: 'sent', replyTo: relation?.['m.in_reply_to']?.event_id, replyRange: relation?.['m.in_reply_to']?.event_id ? readQuoteRange(content['com.palside.reply_range']) : undefined, mentionIds: team.people.filter(p => Array.isArray(content['m.mentions']?.user_ids) && content['m.mentions'].user_ids.includes(p.matrixId)).map(p => p.id), ...(ref ? { ref } : {}), ...(asset ? { attachment: { kind: 'asset', assetId: asset.id, view: asset } } : {}) };
    if (!event.isRedacted() && !this.redactions.has(eventId) && !runtime.state.data.messages.find(m => m.id === eventId)?.recalled && content.msgtype === 'm.image' && content.file?.['com.palside.media'] && content.info?.mimetype && IMAGE_MIME_TYPES.some(type => type === content.info.mimetype)) {
      const mediaId = text(content.file['com.palside.media']);
      try {
        const src = await scope.wait(runtime.cache.cachedMedia(`event:${eventId}`, async () => { const ciphertext = await scope.wait(runtime.api.media(mediaId, eventId)); const clear = await scope.wait(decryptAttachment(ciphertext, content.file)); return new Blob([clear], { type: content.info.mimetype }); }, () => readableTeam() ? runtime.cache.expiresAt(message) : 0));
        message.attachment = { kind: 'image', src, name: text(content.filename) }; message.text = text(content['com.palside.caption']);
      } catch { scope.check(); message.attachment = { kind: 'image', src: '', name: text(content.filename) }; message.text = text(content['com.palside.caption']); }
    }
    if (runtime.auth.session !== session) return;
    if (!readableTeam()) { await scope.wait(runtime.storage.remove(`${session.account.id}:cache:media:event:${eventId}`)); runtime.cache.pruneMedia(); return; }
    const edit = this.edits.get(eventId); const cached = runtime.state.data.messages.find(m => m.id === eventId);
    message.expiresAt = runtime.cache.expiresAt(message);
    if (cached?.expiresAt !== undefined) message.expiresAt = Math.min(message.expiresAt, cached.expiresAt);
    if (message.expiresAt <= Date.now()) { await scope.wait(runtime.storage.remove(`${session.account.id}:cache:media:event:${eventId}`)); runtime.cache.pruneMedia(); return; }
    message.liveArrival = cached?.liveArrival ?? (!cached && liveArrival);
    message.replyToExpiresAt = cached?.replyToExpiresAt;
    message.clientId ??= cached?.clientId ?? [...runtime.sending.outgoing.values()].find(packet => packet.eventId === eventId)?.message.id;
    if (edit?.author === person.id && edit.timestamp >= (cached?.editedAt ?? 0)) { message.text = edit.text; message.edited = true; message.editedAt = edit.timestamp; message.mentionIds = []; }
    else if (cached?.editedAt) { message.text = cached.text; message.edited = true; message.editedAt = cached.editedAt; message.mentionIds = []; }
    if (fallbackAssetUrl && !message.text.includes(fallbackAssetUrl)) message.text = [message.text, fallbackAssetUrl].filter(Boolean).join('\n');
    if (event.isRedacted() || this.redactions.has(eventId) || cached?.recalled) {
      const mediaKey = `${session.account.id}:cache:media:event:${eventId}`;
      await scope.wait(runtime.storage.remove(mediaKey)); if (runtime.auth.session !== session) return; runtime.cache.evictCachedContent([mediaKey]);
      message.text = ''; message.attachment = undefined; message.ref = undefined; message.replyTo = undefined; message.replyRange = undefined; message.replyToExpiresAt = undefined; message.mentionIds = []; message.recalled = true;
      const reason = event.getRedactionEvent()?.content?.reason;
      message.removedByOwner = this.redactions.get(eventId) ?? (reason === 'owner' ? true : reason === 'author' ? false : cached?.removedByOwner);
    }
    if (!readableTeam()) return;
    message.expiresAt = runtime.cache.expiresAt(message);
    if (!message.recalled) for (const view of [asset, ref?.view]) if (view) runtime.cache.upsertView(view);
    const same = (m: Message) => m.id === eventId || (message.clientId && m.id === message.clientId);
    runtime.state.data.messages = [...runtime.state.data.messages.filter(m => !same(m)), message];
    if (message.recalled) runtime.cache.pruneViews();
    runtime.cache.eventTimes.set(eventId, timestamp); runtime.state.data.messages.sort((a, b) => (runtime.cache.eventTimes.get(a.id) ?? Date.now()) - (runtime.cache.eventTimes.get(b.id) ?? Date.now()));
    const pending = transactionId ? runtime.sending.outgoing.get(transactionId) : undefined;
    if (transactionId && pending) {
      pending.eventId = eventId; pending.receivedAt = timestamp;
      runtime.sending.outgoing.delete(transactionId); await scope.wait(runtime.storage.remove(`${session.account.id}:outgoing:${transactionId}`));
      await scope.wait(runtime.storage.clearSentDraft(session.account.id, team.id, pending.draftRevision ?? -1, emptyDraft));
      const draft = await scope.wait(runtime.storage.get<RevisionedDraft<Draft>>(`${session.account.id}:draft:${team.id}`));
      if (runtime.auth.session !== session) return;
      if (draft) runtime.state.drafts[team.id] = draft;
    }
    if (!readableTeam()) return;
    await scope.wait(runtime.cache.cacheMessage(message, timestamp));
    if (!readableTeam()) return;
    runtime.emit();
    if (message.liveArrival && this.readyForLiveEvents && timestamp >= runtime.auth.receiveSince && message.author !== session.account.id && !message.recalled) {
      setTimeout(() => { if (runtime.auth.session === session) void this.notifyMessage(message, timestamp).catch(() => {}); }, 900);
    }
  }
  async notifyMessage(message: Message, timestamp: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!session) return;
    const identity = { accountId: session.account.id, messageId: message.id, teamId: message.teamId };
    const eligible = () => runtime.auth.session === session && message.liveArrival && !this.visibleMessages.has(message.id) && timestamp >= runtime.auth.receiveSince && runtime.cache.expiresAt(message, timestamp) > Date.now() ? notificationTarget(runtime.state, { ...identity, preview: Boolean(runtime.state.preferences.notificationPreview) }) : undefined;
    const key = `${session.account.id}:notified:${message.id}`;
    if (!eligible() || this.notifying.get(key) === session) return;
    this.notifying.set(key, session);
    try {
      if (await scope.wait(runtime.storage.get(key)) || !eligible()) return;
      await scope.wait(runtime.storage.put(key, session.account.id, 'notification', { teamId: message.teamId, messageId: message.id }, runtime.cache.expiresAt(message)));
      const target = eligible();
      if (!target) { await scope.wait(runtime.storage.remove(key)); return; }
      await scope.wait(runtime.notify({ ...identity, preview: Boolean(runtime.state.preferences.notificationPreview) }));
    } finally { if (scope.current()) { if (this.notifying.get(key) === session) this.notifying.delete(key); } }
  }
  scheduleReadFlush(delay: number) {
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => { void this.flushRead().catch(() => {}); }, delay);
  }
  async flushRead() {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!session) return;
    const batches = [...this.pendingRead]; this.pendingRead.clear();
    for (const [teamId, ids] of batches) {
      try { await scope.wait(runtime.api.request('teams.preferences', { params: { id: teamId }, body: { readIds: [...ids].slice(-READ_IDS_LIMIT) } })); }
      catch (error) { scope.check();
        if (runtime.auth.session !== session || !(error instanceof ApiError) || (error.status >= 400 && error.status < 500 && error.status !== 429)) continue;
        // Keep unsent positions for one later attempt; newer reads join the same batch.
        const pending = this.pendingRead.get(teamId) ?? new Set<string>(); for (const id of ids) pending.add(id); this.pendingRead.set(teamId, pending);
        this.scheduleReadFlush(Math.max(error.retryAfterMs ?? 0, SNAPSHOT_INTERVAL));
      }
    }
  }
}
