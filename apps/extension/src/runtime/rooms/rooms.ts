import { graphemeLength } from '@palside/shared/contracts/rules';
import type { EndpointId } from '@palside/shared/contracts/endpoints';
import type { ApiOptions,ApiResult } from '../transport/api';
import { isRoomKey,roomKeyForAsset,stances } from '@palside/shared/contracts/rules';
import { ROOM_HOT_REFRESH_MS,ROOM_MESSAGE_LIMIT,ROOM_PAGE_SIZE,ROOM_RENEW_MS,ROOM_TEXT_MAX } from '@palside/shared/contracts/limits';
import type { RoomEvent,RoomMessage,RoomPerson,RoomProfileInput,RoomStance,Stance,StanceCounts } from './contract-types';
import { ApiError } from '../transport/api';
import { commandError } from '../composition/commands';
import type { PalsideService } from '../composition/core';

const SUMMARY_LIMIT = 64, RESULT_TTL = 10 * 60_000;

const emptyRooms = () => ({ summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} });
const emptyStance = (): RoomStance => ({ bull: 0, hold: 0, bear: 0, mine: null });

/** A device follows the pinned token, otherwise its host's active tab. Only leases renew. */
export class RoomService {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  private panels = false;
  private tab?: string;
  private tabProfile?: RoomProfileInput;
  private pinnedProfile?: RoomProfileInput;
  private epoch = 0;
  private version = 0;
  private reads = 0;
  private summaryReads = new Map<string, object>();
  private summaryAccess = new Map<string, number>();
  private watches = new Map<string, string>();
  private peopleAt = 0;
  private hotAt = new Map<string, number>();
  private hotReads = new Map<string, object>();
  private hotSources = new Map<string, string | null>();
  private hotPolls = new Map<string | null, ReturnType<typeof setInterval>>();
  private hotWork = new Map<string | null, Promise<unknown>>();
  private peopleRead = 0;
  private invitesRead = 0;
  private blocksVersion = 0;
  private blocksRead = 0;
  private avatarVersion = 0;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  private snapshotWork?: Promise<unknown>;
  private blocksQueue: Promise<unknown> = Promise.resolve();
  private stanceQueues = new Map<string, Promise<unknown>>();
  private stanceVersions = new Map<string, number>();
  private remoteLease = false;
  private messages = new Map<string, RoomMessage>();
  private retracted = new Set<string>();
  private folded = new Set<string>();
  private cursor?: string;
  private updates: (() => void)[] = [];
  private avatarOnline = true;
  private avatarUrls = new Map<string, string>();
  private avatarLoads = new Map<string, Promise<void>>();
  /** `until`: next attempt; `server`: a deadline the service set with Retry-After, kept across reconnects. */
  private avatarFailures = new Map<string, { until: number; server?: number; current: () => boolean; token?: string }>();
  /** Unresolved text identifies a logical send within its account and room, independently of the view. */
  private pendingSends = new Map<string, { account: string; key: string; id: string; unknown: boolean; sending?: Promise<unknown> }>();
  private paging?: Promise<ApiResult<'rooms.messages'>>;
  private enabled() { return Boolean(this.runtime.auth.session && !this.runtime.state.preferences.rooms?.off); }
  private scope() {
    const runtime = this.runtime, scope = runtime.auth.scope(), epoch = this.epoch, session = runtime.auth.session;
    const current = () => scope.current() && epoch === this.epoch && session === runtime.auth.session;
    const check = () => { if (!current()) throw commandError('ACCOUNT_CHANGED', 'extension.runtime.accountChanged'); };
    return { current, check, async wait<T>(work: Promise<T>): Promise<T> { try { const value = await work; check(); return value; } catch (error) { check(); throw error; } } };
  }
  private requireAccount() { if (!this.runtime.auth.session) throw commandError('AUTH_REQUIRED', 'extension.runtime.signInFirst'); }
  private requireEnabled() { this.requireAccount(); if (!this.enabled()) throw commandError('ROOM_OFF', 'common.error'); }
  private key(value: unknown) { if (!isRoomKey(value)) throw commandError('INVALID_INPUT', 'common.error'); return value; }
  private id(value: unknown) { if (typeof value !== 'string' || !value) throw commandError('INVALID_INPUT', 'common.error'); return value; }
  private profile(value: unknown): RoomProfileInput | undefined {
    if (value === undefined) return;
    const input = value as RoomProfileInput;
    if (!input || typeof input.name !== 'string' || typeof input.site !== 'string' || input.logo !== undefined && typeof input.logo !== 'string') throw commandError('INVALID_INPUT', 'common.error');
    return { name: input.name, site: input.site, ...(input.logo === undefined ? {} : { logo: input.logo }) };
  }
  private requireRoom() {
    this.requireEnabled(); const room = this.runtime.state.rooms.current;
    if (!room || room.loading || !this.panels || room.key !== this.runtime.state.rooms.leased) throw commandError('ROOM_NOT_LEASED', 'common.error');
    return room;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => {}).then(work); this.queue = next; return next; }
  private stop() { clearTimeout(this.leaseTimer); this.leaseTimer = undefined; }
  private clearCurrent() {
    this.version++; this.messages.clear(); this.retracted.clear(); this.folded.clear(); this.updates = []; this.cursor = undefined;
    this.paging = undefined; this.snapshotWork = undefined;
    this.runtime.state.rooms.current = undefined; this.runtime.state.rooms.leased = undefined;
  }
  reset() {
    const token = this.runtime.auth.session?.token;
    if (token && this.remoteLease) void this.serial(() => this.runtime.api.request('rooms.lease', { body: { key: null }, token })).catch(() => {});
    this.dropHot('');
    this.hotReads.clear(); this.hotAt.clear();
    this.stop(); this.epoch++; this.reads++; this.clearCurrent(); this.panels = false; this.tab = undefined; this.tabProfile = undefined; this.pinnedProfile = undefined; this.remoteLease = false;
    this.blocksQueue = Promise.resolve(); this.stanceQueues.clear(); this.stanceVersions.clear(); this.summaryReads.clear(); this.summaryAccess.clear(); this.watches.clear(); this.clearAvatars(); this.runtime.state.rooms = emptyRooms();
  }
  private clearAvatars() {
    this.avatarVersion++; for (const url of this.avatarUrls.values()) URL.revokeObjectURL(url);
    this.avatarUrls.clear(); this.avatarLoads.clear(); this.avatarFailures.clear(); this.runtime.state.rooms.avatars = {};
  }
  async start() {
    if (!this.runtime.auth.session) return;
    const scope = this.scope(); this.runtime.state.rooms.acceptInvites = this.runtime.state.account?.acceptTeamInvites ?? this.runtime.auth.session.account.acceptTeamInvites ?? true;
    await this.sync().catch(() => {}); scope.check(); this.runtime.emit();
  }
  panelChanged(connected: boolean) { this.panels = connected; if (!connected) this.dropHot(''); return this.sync().then(() => ({ connected })); }
  tabChanged(input: { asset?: unknown; profile?: unknown }) {
    const key = input.asset === null ? undefined : typeof input.asset === 'string' ? roomKeyForAsset(input.asset) : null;
    if (key === null) throw commandError('INVALID_INPUT', 'common.error');
    const profile = this.profile(input.profile); this.tab = key; this.tabProfile = profile; return this.sync();
  }
  open(input: { key?: unknown; profile?: unknown }) {
    this.requireEnabled(); const key = this.key(input.key), profile = this.profile(input.profile);
    this.runtime.state.rooms.pinned = key; this.pinnedProfile = profile; return this.sync();
  }
  close() { this.runtime.state.rooms.pinned = undefined; this.pinnedProfile = undefined; return this.sync(); }
  private target() { return this.panels && this.enabled() ? this.runtime.state.rooms.pinned ?? this.tab : undefined; }
  private sync(refresh = false): Promise<unknown> {
    const key = this.target(), state = this.runtime.state.rooms, same = key && state.current?.key === key;
    if (same && (!refresh || state.current?.loading)) { this.runtime.emit(); return this.snapshotWork ?? this.queue; }
    this.stop();
    if (!same) {
      this.clearCurrent();
      if (key) state.current = { key, profile: null, count: 0, stance: emptyStance(), faces: [], messages: [], hasMore: false, loading: true, slowUntil: 0 };
    } else { state.current!.loading = true; this.updates = []; }
    const room = state.current, scope = this.scope(), version = this.version, token = this.runtime.auth.session?.token;
    this.runtime.emit();
    const work = (async () => {
      try {
        const acquired = await this.serial(async () => {
          scope.check(); if (version !== this.version) return false;
          if (!key) {
            if (this.remoteLease && token) { await scope.wait(this.runtime.api.request('rooms.lease', { body: { key: null }, token })); this.remoteLease = false; }
            return false;
          }
          this.remoteLease = true;
          const profile = state.pinned ? this.pinnedProfile : this.tabProfile;
          const lease = await scope.wait(this.runtime.api.request('rooms.lease', { body: { key, ...(profile ? { profile } : {}) }, token }));
          if (version !== this.version) return false;
          state.leased = key; room!.slowUntil = Math.max(room!.slowUntil, lease.slowUntil);
          // Snapshot reads must never delay lease renewal or release.
          this.scheduleLease(); return true;
        });
        if (!acquired || !key || version !== this.version) return;
        const [summary, page] = await scope.wait(Promise.all([
          this.runtime.api.request('rooms.summary', { query: { key } }),
          this.runtime.api.request('rooms.messages', { query: { key } }),
        ]));
        if (version !== this.version) return;
        this.messages = new Map(); for (const message of page.messages) this.append(message);
        this.cursor = page.messages[0]?.id; Object.assign(room!, summary, { hasMore: page.hasMore, loading: false });
        const updates = this.updates; this.updates = []; for (const update of updates) update();
        state.summaries[key] = { key, profile: room!.profile, count: room!.count, stance: room!.stance, faces: room!.faces, at: Date.now() };
        this.retryAvatars(); this.runtime.emit();
      } catch (error) {
        if (scope.current() && version === this.version) { this.clearCurrent(); this.scheduleLease(); this.runtime.emit(); }
        throw error;
      }
    })();
    this.snapshotWork = work; void work.finally(() => { if (this.snapshotWork === work) this.snapshotWork = undefined; }).catch(() => {}); return work;
  }
  private scheduleLease() {
    this.stop(); if (!this.target()) return;
    this.leaseTimer = setTimeout(() => { void this.renew().catch(() => {}); }, ROOM_RENEW_MS);
  }
  private async renew() {
    const key = this.target(); if (!key) return;
    if (this.runtime.state.rooms.current?.key !== key) return this.sync();
    const scope = this.scope(), version = this.version;
    try {
      await this.serial(async () => {
        scope.check(); if (version !== this.version || this.target() !== key) return;
        const profile = this.runtime.state.rooms.pinned ? this.pinnedProfile : this.tabProfile;
        const result = await scope.wait(this.runtime.api.request('rooms.lease', { body: { key, ...(profile ? { profile } : {}) } }));
        if (version === this.version) { this.update(() => { this.applyCount(key, result.count); const room = this.runtime.state.rooms.current; if (room) room.slowUntil = Math.max(room.slowUntil, result.slowUntil); }); this.runtime.emit(); }
      });
    } finally { if (scope.current() && version === this.version) this.scheduleLease(); }
  }
  reconnected() {
    if (!this.runtime.auth.session) return;
    this.retryAvatars(); this.prune();
    if (!this.panels || !this.enabled()) return;
    void this.sync(true).catch(() => {});
  }
  send(input: unknown): Promise<unknown> {
    const room = this.requireRoom(), scope = this.scope(), version = this.version;
    if (typeof input !== 'string' || !input.trim() || graphemeLength(input.trim()) > ROOM_TEXT_MAX) throw commandError('INVALID_INPUT', 'common.error');
    const text = input.trim(), session = this.runtime.auth.session!, account = session.account.id, logical = JSON.stringify([account, room.key, text]);
    const pending = this.pendingSends.get(logical) ?? { account, key: room.key, id: crypto.randomUUID(), unknown: false, sending: undefined };
    if (pending.sending) return pending.sending;
    if ([...this.pendingSends.values()].some(send => send.account === account && send.key === room.key && send.sending)) throw commandError('ROOM_BUSY', 'common.error');
    this.pendingSends.set(logical, pending);
    const work = (async () => {
      try {
        const result = await this.runtime.api.request('rooms.send', { body: { key: room.key, text }, key: pending.id, token: session.token });
        this.pendingSends.delete(logical); scope.check();
        if (version === this.version) { this.update(() => { this.append(result.message); room.slowUntil = Math.max(room.slowUntil, result.slowUntil); }); this.runtime.emit(); }
        return result;
      } catch (error) {
        const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && !['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(error.code);
        // These send rejections follow the server's original-operation lookup; an auth or lease rejection does not.
        const resolved = error instanceof ApiError && ['ROOM_SLOW', 'TEXT_NOT_ALLOWED', 'ROOM_MESSAGE_NOT_FOUND'].includes(error.code);
        if (resolved || rejected && !pending.unknown) this.pendingSends.delete(logical);
        else pending.unknown = true;
        scope.check();
        if (error instanceof ApiError && error.code === 'ROOM_SLOW') {
          const retryAfterMs = error.retryAfterMs ?? 0;
          if (version === this.version) { const until = Date.now() + retryAfterMs; this.update(() => { room.slowUntil = Math.max(room.slowUntil, until); }); this.runtime.emit(); }
          throw Object.assign(commandError(error.code, 'extension.room.slow', { seconds: Math.ceil(retryAfterMs / 1000) }), { retryAfterMs });
        }
        throw error;
      }
    })();
    pending.sending = work; void work.finally(() => { if (pending.sending === work) pending.sending = undefined; }).catch(() => {}); return work;
  }
  more(): Promise<ApiResult<'rooms.messages'>> {
    if (this.paging) return this.paging;
    const room = this.requireRoom(), scope = this.scope(), version = this.version;
    if (!room.hasMore || !this.cursor) return Promise.resolve({ messages: [], hasMore: room.hasMore });
    const work = (async () => {
      const result = await scope.wait(this.runtime.api.request('rooms.messages', { query: { key: room.key, before: this.cursor } }));
      if (version === this.version) { this.update(() => { for (const message of result.messages) this.append(message); this.cursor = result.messages[0]?.id ?? this.cursor; room.hasMore = result.hasMore; }); this.runtime.emit(); } return result;
    })();
    this.paging = work; void work.finally(() => { if (this.paging === work) this.paging = undefined; }).catch(() => {}); return work;
  }
  /** Search only this room's retained pool; account and room changes cancel the lookup. */
  async find(roomKey: unknown, input: unknown) {
    const room = this.requireRoom(), key = this.key(roomKey), id = this.id(input), scope = this.scope(), version = this.version;
    const current = () => version === this.version && room.key === key && this.enabled();
    const found = () => Boolean(this.messages.has(id) && !this.runtime.state.rooms.blocked.some(person => person.id === this.messages.get(id)?.author.id));
    let scanned = this.messages.size;
    for (let page = 0; current(); page++) {
      scope.check();
      if (found()) return { found: true };
      if (!room.hasMore || !this.cursor || scanned >= ROOM_MESSAGE_LIMIT || page >= Math.ceil(ROOM_MESSAGE_LIMIT / ROOM_PAGE_SIZE)) break;
      const before = this.cursor;
      let result: ApiResult<'rooms.messages'>;
      try { result = await scope.wait(this.more()); }
      catch (error) {
        if (error instanceof ApiError && error.code === 'ROOM_MESSAGE_NOT_FOUND') return { found: false };
        throw error;
      }
      if (!current()) break;
      scanned += result.messages.length;
      if (!result.messages.length || before === this.cursor) break;
    }
    return { found: current() && found() };
  }
  async retract(input: unknown) {
    const room = this.requireRoom(), id = this.id(input), scope = this.scope(), version = this.version;
    const result = await scope.wait(this.runtime.api.request('rooms.retract', { body: { key: room.key, id } }));
    if (version === this.version) { this.update(() => this.applyEvent({ key: room.key, type: 'retract', id })); this.runtime.emit(); } return result;
  }
  async report(input: unknown) {
    const room = this.requireRoom(), id = this.id(input), scope = this.scope(), version = this.version;
    const result = await scope.wait(this.runtime.api.request('rooms.report', { body: { key: room.key, id } }));
    if (version === this.version) { this.update(() => { const message = this.messages.get(id); if (result.folded) this.folded.add(id); if (message) this.messages.set(id, { ...message, reported: true, folded: message.folded || result.folded }); }); this.runtime.emit(); } return result;
  }
  private hotRows() { return Object.values(this.runtime.state.rooms.hot ?? {}).flatMap(hot => [...hot.top, ...hot.rising]); }
  private applyStance(key: string, counts: StanceCounts, mine?: Stance | null) {
    const state = this.runtime.state.rooms;
    for (const row of [state.current, state.summaries[key]]) if (row?.key === key) row.stance = { ...counts, mine: mine === undefined ? row.stance.mine : mine };
    for (const row of this.hotRows()) if (row.key === key) row.stance = { bull: counts.bull, hold: counts.hold, bear: counts.bear };
  }
  stance(input: unknown, value: unknown): Promise<RoomStance> {
    this.requireEnabled(); const key = this.key(input);
    if (value !== null && (typeof value !== 'string' || !stances.some(stance => stance === value))) throw commandError('INVALID_INPUT', 'common.error');
    const scope = this.scope(), reads = this.reads;
    const work = (this.stanceQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      scope.check(); this.requireEnabled();
      if (reads !== this.reads) throw commandError('ROOM_OFF', 'common.error');
      const state = this.runtime.state.rooms;
      const row = state.current?.key === key && !state.current.loading ? state.current : state.summaries[key] ?? await this.summary(key);
      scope.check(); this.requireEnabled(); if (reads !== this.reads) throw commandError('ROOM_OFF', 'common.error');
      const previous = { ...row.stance }, next = { ...previous, mine: value as Stance | null };
      if (previous.mine) next[previous.mine] = Math.max(0, next[previous.mine] - 1);
      if (next.mine) next[next.mine]++;
      const version = (this.stanceVersions.get(key) ?? 0) + 1; this.stanceVersions.set(key, version);
      this.applyStance(key, next, next.mine); this.runtime.emit();
      try {
        const result = await scope.wait(this.runtime.api.request('rooms.stance', { body: { key, value } }));
        if (reads === this.reads) { this.update(() => { const counts = this.stanceVersions.get(key) === version ? result : state.summaries[key]?.stance ?? result; this.applyStance(key, counts, result.mine); }); this.runtime.emit(); } return result;
      } catch (error) {
        if (scope.current() && reads === this.reads) { const counts = this.stanceVersions.get(key) === version ? previous : state.summaries[key]?.stance ?? previous; this.applyStance(key, counts, previous.mine); this.runtime.emit(); }
        throw error;
      }
    });
    this.stanceQueues.set(key, work); void work.finally(() => { if (this.stanceQueues.get(key) === work) this.stanceQueues.delete(key); }).catch(() => {}); return work;
  }
  private pendingReads = new Map<string, { current: () => boolean; promise: Promise<unknown> }>();
  private read<I extends EndpointId>(endpoint: I, options: ApiOptions<I> = {}, version: number | string = 0): Promise<ApiResult<I>> {
    const key = `${this.reads}:${version}:${endpoint}:${JSON.stringify(options)}`, pending = this.pendingReads.get(key);
    if (pending?.current()) return pending.promise as Promise<ApiResult<I>>;
    const scope = this.scope(), promise = this.runtime.api.request(endpoint, options);
    const entry = { current: scope.current, promise }; this.pendingReads.set(key, entry);
    void promise.finally(() => { if (this.pendingReads.get(key) === entry) this.pendingReads.delete(key); }).catch(() => {});
    return promise;
  }
  private sameRead(previous: unknown, next: unknown) { return JSON.stringify(previous) === JSON.stringify(next); }
  watch(source: string, watch?: string) {
    if (watch) { this.watches.set(source, watch); this.touchSummary(watch); }
    else this.watches.delete(source);
    this.runtime.emit();
  }
  dropPanel(panel: string) {
    this.dropHot(`${panel}:`);
    for (const source of this.watches.keys()) if (source.startsWith(`${panel}:`)) this.watches.delete(source);
    this.runtime.emit();
  }
  private touchSummary(key: string) { this.summaryAccess.delete(key); this.summaryAccess.set(key, Date.now()); }
  async summary(input: unknown) {
    this.requireEnabled(); const key = this.key(input), scope = this.scope(), reads = this.reads, stanceVersion = this.stanceVersions.get(key), read = {};
    this.summaryReads.set(key, read);
    try {
      const result = await scope.wait(this.read('rooms.summary', { query: { key } }, stanceVersion));
      if (reads === this.reads && read === this.summaryReads.get(key) && this.enabled()) {
        this.touchSummary(key);
        const previous = this.runtime.state.rooms.summaries[key];
        const next = { ...result, ...(previous && stanceVersion !== this.stanceVersions.get(key) ? { stance: previous.stance } : {}), at: previous?.at ?? Date.now() };
        if (!this.sameRead(previous, next)) { this.runtime.state.rooms.summaries[key] = { ...next, at: Date.now() }; this.runtime.emit(); }
      }
      return result;
    } finally { if (this.summaryReads.get(key) === read) this.summaryReads.delete(key); }
  }
  async people(input: unknown) {
    this.requireEnabled(); const key = this.key(input), scope = this.scope(), reads = this.reads, version = ++this.peopleRead;
    const result = await scope.wait(this.read('rooms.people', { query: { key } }));
    if (reads === this.reads && version === this.peopleRead && this.enabled()) this.peopleAt = Date.now();
    if (reads === this.reads && version === this.peopleRead && this.enabled() && !this.sameRead(this.runtime.state.rooms.people, { key, ...result })) { this.runtime.state.rooms.people = { key, ...result }; this.runtime.emit(); } return result;
  }
  async watchHot(input: { sourceId?: unknown; chain?: unknown }) {
    const source = this.id(input.sourceId), chain = input.chain;
    if (chain !== undefined && chain !== null && (typeof chain !== 'string' || !/^[A-Za-z ]{2,24}$/.test(chain))) throw commandError('INVALID_INPUT', 'common.error');
    if (chain === undefined) this.hotSources.delete(source);
    else { this.requireEnabled(); this.hotSources.set(source, chain); }
    this.pollHot(); this.runtime.emit();
    if (chain !== undefined) await (this.hotWork.get(chain as string | null) ?? this.readHot(chain as string | null));
  }
  dropHot(prefix: string) {
    for (const source of this.hotSources.keys()) if (source.startsWith(prefix)) this.hotSources.delete(source);
    this.pollHot();
  }
  private pollHot() {
    const chains = new Set(this.hotSources.values());
    for (const [chain, timer] of this.hotPolls) if (!chains.has(chain) || !this.enabled()) { clearInterval(timer); this.hotPolls.delete(chain); this.hotWork.delete(chain); }
    if (!this.enabled()) return;
    for (const chain of chains) if (!this.hotPolls.has(chain)) {
      const read = () => { void this.hot(chain ?? undefined).catch(() => {}); };
      this.hotPolls.set(chain, setInterval(read, ROOM_HOT_REFRESH_MS)); void this.readHot(chain);
    }
  }
  private readHot(chain: string | null) {
    const work = this.hot(chain ?? undefined);
    this.hotWork.set(chain, work);
    void work.catch(() => { if (this.hotWork.get(chain) === work) this.hotWork.delete(chain); });
    return work;
  }
  async hot(chain?: unknown) {
    this.requireEnabled(); if (chain !== undefined && (typeof chain !== 'string' || !/^[A-Za-z ]{2,24}$/.test(chain))) throw commandError('INVALID_INPUT', 'common.error');
    const filter = (chain as string | undefined) ?? '', scope = this.scope(), reads = this.reads, read = {}, stances = new Map(this.stanceVersions);
    this.hotReads.set(filter, read);
    try {
      const result = await scope.wait(this.read('rooms.hot', { query: { chain: chain as string | undefined } }, JSON.stringify([...stances])));
      if (reads === this.reads && this.hotReads.get(filter) === read && this.enabled()) {
        this.hotAt.set(filter, Date.now());
        const previous = this.runtime.state.rooms.hot?.[filter];
        for (const row of [...result.top, ...result.rising]) if (stances.get(row.key) !== this.stanceVersions.get(row.key)) { const current = this.runtime.state.rooms.summaries[row.key]?.stance; if (current) Object.assign(row, { stance: { bull: current.bull, hold: current.hold, bear: current.bear } }); }
        const next = { ...result, at: previous?.at ?? result.at };
        if (!this.sameRead(previous, next)) { this.runtime.state.rooms.hot = { ...this.runtime.state.rooms.hot, [filter]: { ...next, at: result.at } }; this.runtime.emit(); }
      } return result;
    } finally { if (this.hotReads.get(filter) === read) this.hotReads.delete(filter); }
  }
  async blocks() {
    this.requireAccount(); const scope = this.scope(), version = this.blocksVersion, read = ++this.blocksRead;
    await scope.wait(this.blocksQueue.catch(() => {}));
    const result = await scope.wait(this.read('rooms.blocks', {}, version));
    if (version === this.blocksVersion && read === this.blocksRead && !this.sameRead(this.runtime.state.rooms.blocked, result.people)) { this.runtime.state.rooms.blocked = result.people; this.runtime.emit(); } return result;
  }
  async block(input: unknown, blocked: unknown) {
    this.requireAccount(); const accountId = this.id(input), scope = this.scope();
    if (typeof blocked !== 'boolean') throw commandError('INVALID_INPUT', 'common.error');
    const version = ++this.blocksVersion;
    const work = this.blocksQueue.catch(() => {}).then(() => { scope.check(); return this.runtime.api.request('rooms.block', { body: { accountId, blocked } }); });
    this.blocksQueue = work; const result = await scope.wait(work);
    if (version === this.blocksVersion) { this.runtime.state.rooms.blocked = result.people; this.runtime.emit(); } return result;
  }
  /** `fresh`: the inbox changed on the server, so a read already in flight may be stale. */
  async invites(fresh = false) {
    this.requireAccount(); if (fresh) this.invitesRead++; const scope = this.scope(), read = this.invitesRead;
    const result = await scope.wait(this.read('invites.list', {}, read));
    if (read === this.invitesRead && !this.sameRead(this.runtime.state.rooms.invites, result.invites)) { this.runtime.state.rooms.invites = result.invites; this.runtime.emit(); } return result;
  }
  async inviteOptions(input: unknown) { this.requireAccount(); return this.scope().wait(this.read('invites.options', { query: { accountId: this.id(input) } })); }
  async inviteSend(team: unknown, account: unknown) { this.requireAccount(); return this.scope().wait(this.runtime.dispatch.mutate('invites.send', { body: { teamId: this.id(team), accountId: this.id(account) } })); }
  async inviteAccept(input: unknown) {
    this.requireAccount(); const id = this.id(input), scope = this.scope();
    const result = await scope.wait(this.runtime.dispatch.mutate('invites.accept', { params: { id }, body: {} }));
    this.invitesRead++; this.runtime.state.rooms.invites = this.runtime.state.rooms.invites.filter(invite => invite.id !== id); this.runtime.emit();
    if (this.runtime.auth.refreshing) await scope.wait(this.runtime.auth.refreshing.catch(() => {}));
    await scope.wait(Promise.all([this.runtime.refresh(), this.invites(true)])); return result;
  }
  async inviteIgnore(input: unknown) {
    this.requireAccount(); const id = this.id(input), scope = this.scope();
    const result = await scope.wait(this.runtime.api.request('invites.ignore', { params: { id }, body: {} }));
    this.invitesRead++; this.runtime.state.rooms.invites = this.runtime.state.rooms.invites.filter(invite => invite.id !== id); this.runtime.emit(); await scope.wait(this.invites()); return result;
  }
  async inviteSettings(accept: unknown) {
    this.requireAccount(); if (typeof accept !== 'boolean') throw commandError('INVALID_INPUT', 'common.error');
    const scope = this.scope(); await scope.wait(this.runtime.api.request('accounts.update', { body: { acceptTeamInvites: accept } }));
    this.runtime.state.rooms.acceptInvites = accept;
    if (this.runtime.state.account) this.runtime.state.account = { ...this.runtime.state.account, acceptTeamInvites: accept };
    this.runtime.emit(); return { accept };
  }
  async invitePermission(team: unknown, on: unknown) {
    this.requireAccount(); const teamId = this.id(team); if (typeof on !== 'boolean') throw commandError('INVALID_INPUT', 'common.error');
    const scope = this.scope(), result = await scope.wait(this.runtime.api.request('teams.invitePermission', { params: { id: teamId }, body: { on } }));
    if (this.runtime.auth.refreshing) await scope.wait(this.runtime.auth.refreshing.catch(() => {}));
    await scope.wait(this.runtime.refresh()); return result;
  }
  async clearLocal() { this.runtime.state.rooms.summaries = {}; this.runtime.state.rooms.hot = undefined; this.runtime.state.rooms.people = undefined; this.reads++; this.clearAvatars(); return { cleared: true }; }
  preferencesChanged() {
    this.pollHot();
    if (this.runtime.state.preferences.rooms?.off) { this.reads++; this.runtime.state.rooms.summaries = {}; this.runtime.state.rooms.hot = undefined; this.runtime.state.rooms.people = undefined; this.clearAvatars(); }
    return this.sync();
  }
  async settings(input: { off?: unknown }) {
    this.requireAccount(); if (Object.keys(input).some(key => key !== 'off') || typeof input.off !== 'boolean') throw commandError('INVALID_INPUT', 'common.error');
    const scope = this.scope(), previous = this.runtime.state.preferences;
    this.runtime.state.preferences = { ...previous, rooms: { off: input.off } }; const submitted = this.runtime.state.preferences;
    const syncing = this.preferencesChanged(); void syncing.catch(() => {});
    try { await scope.wait(this.runtime.sharing.savePreferences()); }
    catch (error) { if (scope.current() && this.runtime.state.preferences === submitted) { this.runtime.state.preferences = previous; void this.preferencesChanged().catch(() => {}); this.runtime.emit(); } throw error; }
    await scope.wait(syncing); this.runtime.emit(); return { ...this.runtime.state.preferences.rooms };
  }
  private append(message: RoomMessage) {
    if (message.key !== this.runtime.state.rooms.current?.key || this.retracted.has(message.id)) return;
    const old = this.messages.get(message.id); this.messages.set(message.id, { ...message, ...(old?.folded || this.folded.has(message.id) ? { folded: true } : {}), ...(old?.reported ? { reported: true } : {}) });
  }
  refreshMessages(key: string, messages: RoomMessage[]) {
    if (this.runtime.state.rooms.current?.key !== key) return;
    this.update(() => { for (const message of messages) if (this.messages.has(message.id)) this.append(message); });
  }
  consume(event: RoomEvent) {
    if (!this.enabled() || !this.panels || this.runtime.state.rooms.current?.key !== event.key) return;
    this.update(() => this.applyEvent(event)); this.runtime.emit();
  }
  private update(work: () => void) { if (this.runtime.state.rooms.current?.loading) this.updates.push(work); work(); }
  private applyCount(key: string, count: number) {
    const state = this.runtime.state.rooms;
    for (const row of [state.current, state.summaries[key], ...this.hotRows()]) if (row?.key === key) row.count = count;
    if (state.people?.key === key) state.people.count = count;
  }
  private applyEvent(event: RoomEvent) {
    if (event.type === 'message') this.append(event.message);
    else if (event.type === 'folded') { this.folded.add(event.id); const message = this.messages.get(event.id); if (message) this.messages.set(event.id, { ...message, folded: true }); }
    else if (event.type === 'retract') { this.retracted.add(event.id); this.messages.delete(event.id); }
    else if (event.type === 'count') this.applyCount(event.key, event.count);
    else if (event.type === 'stance') { this.stanceVersions.set(event.key, (this.stanceVersions.get(event.key) ?? 0) + 1); this.applyStance(event.key, event.stance); }
  }
  private visiblePeople() {
    const state = this.runtime.state.rooms, people = new Map<string, { key: string; person: RoomPerson }>(), blocked = new Set(state.blocked.map(person => person.id));
    const add = (key: string, list: RoomPerson[]) => { for (const person of list) if (!blocked.has(person.id)) people.set(person.id, { key, person }); };
    if (!this.enabled()) return people;
    if (state.current) { add(state.current.key, state.current.messages.map(message => message.author)); add(state.current.key, state.current.faces); }
    for (const row of [...Object.values(state.summaries), ...this.hotRows()]) add(row.key, row.faces);
    if (state.people) add(state.people.key, state.people.people);
    return people;
  }
  private visibleAvatars() {
    const avatars = new Map<string, { id: string; load: () => Promise<Blob> }>();
    for (const { key, person } of this.visiblePeople().values()) if (person.avatarId) avatars.set(person.id, { id: person.avatarId, load: () => this.runtime.api.roomAvatar(key, person.id) });
    if (this.runtime.auth.session) for (const invite of this.runtime.state.rooms.invites) if (invite.team.avatarId) avatars.set(`team:${invite.team.id}`, { id: invite.team.avatarId, load: () => this.inviteAvatar(invite.id) });
    return avatars;
  }
  private async inviteAvatar(id: string): Promise<Blob> {
    return this.runtime.api.inviteAvatar(id, this.runtime.auth.session!.token);
  }
  private pruneInput = '';
  private messagesInput = '';
  private pruneAt = Infinity;
  pruneIfChanged() {
    const input = () => {
      const state = this.runtime.state.rooms;
      return JSON.stringify([state.current?.key, state.current?.faces, [...this.messages], state.blocked,
        [...Object.values(state.summaries), ...this.hotRows()].map(row => [row.key, row.faces]),
        state.people?.key, state.people?.people, state.invites, [...this.avatarUrls], [...this.avatarFailures].map(([id, failure]) => [id, failure.until]),
        [...this.watches], [...this.hotSources], [...this.summaryAccess], [...this.hotAt], this.peopleAt, state.pinned,
        this.enabled(), this.runtime.state.connection.networkOnline, this.runtime.auth.session?.token, this.epoch]);
    };
    if (input() === this.pruneInput && Date.now() < this.pruneAt) return;
    this.prune();
    this.pruneInput = input();
    // Avatar retries and cached results expire on their own; prune again at the earliest of them.
    const now = Date.now(), state = this.runtime.state.rooms;
    const deadlines = [...[...this.avatarFailures.values()].map(failure => failure.until), ...[...this.summaryAccess.values()].map(at => at + RESULT_TTL),
      ...Object.keys(state.hot ?? {}).map(chain => this.hotAt.get(chain)! + RESULT_TTL), ...state.people ? [this.peopleAt + RESULT_TTL] : []];
    this.pruneAt = Math.min(Infinity, ...deadlines.filter(at => at > now));
  }
  private pruneResults() {
    const state = this.runtime.state.rooms, now = Date.now(), watches = [...this.watches.values()];
    const hotChains = new Set([...this.hotSources.values()].map(chain => chain ?? ''));
    for (const chain of Object.keys(state.hot ?? {})) {
      if (!this.hotAt.has(chain)) this.hotAt.set(chain, now);
      if (!hotChains.has(chain) && this.hotAt.get(chain)! + RESULT_TTL <= now) { delete state.hot![chain]; this.hotAt.delete(chain); }
    }
    if (state.hot && !Object.keys(state.hot).length) state.hot = undefined;
    if (state.people && !watches.includes(state.people.key) && (this.peopleAt || (this.peopleAt = now)) + RESULT_TTL <= now) state.people = undefined;
    const protectedKeys = new Set([state.current?.key, state.pinned, ...watches, ...this.hotRows().map(row => row.key)]);
    for (const [key, row] of Object.entries(state.summaries)) if (!this.summaryAccess.has(key)) this.summaryAccess.set(key, row.at);
    let count = Object.keys(state.summaries).length;
    for (const [key, at] of this.summaryAccess) {
      if (protectedKeys.has(key)) continue;
      if (at + RESULT_TTL <= now || count > SUMMARY_LIMIT) { if (state.summaries[key]) { delete state.summaries[key]; count--; } this.summaryAccess.delete(key); }
    }
    for (const key of this.stanceVersions.keys()) if (!protectedKeys.has(key) && !state.summaries[key] && !this.summaryReads.has(key) && !this.stanceQueues.has(key) && !this.pendingReads.size) this.stanceVersions.delete(key);
  }
  prune() {
    this.pruneResults();
    const state = this.runtime.state.rooms, blocked = new Set(state.blocked.map(person => person.id));
    const input = () => JSON.stringify([state.current?.key, [...this.messages], [...blocked]]);
    if (input() !== this.messagesInput) {
      const messages = [...this.messages.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(-ROOM_MESSAGE_LIMIT);
      this.messages = new Map(messages.map(message => [message.id, message]));
      if (state.current) state.current.messages = messages.filter(message => !blocked.has(message.author.id));
      this.messagesInput = input();
    }
    for (const row of [state.current, ...Object.values(state.summaries), ...this.hotRows()]) if (row) row.faces = row.faces.filter(person => !blocked.has(person.id));
    if (state.people) state.people.people = state.people.people.filter(person => !blocked.has(person.id));
    const online = this.runtime.state.connection.networkOnline;
    if (online && !this.avatarOnline) this.retryAvatars();
    this.avatarOnline = online;
    const visible = this.visibleAvatars(), ids = new Set([...visible.values()].map(avatar => avatar.id));
    for (const [id, url] of this.avatarUrls) if (!ids.has(id)) { URL.revokeObjectURL(url); this.avatarUrls.delete(id); }
    for (const id of this.avatarFailures.keys()) if (!ids.has(id)) this.avatarFailures.delete(id);
    state.avatars = Object.fromEntries([...visible].flatMap(([key, avatar]) => { const url = this.avatarUrls.get(avatar.id); return url ? [[key, url]] : []; }));
    for (const { id, load } of visible.values()) this.loadAvatar(id, load);
  }
  private retryAvatars() {
    const now = Date.now();
    for (const [id, failure] of this.avatarFailures) {
      if (!Number.isFinite(failure.until)) continue;
      if (failure.server && failure.server > now) failure.until = failure.server; else this.avatarFailures.delete(id);
    }
  }
  private loadAvatar(id: string, load: () => Promise<Blob>) {
    const failure = this.avatarFailures.get(id), token = this.runtime.auth.session?.token;
    if (failure && (!failure.current() || failure.token !== token || failure.until <= Date.now())) this.avatarFailures.delete(id);
    if (this.avatarUrls.has(id) || this.avatarLoads.has(id) || this.avatarFailures.has(id)) return;
    const scope = this.scope(), version = this.avatarVersion;
    const work = (async () => {
      try {
        const blob = await scope.wait(load());
        if (version !== this.avatarVersion || ![...this.visibleAvatars().values()].some(avatar => avatar.id === id)) return;
        this.avatarUrls.set(id, URL.createObjectURL(blob)); this.runtime.emit();
      } catch (error) {
        if (scope.current() && version === this.avatarVersion) {
          const permanent = error instanceof ApiError && [403, 404, 410].includes(error.status);
          const server = error instanceof ApiError && error.retryAfterMs ? Date.now() + error.retryAfterMs : undefined;
          this.avatarFailures.set(id, { until: permanent ? Infinity : Math.max(Date.now() + 30_000, server ?? 0), server, current: scope.current, token });
        }
      }
    })();
    this.avatarLoads.set(id, work); void work.finally(() => { if (this.avatarLoads.get(id) === work) this.avatarLoads.delete(id); });
  }
}
