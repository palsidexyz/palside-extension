import { resolveTokenMetadata,tokenName } from '../viewing/token-page';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { messageExpiry } from '../chat/message-expiry';
import { retainedViews } from '../viewing/view-retention';
import { POKE_DISPLAY } from '../../domain/annotations/social';
import type { Message } from '../../domain/chat/model';
import type { Viewing } from '../../domain/assets/model';
import { DAY } from '../composition/state';
import { clearCache } from './local-data';
import type { CacheEntry } from '../storage/storage';
import type { RuntimeDevice } from '../account/device';
import type { PalsideService } from '../composition/core';

export class LocalDataRuntime {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  lastCleanup = 0;
  eventTimes = new Map<string, number>();
  preparedViews = new Map<string, number>();
  mediaUrls = new Map<string, string>();
  readableTeam(teamId: string, timestamp: number, roomId?: string) {
    return this.runtime.state.remoteTeams.find(team => team.id === teamId && (roomId === undefined || team.roomId === roomId) && team.periods.some(period => timestamp >= period.joinedAt && (period.leftAt === null || timestamp <= period.leftAt)));
  }
  expiresAt(message: Message, timestamp = message.timestamp) {
    const runtime = this.runtime;
    const team = runtime.state.remoteTeams.find(t => t.id === message.teamId) ?? runtime.state.data.teams.find(t => t.id === message.teamId);
    return messageExpiry(message.expiresAt, timestamp, team?.retentionDays);
  }
  async clear() {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    await scope.wait(runtime.rooms.clearLocal());
    const result = await scope.wait(clearCache(runtime.storage));
    // Keep the current reading position and text, but never leave revoked URLs in UI state.
    // Keys, drafts and pending sends are separate storage kinds and remain untouched.
    const account = runtime.auth.session?.account.id;
    if (account) this.evictCachedContent([...this.mediaUrls.keys()].map(id => `${account}:cache:media:${id}`));
    runtime.emit();
    return result;
  }
  async expireLocalContent() {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session;
    const now = Date.now();
    // Cached content loads before the first membership snapshot on a cold start.
    // This controls local retention only; commands still require remoteTeams.
    const readable = (teamId: string) => runtime.auth.snapshotAt === 0 || runtime.state.remoteTeams.some(team => team.id === teamId && team.joined);
    for (const [id, receipt] of runtime.interactions.annotationDeletions) if (receipt.expiresAt <= now) runtime.interactions.annotationDeletions.delete(id);
    if (runtime.auth.directoryExpiresAt && runtime.auth.directoryExpiresAt <= now) { runtime.auth.directoryExpiresAt = 0; runtime.state.data.teams = []; runtime.state.data.people = runtime.state.data.people.filter(p => p.id === runtime.state.data.self); runtime.emit(); }
    const removed = new Set<string>(); let changed = false;
    const invite = runtime.state.data.pendingInvite;
    if (invite && runtime.dispatch.inviteExpiresAt <= now) { runtime.state.data.pendingInvite = undefined; changed = true; void runtime.storage.removeIfValue('pending-invite', invite).catch(() => {}); }
    for (const [team, draft] of Object.entries(runtime.state.drafts)) if (draft.updatedAt + 7 * DAY <= now) { delete runtime.state.drafts[team]; changed = true; }
    for (const [id, packet] of runtime.sending.outgoing) if (packet.createdAt + DAY <= now && !runtime.sending.inFlight.has(id)) { runtime.sending.outgoing.delete(id); removed.add(id); }
    const shortened = new Set<Message>();
    for (const message of runtime.state.data.messages) {
      const expiresAt = this.expiresAt(message, this.eventTimes.get(message.id) ?? message.timestamp);
      if (message.expiresAt !== expiresAt) { message.expiresAt = expiresAt; shortened.add(message); changed = true; }
      if (expiresAt <= now) removed.add(message.id);
    }
    // All original deadlines are current before resolving replies, regardless of order.
    const messagesByTeam = new Map<string, Map<string, Message>>();
    for (const message of runtime.state.data.messages) {
      let messages = messagesByTeam.get(message.teamId);
      if (!messages) { messages = new Map(); messagesByTeam.set(message.teamId, messages); }
      if (!messages.has(message.id)) messages.set(message.id, message);
    }
    for (const message of runtime.state.data.messages) {
      const original = message.replyTo === undefined ? undefined : messagesByTeam.get(message.teamId)?.get(message.replyTo);
      if (original && message.replyToExpiresAt !== original.expiresAt) { message.replyToExpiresAt = original.expiresAt; shortened.add(message); changed = true; }
    }
    for (const [id, edit] of runtime.timeline.edits) {
      edit.expiresAt = messageExpiry(edit.expiresAt, edit.timestamp, runtime.state.remoteTeams.find(t => t.id === edit.teamId)?.retentionDays);
      if (removed.has(id) || edit.expiresAt <= now) runtime.timeline.edits.delete(id);
    }
    for (const id of removed) { this.eventTimes.delete(id); runtime.timeline.edits.delete(id); if (!runtime.sending.inFlight.has(id)) runtime.sending.outgoing.delete(id); }
    if (removed.size) { runtime.state.data.messages = runtime.state.data.messages.filter(message => !removed.has(message.id)); this.pruneMedia(); changed = true; }
    const itemExpiries = new Map(runtime.interactions.stickyRecords.map(item => [item.id, item.expiresAt]));
    const retainedStickies = runtime.interactions.stickyRecords.filter(item => {
      const expiresAt = messageExpiry(item.expiresAt, item.timestamp, runtime.state.remoteTeams.find(team => team.id === item.teamId)?.retentionDays);
      if (item.expiresAt !== expiresAt) { item.expiresAt = expiresAt; changed = true; }
      return item.expiresAt > now && readable(item.teamId);
    });
    const removedStickies = runtime.interactions.stickyRecords.filter(item => !retainedStickies.includes(item));
    runtime.interactions.stickyRecords = retainedStickies;
    if (removedStickies.length) {
      changed = true;
      if (session) for (const item of removedStickies) if (!runtime.interactions.stickyRecords.some(current => current.id === item.id)) await scope.wait(runtime.storage.remove(`${session.account.id}:cache:item:${item.id}`));
    }
    runtime.interactions.refreshStickies();
    if (runtime.state.pokes) { const pokes = runtime.state.pokes.filter(poke => poke.at + POKE_DISPLAY > now); if (pokes.length !== runtime.state.pokes.length) { runtime.state.pokes = pokes; changed = true; } }

    if (this.pruneViews()) changed = true;
    if (changed) runtime.emit();
    if (session) {
      await scope.wait(Promise.all([...removed].flatMap(id => [`${session.account.id}:cache:${id}`, `${session.account.id}:cache:media:event:${id}`, `${session.account.id}:notified:${id}`, `${session.account.id}:outgoing:${id}`]).map(key => runtime.storage.remove(key))));
      for (const message of shortened) {
        if (runtime.auth.session !== session) return;
        if (removed.has(message.id)) continue;
        const timestamp = this.eventTimes.get(message.id);
        if (timestamp === undefined || !await scope.wait(runtime.storage.get(`${session.account.id}:cache:${message.id}`))) continue;
        await scope.wait(this.cacheMessage(message, timestamp));
        const media = await scope.wait(runtime.storage.get<Blob>(`${session.account.id}:cache:media:event:${message.id}`));
        if (runtime.auth.session !== session) return;
        if (media instanceof Blob) {
          const evicted = await scope.wait(runtime.storage.cache(session.account.id, `media:event:${message.id}`, media, this.expiresAt(message)));
          if (runtime.auth.session !== session) return;
          this.evictCachedContent(evicted);
        }
      }
      for (const item of runtime.interactions.stickyRecords) {
        if (itemExpiries.get(item.id) === item.expiresAt) continue;
        // Maintenance only shortens records that remain in the cache.
        if (!await scope.wait(runtime.storage.get(`${session.account.id}:cache:item:${item.id}`))) continue;
        const evicted = await scope.wait(runtime.storage.cache(session.account.id, `item:${item.id}`, { kind: 'stickies', item }, item.expiresAt));
        this.evictCachedContent(evicted);
      }
    }
    if (now - this.lastCleanup >= 60_000) { this.lastCleanup = now; await scope.wait(runtime.storage.cleanup(now).catch(() => { if (scope.current()) this.lastCleanup = 0; })); }
  }
  async avatar(id: string | null) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!id || !session) return undefined;
    const key = `avatar:${id}`; const cached = this.mediaUrls.get(key); if (cached) return cached;
    try {
      // Profiles follow current access and updates; keep only a temporary displayed copy.
      const blob = new Blob([await scope.wait(runtime.api.media(id))]); if (runtime.auth.session !== session) return undefined;
      const existing = this.mediaUrls.get(key); if (existing) return existing;
      const url = URL.createObjectURL(blob); this.mediaUrls.set(key, url); return url;
    } catch { scope.check(); return undefined; }
  }
  async cachedMedia(id: string, load: () => Promise<Blob>, expiresAt: () => number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    if (expiresAt() <= Date.now()) throw new MessageError(uiMessage('extension.runtime.contentExpired'));
    if (this.mediaUrls.has(id)) return this.mediaUrls.get(id)!;
    let blob = await scope.wait(runtime.storage.get<Blob>(`${session.account.id}:cache:media:${id}`));
    if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.accountChanged'));
    if (expiresAt() <= Date.now()) throw new MessageError(uiMessage('extension.runtime.contentExpired'));
    if (!(blob instanceof Blob)) {
      blob = await scope.wait(load()); if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.accountChanged'));
      if (expiresAt() <= Date.now()) throw new MessageError(uiMessage('extension.runtime.contentExpired'));
      const evicted = await scope.wait(runtime.storage.cache(session.account.id, `media:${id}`, blob, expiresAt()));
      if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.accountChanged')); this.evictCachedContent(evicted);
    }
    if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.accountChanged'));
    if (expiresAt() <= Date.now()) {
      const key = `${session.account.id}:cache:media:${id}`;
      await scope.wait(runtime.storage.remove(key)); this.evictCachedContent([key]);
      throw new MessageError(uiMessage('extension.runtime.contentExpired'));
    }
    const existing = this.mediaUrls.get(id); if (existing) return existing;
    const url = URL.createObjectURL(blob); this.mediaUrls.set(id, url); return url;
  }
  evictCachedContent(keys: string[]) {
    const runtime = this.runtime;
    if (!runtime.auth.session || !keys.length) return;
    const prefix = `${runtime.auth.session.account.id}:cache:`; const events = new Set<string>(); const urls = new Set<string>();
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (id.startsWith('media:')) { const mediaId = id.slice(6); const url = this.mediaUrls.get(mediaId); if (url) { URL.revokeObjectURL(url); urls.add(url); this.mediaUrls.delete(mediaId); } }
      else if (!id.startsWith('item:') && id !== 'directory') events.add(id);
    }
    for (const id of events) {
      this.eventTimes.delete(id); runtime.timeline.edits.delete(id);
      const url = this.mediaUrls.get(`event:${id}`);
      if (url) { URL.revokeObjectURL(url); urls.add(url); this.mediaUrls.delete(`event:${id}`); }
    }
    for (const message of runtime.state.data.messages) if (events.has(message.id)) { runtime.state.history ??= {}; runtime.state.history[message.teamId] = { ...runtime.state.history[message.teamId], missingKeys: runtime.timeline.missingEvents.get(message.teamId)?.size ?? 0, loaded: false, loading: false }; }
    runtime.state.data.messages = runtime.state.data.messages.filter(message => !events.has(message.id)).map(message => message.attachment?.kind === 'image' && urls.has(message.attachment.src) ? { ...message, attachment: { ...message.attachment, src: '' } } : message);
    runtime.state.data.people = runtime.state.data.people.map(person => urls.has(person.avatar ?? '') ? { ...person, avatar: undefined } : person);
    runtime.state.data.teams = runtime.state.data.teams.map(team => urls.has(team.avatar ?? '') ? { ...team, avatar: undefined } : team);
    runtime.state.lobbyTeams = runtime.state.lobbyTeams?.map(team => ({ ...team, ...(urls.has(team.avatar ?? '') ? { avatar: undefined } : {}), ...(urls.has(team.ownerAvatar ?? '') ? { ownerAvatar: undefined } : {}) }));
    runtime.emit();
  }
  pruneMedia() {
    const runtime = this.runtime;
    const used = new Set([...runtime.state.data.people.map(p => p.avatar), ...runtime.state.data.teams.map(t => t.avatar), ...(runtime.state.lobbyTeams ?? []).flatMap(t => [t.avatar, t.ownerAvatar]), ...runtime.state.data.messages.map(m => m.attachment?.kind === 'image' ? m.attachment.src : undefined)]);
    for (const [id, url] of this.mediaUrls) if (!used.has(url)) { URL.revokeObjectURL(url); this.mediaUrls.delete(id); }
  }
  upsertView(view: Viewing) {
    const runtime = this.runtime;
    if (view.kind === 'asset' && view.address && !tokenName(view.name)) view = { ...view, name: resolveTokenMetadata({ address: view.address }).name! };
    const index = runtime.state.data.views.findIndex(v => v.id === view.id);
    if (index < 0) runtime.state.data.views = [...runtime.state.data.views, view];
    else runtime.state.data.views = runtime.state.data.views.map(v => v.id === view.id ? view : v); }
  pruneViews() {
    const runtime = this.runtime;
    for (const [id, expires] of this.preparedViews) if (expires <= Date.now()) this.preparedViews.delete(id);
    const views = retainedViews(runtime.state.data.views, runtime.state.data.messages, Object.values(runtime.state.drafts).map(draft => draft.value), [runtime.sharing.page?.id, runtime.sharing.ownViewing?.view.id, ...[...runtime.sharing.peerViewing.values()].map(entry => entry.view.id), ...this.preparedViews.keys()]);
    if (views.length === runtime.state.data.views.length) return false;
    runtime.state.data.views = views; return true;
  }
  private messagePage?: { session: RuntimeDevice; entries: (CacheEntry & { value: { message: Message; timestamp: number; views: Viewing[] }; roomId: string })[] };
  async cachePage(work: () => Promise<void>) {
    const runtime = this.runtime, scope = runtime.auth.scope(), session = runtime.auth.session;
    if (!session) return;
    const page: NonNullable<typeof this.messagePage> = { session, entries: [] }; this.messagePage = page;
    try { await work(); }
    finally {
      if (this.messagePage === page) this.messagePage = undefined;
      if (scope.current() && runtime.auth.session === session && page.entries.length) {
        const entries = page.entries.filter(entry => {
          entry.expiresAt = entry.value.message.expiresAt = this.expiresAt(entry.value.message, entry.value.timestamp);
          return this.readableTeam(entry.value.message.teamId, entry.value.timestamp, entry.roomId) && entry.expiresAt > Date.now();
        });
        if (entries.length) {
          const evicted = await scope.wait(runtime.storage.cacheMany(session.account.id, entries.map(({ id, value, expiresAt }) => ({ id, value, expiresAt }))));
          this.evictCachedContent(evicted);
        }
        for (const entry of entries) {
          if (!this.readableTeam(entry.value.message.teamId, entry.value.timestamp, entry.roomId) || this.expiresAt(entry.value.message, entry.value.timestamp) <= Date.now()) {
            const keys = [`${session.account.id}:cache:${entry.id}`, `${session.account.id}:cache:media:event:${entry.id}`];
            await scope.wait(Promise.all(keys.map(key => runtime.storage.remove(key)))); this.evictCachedContent(keys); this.pruneViews();
          }
        }
      }
    }
  }
  async cacheMessage(message: Message, timestamp: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; if (!session) return;
    message.timestamp = timestamp;
    message.expiresAt = this.expiresAt(message, timestamp);
    const original = message.replyTo ? runtime.state.data.messages.find(item => item.id === message.replyTo && item.teamId === message.teamId) : undefined;
    const originalTime = original ? this.eventTimes.get(original.id) : undefined;
    if (originalTime !== undefined) message.replyToExpiresAt = this.expiresAt(original!, originalTime);
    const items = [{ message, timestamp }];
    // Older originals can arrive after their replies. Remember only their local
    // deadline, never a copied original body, and keep each reply's own lifetime.
    for (const reply of runtime.state.data.messages) {
      const replyTime = this.eventTimes.get(reply.id);
      if (reply.teamId === message.teamId && reply.replyTo === message.id && reply.replyToExpiresAt !== message.expiresAt && replyTime !== undefined) {
        reply.replyToExpiresAt = message.expiresAt; items.push({ message: reply, timestamp: replyTime });
      }
    }
    for (const item of items) {
      if (runtime.auth.session !== session) return;
      const value = item.message;
      const team = this.readableTeam(value.teamId, item.timestamp);
      if (!team || this.expiresAt(value, item.timestamp) <= Date.now()) continue;
      // Blob URLs are runtime-only. The separate Blob record shares this cache budget.
      const cached = { ...value, ...(value.attachment?.kind === 'image' ? { attachment: { ...value.attachment, src: '' } } : {}) };
      delete cached.liveArrival;
      const entry = { id: value.id, value: { message: cached, timestamp: item.timestamp, views: runtime.state.data.views.filter(v => value.attachment?.kind === 'asset' && v.id === value.attachment.assetId || !value.recalled && v.id === value.ref?.view.id) }, expiresAt: this.expiresAt(value, item.timestamp) };
      if (this.messagePage?.session === session) { this.messagePage.entries.push({ ...entry, roomId: team.roomId }); continue; }
      const evicted = await scope.wait(runtime.storage.cache(session.account.id, entry.id, entry.value, entry.expiresAt));
      if (runtime.auth.session !== session) return;
      this.evictCachedContent(evicted);
      if (!this.readableTeam(value.teamId, item.timestamp, team.roomId) || this.expiresAt(value, item.timestamp) <= Date.now()) {
        const keys = [`${session.account.id}:cache:${entry.id}`, `${session.account.id}:cache:media:event:${entry.id}`];
        await scope.wait(Promise.all(keys.map(key => runtime.storage.remove(key)))); this.evictCachedContent(keys); this.pruneViews();
      }
    }
  }
}
