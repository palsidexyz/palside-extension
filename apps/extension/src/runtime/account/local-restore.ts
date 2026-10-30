import { message as uiMessage } from '@palside/i18n';
import { isValidVault,type Identity } from '@palside/shared/identity';
import { usableDirectory,type OfflineDirectory } from './offline-directory';
import { ApiError } from '../transport/api';
import type { RevisionedDraft } from '../storage/storage';
import { validateView } from '../viewing/view-snapshot';
import { type StickyRecord } from '../../domain/annotations/social';
import type { Draft,Message } from '../../domain/chat/model';
import type { Viewing } from '../../domain/assets/model';
import type { Outgoing } from '../chat/outgoing';
import type { RuntimeDevice } from './device';
import { color,readPreferences } from '../composition/state';
import { type CleanupIntent } from './cleanup';
import type { SessionRuntime } from './session-lifecycle';

export async function start(this: SessionRuntime) {
    const runtime = this.runtime;
    const cleanup = await runtime.storage.get<CleanupIntent>('device-cleanup');
    if (cleanup) this.resumeCleanup(cleanup);
    await this.finishCleanup();
    await runtime.storage.cleanup();
    const pendingInvite = (await runtime.storage.rows<string>('_device', 'invite')).find(row => row.key === 'pending-invite');
    runtime.state.data.pendingInvite = pendingInvite?.value; runtime.dispatch.inviteExpiresAt = pendingInvite?.expiresAt ?? 0;
    const device = await runtime.storage.get<RuntimeDevice>('device');
    const pending = await runtime.storage.get<RuntimeDevice>('pending-device');
    const session = device ?? pending;
    if (device && pending) await runtime.storage.remove('pending-device');
    const stored = await runtime.storage.get<unknown>('vault');
    const vault = isValidVault(stored) ? stored : undefined;
    if (session && (!device || !vault || device.crypto !== 'ready')) {
      this.session = session;
      await Promise.all([this.revokeDevice(session), this.clearDevice(false)]); runtime.state.error = uiMessage('extension.runtime.loginIncomplete');
    } else if (session) {
      try { await this.connect(session); }
      catch (error) { if (error instanceof ApiError && error.status === 401) { if (this.session) await this.expireRuntimeDevice(); } else if (runtime.state.connection.service !== 'unavailable' && runtime.state.connection.messaging !== 'failed') runtime.state.connection.messaging = 'unavailable'; }
      if (this.session) await runtime.wallet.start().catch(() => {});
    }
    if (!this.session) { try { runtime.state.config = await runtime.api.request('system.config'); runtime.state.connection.service = 'ready'; } catch { runtime.state.connection.service = 'unavailable'; } }
    runtime.state.ready = true; runtime.emit();
    this.timer ??= setInterval(() => { void runtime.cache.expireLocalContent().catch(() => {}); void this.maintainConnection().catch(() => {}); void runtime.sharing.publishViewing().catch(() => {}); runtime.rooms.pruneIfChanged(); }, 5000);
  }

