import { REACTION_TTL_MS } from '@palside/shared/contracts/limits';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { messageExpiry } from '../chat/message-expiry';
import type { MatrixEvent,TimelineEvents } from 'matrix-js-sdk';
import { sharingWork } from '../viewing/sharing-work';
import { trustedDeviceMessages } from '../viewing/viewing-targets';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import { readView } from '../viewing/view-snapshot';
import { STICKY_EVENT,STICKY_MAX,POKE_EVENT,teamEventContent,readTeamEvent,readRefTarget,resolveStickies,stickyTargetKey,type StickyRecord } from '../../domain/annotations/social';
import { isReactionEmoji,pruneReactions,readReaction,REACTION_DISPLAY,REACTION_MAX_COUNT } from '../../domain/annotations/reactions';
import type { RuntimeDevice } from '../account/device';
import { text } from '../composition/state';
import { mergePoke,upsertTeamItem } from './team-items';
import { commandError } from '../composition/commands';
import type { PalsideService } from '../composition/core';

type TeamEventResult = { id: string; revision?: string; existing?: boolean };
export type AnnotationDeletion = { id: string; teamId: string; expiresAt: number; status: 'pending' | 'committed'; baseRevision?: string; transactionId?: string; records?: string[] };
type SelectionReceipt = { fingerprint: string; timestamp: number; expiresAt: number; transactionId: string; eventId?: string; completed?: boolean; admitted?: boolean; result?: TeamEventResult };
const selectionLifetime = 86_400_000;
const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class TeamInteractions {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  reactionTimer?: ReturnType<typeof setTimeout>;
  stickyRecords: StickyRecord[] = [];
  private readonly selectionTasks = new Map<string, { fingerprint: string; session: RuntimeDevice; result: Promise<TeamEventResult> }>();
  private readonly selectionReceipts = new Map<string, SelectionReceipt>();
  private readonly stickyChanges = new Map<string, Promise<unknown>>();
  readonly annotationDeletions = new Map<string, AnnotationDeletion>();
  async rememberAnnotationDeletion(id: string, teamId: string, expiresAt: number) {
    const runtime = this.runtime, session = runtime.auth.session;
    if (!session) return;
    const known = this.annotationDeletions.get(id);
    const receipt: AnnotationDeletion = { ...known, id, teamId, expiresAt: Math.max(expiresAt, known?.expiresAt ?? 0), status: 'committed' };
    this.annotationDeletions.set(id, receipt);
    await runtime.storage.put(`${session.account.id}:annotation-deletion:${id}`, session.account.id, 'annotation-deletion', receipt, receipt.expiresAt);
  }
  private changeSticky<T>(key: string, work: () => Promise<T>) {
    const next = (this.stickyChanges.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.stickyChanges.set(key, next);
    void next.finally(() => { if (this.stickyChanges.get(key) === next) this.stickyChanges.delete(key); }).catch(() => {});
    return next;
  }
  private sticky(teamId: string, id: unknown) { return this.runtime.state.items.stickies?.find(item => item.teamId === teamId && item.id === id && item.expiresAt > Date.now()); }
  private stickyPayload(teamId: string, payload: Record<string, unknown>) {
    if (payload.edits === undefined) return payload;
    const original = this.sticky(teamId, payload.edits);
    if (!original || original.author !== this.runtime.auth.session?.account.id) throw commandError('ANNOTATION_UNAVAILABLE', 'extension.runtime.messageUnavailable');
    return { ...payload, asset: original.asset, url: original.url, site: original.site, target: original.target, caption: original.caption };
  }
  async react(teamId: string, emoji: unknown, count: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const { session, client, users, check } = teamSendGuard(runtime, teamId, true);
    if (!isReactionEmoji(emoji) || !Number.isSafeInteger(count) || count < 1) throw new MessageError(uiMessage('common.error'));
    const cryptoApi = client.getCrypto(); if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const others = users.filter(userId => userId !== session.matrix.userId);
    const messages = await scope.wait(sharingWork(trustedDeviceMessages(cryptoApi, others, session.matrix, 'com.palside.reaction', { id: crypto.randomUUID(), teamId, emoji, count: Math.min(count, REACTION_MAX_COUNT), sentAt: Date.now() }, check), 6_000));
    check();
    if (!Object.keys(messages).length) return { delivered: 0 };
    const result = await scope.wait(runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check(); return result;
  }
  consumeReaction(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime;
    if (runtime.auth.session !== session || !event.isEncrypted()) return;
    const reaction = readReaction(event.getContent());
    const team = reaction && runtime.state.remoteTeams.find(t => t.id === reaction.teamId && t.joined);
    const person = team?.people.find(p => p.matrixId === event.getSender() && team.memberIds.includes(p.id) && p.id !== session.account.id);
    if (!reaction || !person) return;
    const known = runtime.state.reactions ?? [];
    if (known.some(item => item.id === reaction.id)) return;
    runtime.state.reactions = pruneReactions([...known, { ...reaction, personId: person.id, at: Date.now() }]);
    clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => { if (runtime.auth.session !== session) return; runtime.state.reactions = pruneReactions(runtime.state.reactions ?? []); runtime.emit(); }, REACTION_DISPLAY + 50);
    runtime.emit();
  }
  async consumePoke(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    if (runtime.auth.session !== session || !event.isEncrypted()) return; const c = event.getContent(); const team = typeof c.teamId === 'string' ? runtime.state.remoteTeams.find(t => t.id === c.teamId && t.joined) : undefined; const person = team?.people.find(p => p.matrixId === event.getSender() && team.memberIds.includes(p.id) && p.id !== session.account.id); if (!team || !person || typeof c.id !== 'string' || typeof c.sentAt !== 'number' || Date.now() - c.sentAt > REACTION_TTL_MS) return; const view = await scope.wait(readView(c.view)); if (!view || view.kind !== 'asset') return; runtime.state.pokes = mergePoke(runtime.state.pokes, { id: c.id, teamId: team.id, from: person.id, view, at: Date.now(), count: 1 }); runtime.emit();
  }
  refreshStickies() {
    const runtime = this.runtime;
    runtime.state.items.stickies = resolveStickies(this.stickyRecords, Date.now(), (id, teamId) => {
      const deletion = this.annotationDeletions.get(id);
      return deletion?.teamId === teamId && deletion.status === 'committed';
    });
  }
  upsertSticky(item: StickyRecord) {
    if (this.annotationDeletions.get(item.id)?.status === 'committed' || item.edits && this.annotationDeletions.get(item.edits)?.status === 'committed') return;
    this.stickyRecords = upsertTeamItem({ stickies: this.stickyRecords }, item).stickies ?? [];
    this.refreshStickies();
  }
  async teamEvent(teamId: string, kind: 'sticky', payload: Record<string, unknown>): Promise<TeamEventResult> {
    if (kind !== 'sticky') throw new MessageError(uiMessage('common.error'));
    const session = this.runtime.auth.session, snapshot = { ...payload }, key = `${session?.account.id}\0${teamId}`;
    return this.changeSticky(key, () => {
      if (session !== this.runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
      return this.selectionEvent(teamId, kind, this.stickyPayload(teamId, snapshot));
    });
  }
  private async selectionEvent(teamId: string, kind: 'sticky', payload: Record<string, unknown>): Promise<TeamEventResult> {
    if (payload.operationId === undefined) return this.sendTeamEvent(teamId, kind, payload);
    if (typeof payload.operationId !== 'string' || !operationPattern.test(payload.operationId)) throw commandError('INVALID_SELECTION_OPERATION', 'common.error');
    const runtime = this.runtime; const scope = runtime.auth.scope(); const session = runtime.auth.session;
    if (!session || !runtime.state.remoteTeams.some(team => team.id === teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
    const operationId = payload.operationId.toLowerCase();
    const snapshot = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const content = teamEventContent(text(snapshot.asset) || undefined, {
      text: typeof snapshot.text === 'string' ? snapshot.text : undefined,
      site: typeof snapshot.site === 'string' ? snapshot.site : undefined,
      url: typeof snapshot.url === 'string' ? snapshot.url : undefined,
      target: readRefTarget(snapshot.target),
      edits: typeof snapshot.edits === 'string' ? snapshot.edits : undefined,
      baseRevision: typeof snapshot.baseRevision === 'string' ? snapshot.baseRevision : undefined,
      caption: typeof snapshot.caption === 'string' ? snapshot.caption : undefined,
    });
    const fingerprint = await scope.wait(digest(canonical(content)));
    const transactionId = `selection-${await scope.wait(digest(JSON.stringify([session.account.id, teamId, kind, operationId])))}`;
    const key = `${session.account.id}:selection:${transactionId}`;
    for (const [id, receipt] of this.selectionReceipts) if (receipt.expiresAt <= Date.now()) this.selectionReceipts.delete(id);
    const existing = this.selectionTasks.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw commandError('SELECTION_OPERATION_CONFLICT', 'common.error');
      if (existing.session !== session) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
      return scope.wait(existing.result);
    }
    const result = (async () => {
      let receipt = this.selectionReceipts.get(key) ?? await scope.wait(runtime.storage.get<SelectionReceipt>(key));
      if (receipt && receipt.fingerprint !== fingerprint) throw commandError('SELECTION_OPERATION_CONFLICT', 'common.error');
      if (receipt && receipt.expiresAt <= Date.now()) throw commandError('SELECTION_OPERATION_EXPIRED', 'extension.runtime.outgoingExpired');
      if (!receipt) {
        const timestamp = Date.now();
        receipt = { fingerprint, timestamp, expiresAt: timestamp + selectionLifetime, transactionId };
        // Persist only a digest and receipt metadata, never a second plaintext copy of the selected content.
        await scope.wait(runtime.storage.put(key, session.account.id, 'selection', receipt, receipt.expiresAt));
      }
      this.selectionReceipts.set(key, receipt);
      if (receipt.completed && (receipt.result || receipt.eventId)) return receipt.result ?? { id: receipt.eventId! };
      const save = () => runtime.storage.put(key, session.account.id, 'selection', receipt!, receipt!.expiresAt);
      const sent = await scope.wait(this.sendTeamEvent(teamId, kind, snapshot, { receipt, save }));
      receipt.completed = true;
      receipt.result = sent;
      await scope.wait(save());
      return sent;
    })();
    this.selectionTasks.set(key, { fingerprint, session, result });
    try { return await scope.wait(result); }
    finally { if (this.selectionTasks.get(key)?.result === result) this.selectionTasks.delete(key); }
  }
  private async sendTeamEvent(teamId: string, kind: 'sticky', payload: Record<string, unknown>, operation?: { receipt: SelectionReceipt; save: () => Promise<void> }) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const { session, client, team, check } = teamSendGuard(runtime, teamId);
    const people = team.people.filter(person => !person.deleted && team.memberIds.includes(person.id));
    const asset = text(payload.asset) || undefined;
    const count = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text(payload.text).trim())).length;
    if (count > STICKY_MAX) throw new MessageError(uiMessage('extension.runtime.stickyTooLong', { count }));
    if (payload.edits !== undefined) {
      const original = this.sticky(teamId, payload.edits);
      if (!original || original.author !== session.account.id || original.asset !== asset) throw commandError('ANNOTATION_UNAVAILABLE', 'extension.runtime.messageUnavailable');
      const revision = original.revision ?? original.id;
      if (!operation?.receipt.admitted && payload.baseRevision !== revision) throw commandError('ANNOTATION_CONFLICT', 'extension.runtime.annotationChanged');
    }
    if (payload.target !== undefined && readRefTarget(payload.target)?.kind !== 'quote') throw new MessageError(uiMessage('common.error'));
    if (payload.edits === undefined && !operation?.receipt.eventId) {
      const targetKey = stickyTargetKey({ url: typeof payload.url === 'string' ? payload.url : undefined, target: readRefTarget(payload.target) });
      const existing = targetKey && runtime.state.items.stickies?.find(item => item.teamId === teamId && item.author === session.account.id && item.expiresAt > Date.now() && stickyTargetKey(item) === targetKey);
      if (existing) return { id: existing.id, revision: existing.revision ?? existing.id, existing: true };
    }
    const fields = {
      text: typeof payload.text === 'string' ? payload.text : undefined,
      site: typeof payload.site === 'string' ? payload.site : undefined,
      url: typeof payload.url === 'string' ? payload.url : undefined,
      target: readRefTarget(payload.target),
      edits: typeof payload.edits === 'string' ? payload.edits : undefined,
      baseRevision: typeof payload.baseRevision === 'string' ? payload.baseRevision : undefined,
      caption: typeof payload.caption === 'string' ? payload.caption : undefined,
    };
    const type = STICKY_EVENT;
    const content = teamEventContent(asset, fields);
    const parsed = readTeamEvent(type, content);
    if (!parsed || parsed.kind !== 'sticky') throw new MessageError(uiMessage('common.error'));
    if (operation && !operation.receipt.admitted) { operation.receipt.admitted = true; await scope.wait(operation.save()); }
    const transactionId = operation?.receipt.transactionId ?? crypto.randomUUID();
    await scope.wait(requireEncryptedSend(client, team.roomId, people, check));
    check();
    const room = operation ? client.getRoom(team.roomId) : undefined;
    const pending = operation?.receipt.eventId ? undefined : room?.getEventForTxnId(transactionId);
    // The SDK retains failed local echoes by transaction id; creating another echo with that id throws.
    if (pending && pending.status !== 'not_sent' && pending.status !== 'sent') throw commandError('SELECTION_OPERATION_PENDING', 'common.working');
    const result = operation?.receipt.eventId ? { event_id: operation.receipt.eventId }
      : pending?.status === 'sent' && pending.getId() ? { event_id: pending.getId()! }
      : pending && room ? await scope.wait(client.resendEvent(pending, room))
      : await scope.wait(client.sendEvent(team.roomId, type as keyof TimelineEvents, content as never, transactionId));
    check();
    const id = result.event_id;
    if (operation && !operation.receipt.eventId) { operation.receipt.eventId = id; await scope.wait(operation.save()); check(); }
    const timestamp = operation?.receipt.timestamp ?? Date.now();
    const expiresAt = messageExpiry(undefined, timestamp, team.retentionDays);
    const item = { ...parsed, id, teamId, author: session.account.id, timestamp, expiresAt };
    this.upsertSticky(item);
    const evicted = await scope.wait(runtime.storage.cache(session.account.id, `item:${id}`, { kind: 'stickies', item }, expiresAt));
    check(); runtime.cache.evictCachedContent(evicted); runtime.emit();
    const root = parsed.edits ?? id, current = this.sticky(teamId, root);
    if (parsed.edits && current?.revision !== id) throw commandError('ANNOTATION_CONFLICT', 'extension.runtime.annotationChanged');
    return { id: root, revision: current?.revision ?? id };
  }
  async removeSticky(teamId: string, id: unknown, baseRevision: unknown) {
    const runtime = this.runtime, session = runtime.auth.session;
    return this.changeSticky(`${session?.account.id}\0${teamId}`, async () => {
      const scope = runtime.auth.scope(); runtime.auth.requireConnection();
      if (!session || session !== runtime.auth.session || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
      const team = runtime.state.remoteTeams.find(item => item.id === teamId && item.joined);
      if (!team || typeof id !== 'string') throw commandError('ANNOTATION_UNAVAILABLE', 'extension.runtime.messageUnavailable');
      const key = `${session.account.id}:annotation-deletion:${id}`;
      let receipt = this.annotationDeletions.get(id) ?? await scope.wait(runtime.storage.get<AnnotationDeletion>(key));
      if (receipt && (receipt.teamId !== teamId || receipt.baseRevision !== baseRevision)) throw commandError('ANNOTATION_CONFLICT', 'extension.runtime.annotationChanged');
      if (!receipt) {
        const original = this.sticky(teamId, id);
        if (!original || original.author !== session.account.id) throw commandError('ANNOTATION_UNAVAILABLE', 'extension.runtime.messageUnavailable');
        if (baseRevision !== (original.revision ?? original.id)) throw commandError('ANNOTATION_CONFLICT', 'extension.runtime.annotationChanged');
        receipt = { id, teamId, baseRevision: String(baseRevision), transactionId: `annotation-delete-${await scope.wait(digest(JSON.stringify([session.account.id, teamId, id, baseRevision])))}`, status: 'pending', expiresAt: Math.max(original.expiresAt, Date.now() + selectionLifetime), records: this.stickyRecords.filter(item => item.teamId === teamId && item.author === session.account.id && (item.id === id || item.edits === id)).map(item => item.id) };
        await scope.wait(runtime.storage.put(key, session.account.id, 'annotation-deletion', receipt, receipt.expiresAt));
      }
      this.annotationDeletions.set(id, receipt);
      if (receipt.status !== 'committed') {
        // Unknown results retry the same SDK transaction; no new root or local success is invented.
        await scope.wait(runtime.auth.client.redactEvent(team.roomId, id, receipt.transactionId));
        receipt.status = 'committed';
      }
      runtime.timeline.redactions.set(id, false);
      this.stickyRecords = this.stickyRecords.filter(item => item.id !== id && item.edits !== id);
      this.refreshStickies(); runtime.emit();
      const observed = this.annotationDeletions.get(id);
      if (observed?.status === 'committed') receipt = { ...receipt, expiresAt: Math.max(receipt.expiresAt, observed.expiresAt) };
      this.annotationDeletions.set(id, receipt);
      await scope.wait(runtime.storage.put(key, session.account.id, 'annotation-deletion', receipt, receipt.expiresAt));
      for (const eventId of receipt.records ?? [id]) await scope.wait(runtime.storage.remove(`${session.account.id}:cache:item:${eventId}`));
      for (const eventId of receipt.records ?? []) if (eventId !== id) await scope.wait(runtime.auth.client.redactEvent(team.roomId, eventId).catch(error => runtime.diagnosticErrors?.record(error)));
      return { id };
    });
  }
  async poke(teamId: string, accountId: string) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const eligibility = teamSendGuard(runtime, teamId, true);
    const { session, team, client } = eligibility;
    const viewing = runtime.sharing.ownViewing;
    const target = team.people.find(person => !person.deleted && person.id === accountId && team.memberIds.includes(person.id));
    const check = () => {
      eligibility.check();
      if (!viewing || runtime.sharing.ownViewing !== viewing || viewing.teamId !== teamId || viewing.expiresAt <= Date.now()) throw commandError('POKE_NEEDS_SHARING', 'extension.member.needSharing');
      if (!target || runtime.state.data.people.find(person => person.id === accountId)?.presence !== 'active') throw commandError('POKE_OFFLINE', 'extension.runtime.pokeOffline');
    };
    check();
    const cryptoApi = client.getCrypto(); if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const messages = await scope.wait(sharingWork(trustedDeviceMessages(cryptoApi, [target!.matrixId], session.matrix, POKE_EVENT, { id: crypto.randomUUID(), teamId, view: viewing!.view, sentAt: Date.now() }, check), 6_000));
    check();
    if (!Object.keys(messages).length) return { delivered: 0 };
    const result = await scope.wait(runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check(); return result;
  }
}