export async function restoreLocalData(this: SessionRuntime, session: RuntimeDevice, identity: Identity | undefined, guard: () => void) {
  const runtime = this.runtime;
    runtime.state.account = session.account; runtime.state.authenticated = !identity;
    runtime.state.data.self = session.account.id;
    if (!runtime.state.data.teams.length) {
      const saved = usableDirectory(await runtime.storage.get<OfflineDirectory>(`${session.account.id}:cache:directory`), session.account.id);
      guard();
      if (saved) { runtime.state.data.teams = saved.teams; runtime.state.data.people = saved.people; this.directoryExpiresAt = saved.expiresAt; }
    }
    runtime.state.data.people = [{ id: session.account.id, name: session.account.nickname || '', color: color(session.account.id) }, ...runtime.state.data.people.filter(p => p.id !== session.account.id)];
    const storedPreferences = await runtime.storage.get<unknown>(`${session.account.id}:preferences`);
    guard();
    runtime.state.preferences = readPreferences(storedPreferences);
    runtime.sharing.persistedPreferences = runtime.state.preferences;
    await runtime.sharing.restoreToggles(); guard();
    const rows = await runtime.storage.rows<RevisionedDraft<Draft>>(session.account.id, 'draft');
    guard();
    runtime.state.drafts = Object.fromEntries(rows.map(row => [row.key.split(':draft:')[1]!, row.value]));
    const deletions = await runtime.storage.rows<import('../annotations/interactions').AnnotationDeletion>(session.account.id, 'annotation-deletion');
    guard();
    for (const { value } of deletions) {
      if (!value || typeof value.id !== 'string' || typeof value.teamId !== 'string' || value.expiresAt <= Date.now() || !['pending', 'committed'].includes(value.status)) continue;
      runtime.interactions.annotationDeletions.set(value.id, value);
      if (value.status === 'committed') runtime.timeline.redactions.set(value.id, false);
    }
    const cached = await runtime.storage.rows<{ message?: Message; views?: Viewing[]; timestamp?: number; kind?: 'stickies'; item?: StickyRecord }>(session.account.id, 'cache');
    guard();
    for (const row of cached) {
      guard();
      if (row.value.item) {
        const item = row.value.item;
        if (item.expiresAt <= Date.now()) { await runtime.storage.remove(row.key); continue; }
        const kind = row.value.kind;
        if (kind === 'stickies') runtime.interactions.upsertSticky(item as StickyRecord);
        continue;
      }
      if (!row.value.message) continue;
      if (typeof row.value.timestamp !== 'number') continue;
      const cachedMessage = row.value.message;
      if (!row.value.message.id.startsWith('$')) { await runtime.storage.remove(row.key); continue; }
      row.value.message.timestamp = row.value.timestamp;
      if (runtime.cache.expiresAt(row.value.message, row.value.timestamp) <= Date.now()) { await runtime.storage.remove(row.key); await runtime.storage.remove(`${session.account.id}:cache:media:event:${row.value.message.id}`); continue; }
      const attachment = row.value.message.attachment;
      if (attachment?.kind === 'image') {
        const id = `event:${row.value.message.id}`;
        const blob = await runtime.storage.get<Blob>(`${session.account.id}:cache:media:${id}`);
        guard();
        if (blob instanceof Blob) { attachment.src = runtime.cache.mediaUrls.get(id) ?? URL.createObjectURL(blob); runtime.cache.mediaUrls.set(id, attachment.src); }
      }
      runtime.state.data.messages = [...runtime.state.data.messages.filter(m => m.id !== cachedMessage.id), cachedMessage]; runtime.cache.eventTimes.set(cachedMessage.id, row.value.timestamp);
      for (const view of row.value.views ?? []) runtime.cache.upsertView(view);
    }
    guard();
    for (const row of await runtime.storage.rows<Outgoing>(session.account.id, 'outgoing')) {
      guard();
      row.value.message.timestamp = row.value.createdAt;
      runtime.sending.outgoing.set(row.value.message.id, row.value);
      runtime.state.data.messages = [...runtime.state.data.messages.filter(m => m.id !== row.value.message.id), { ...row.value.message, status: row.value.attempted ? 'uncertain' : 'waiting' }];
      if (row.value.asset) runtime.cache.upsertView(row.value.asset);
      if (row.value.message.ref) runtime.cache.upsertView(row.value.message.ref.view);
    }
    guard();
    for (const draft of Object.values(runtime.state.drafts)) {
      if (draft.value.ref) runtime.cache.upsertView(draft.value.ref.view);
      const attachment = draft.value.attachment; if (attachment?.kind !== 'asset') continue;
      const view = attachment.view;
      if (view && validateView(view)) runtime.cache.upsertView({ ...view, id: attachment.assetId });
    }
    runtime.state.data.messages.sort((a, b) => (runtime.cache.eventTimes.get(a.id) ?? runtime.sending.outgoing.get(a.id)?.createdAt ?? Date.now()) - (runtime.cache.eventTimes.get(b.id) ?? runtime.sending.outgoing.get(b.id)?.createdAt ?? Date.now()));
    await runtime.cache.expireLocalContent(); guard();
    runtime.state.ready = true; runtime.emit();
}
