import { startLiveSync } from './live-sync';
import { restoreLocalData } from './local-restore';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionStatus } from '../transport/connection';
import { liveMatrixFetch } from '../transport/matrix-fetch';
import { isLiveTimelineArrival } from '../chat/timeline-arrival';
import { createClient,PendingEventOrdering,ClientEvent,RoomEvent,MatrixEventEvent,MatrixScheduler,type MatrixClient,type MatrixEvent,type Room } from 'matrix-js-sdk';
import { type Identity } from '@palside/shared/identity';
import { deviceKeyPublication,ensureCryptoIdentity,ownDeviceSigned,secretStorageCallbacks,OnlySignedDevicesIsolationMode } from './crypto-identity';
import { POKE_EVENT } from '../../domain/annotations/social';
import { FOLLOW_EVENT } from '../../domain/annotations/follow.ts';
import type { RuntimeDevice } from './device';
import { silent } from '../composition/state';
import { sessionGuard } from './session';
import type { SessionRuntime } from './session-lifecycle';
import { refreshDomains } from './live-sync';

const HISTORY_PAGE_SIZE = 100;
const HISTORY_PRELOAD_PAGES = 10;

export async function connectRuntimeDevice(this: SessionRuntime, session: RuntimeDevice, identity?: Identity) {
    const runtime = this.runtime;
    const scope = this.scope();
    await this.finishCleanup(); scope.check();
    const disposeLive = this.liveDispose as (() => void) | undefined;
    if (disposeLive) disposeLive();
    this.liveDispose = undefined;
    this.liveOpen = false; this.presenceVersion++; this.snapshotPresence = undefined;
    runtime.state.data.people = runtime.state.data.people.map(person => ({ ...person, presence: undefined }));
    const previous = this.client; this.client = undefined; previous?.stopClient(); this.cryptoInitialised = false;
    runtime.state.connection.messaging = 'connecting'; runtime.timeline.readyForLiveEvents = false; this.receiveSince = Date.now();
    if (this.session?.account.id !== session.account.id) { runtime.rooms.reset(); this.hostEpoch++; }
    this.session = session; runtime.api.token = session.token;
    const guard = sessionGuard(() => scope.current() ? this.session : undefined, session, () => new MessageError(uiMessage('extension.runtime.loginChanged')));
    const status = { initialIssued: false, roomsStarted: false, roomCatchUp: false };
    let liveClient: MatrixClient | undefined;
    const current = () => scope.current() && this.session === session && this.client === liveClient;
    const liveDispose = startLiveSync(this, session, current, status);
    this.liveDispose = liveDispose;
    try {
    await restoreLocalData.call(this, session, identity, guard);
    await this.refreshing?.catch(() => {});
    guard();
    if (!runtime.state.config.websiteUrl) { const config = await runtime.api.request('system.config'); guard(); runtime.state.config = config; }
    let secretStorageKey = identity?.secretStorageKey;
    const publication = identity ? deviceKeyPublication(session.matrix.userId, session.matrix.deviceId) : undefined;
    const identityAbort = identity ? new AbortController() : undefined;
    this.identityAbort = identityAbort;
    // Every Matrix request rides the live socket; an edit names its original and base as the gateway checks them.
    const matrixFetch = liveMatrixFetch(runtime.api.live, url => {
      const original = runtime.sending.editOriginals.get(decodeURIComponent(url.pathname.split('/').at(-1) ?? ''));
      return original ? { original: original.id, editBase: String(original.baseEditedAt) } : undefined;
    });
    const startOptions = { initialSyncLimit: HISTORY_PAGE_SIZE, disablePresence: true, pendingEventOrdering: PendingEventOrdering.Detached };
    const client = createClient({ baseUrl: runtime.api.baseUrl, accessToken: session.token, userId: session.matrix.userId, deviceId: session.matrix.deviceId, cryptoCallbacks: secretStorageCallbacks(() => secretStorageKey), logger: silent, scheduler: new MatrixScheduler(() => -1), fetchFn: async (input, init) => {
      const response = await matrixFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (scope.current() && this.session === session && new URL(url).pathname.endsWith('/keys/upload')) publication?.observe(init?.body, response);
      return response;
    } });
    this.client = client; liveClient = client;
    let identitySyncError: unknown;
    const onIdentitySync = (_state: unknown, _previous: unknown, data?: { error?: unknown }) => {
      if (data?.error) { identitySyncError = data.error; identityAbort?.abort(); }
    };
    try {
      try { this.cryptoOpening = client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: `palside-local-crypto-${session.account.id}`, storageKey: new Uint8Array(session.storageKey) }); await this.cryptoOpening; guard(); this.cryptoOpening = undefined; }
      catch (error) { if (scope.current() && this.session === session) runtime.state.connection.messaging = 'failed'; throw error; }
      if (!scope.current() || this.session !== session || this.client !== client) { client.stopClient(); throw new MessageError(uiMessage('extension.runtime.connectionChanged')); }
      const crypto = client.getCrypto();
      crypto?.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode());
      status.initialIssued = true; await this.refresh(refreshDomains); guard();
      if (identity) {
        const keys = await client.downloadKeysForUsers([session.matrix.userId]); guard();
        client.on(ClientEvent.Sync, onIdentitySync);
        await client.startClient(startOptions); guard();
        if (identitySyncError) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
        // A new device has pending /keys/upload until sync starts; signing it sooner can be rejected inside a 200 response.
        if (!keys.device_keys?.[session.matrix.userId]?.[session.matrix.deviceId]) await publication!.wait(identityAbort!.signal);
        guard(); await ensureCryptoIdentity(client, secretStorageKey!); guard();
      }
      if (identity) {
        const verified = await ownDeviceSigned(client);
        if (identitySyncError) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
        if (!scope.current() || this.session !== session || this.client !== client) throw new MessageError(uiMessage('extension.runtime.connectionChanged'));
        if (!verified) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
        session.crypto = 'ready';
      }
    } finally { client.removeListener(ClientEvent.Sync, onIdentitySync); secretStorageKey = undefined; if (this.identityAbort === identityAbort) this.identityAbort = undefined; identityAbort?.abort(); }
    guard(); this.cryptoOpening = undefined; this.cryptoInitialised = true;
    client.on(ClientEvent.Sync, (state, _previous, data) => {
      if (!scope.current() || this.session !== session || this.client !== client) return;
      if (data?.error) runtime.diagnosticErrors.record(data.error);
      if (data?.error && 'errcode' in data.error && data.error.errcode === 'M_UNKNOWN_TOKEN') { void this.expireRuntimeDevice(); return; }
      runtime.state.connection.messaging = state === 'PREPARED' || state === 'SYNCING' ? 'ready' : state === 'ERROR' || state === 'RECONNECTING' || state === 'STOPPED' ? 'unavailable' : 'connecting';
      if (runtime.state.connection.messaging === 'ready') { runtime.state.connection.networkOnline = true; void this.preloadHistory().catch(() => {}); }
      if (connectionStatus(runtime.state.connection) !== 'connected') { runtime.timeline.readyForLiveEvents = false; this.receiveSince = Date.now(); }
      else runtime.timeline.readyForLiveEvents = true;
      runtime.emit();
    });
    const arrivals = new WeakSet<MatrixEvent>();
    const consume = (event: MatrixEvent) => { if (this.historyPage?.client === client && this.historyPage.events.has(event)) return; if (!scope.current() || this.session !== session || this.client !== client) return; void runtime.timeline.consume(event, arrivals.has(event)).catch(() => { if (scope.current() && this.session === session && this.client === client) { runtime.state.error = uiMessage('extension.runtime.messageReadFailed'); runtime.emit(); } }); };
    client.on(ClientEvent.ToDeviceEvent, event => {
      if (!scope.current() || this.session !== session || this.client !== client) return;
      if (event.getType() === 'com.palside.viewing.active') {
        if (event.isEncrypted() || event.getSender() !== session.matrix.userId) return;
        const active = event.getContent().states as { accountId: string; teamId: string; expiresAt: number; deviceId?: string; order: number; sequence: number }[];
        if (Array.isArray(active)) runtime.sharing.activeViewing = new Map(active.map(entry => [entry.accountId, entry]));
        if (Array.isArray(active) && runtime.sharing.ownViewing && !active.some(s => s.accountId === session.account.id && s.deviceId === session.matrix.deviceId && s.teamId === runtime.sharing.ownViewing?.teamId)) runtime.sharing.ownViewing = undefined;
        if (Array.isArray(active)) for (const [id, entry] of runtime.sharing.peerViewing) if (!active.some(s => s.accountId === id && s.teamId === entry.teamId)) runtime.sharing.peerViewing.delete(id);
        if (Array.isArray(active)) for (const [id, version] of runtime.sharing.peerViewingVersions) if (!active.some(s => s.accountId === id && s.teamId === runtime.state.preferences.current)) runtime.sharing.peerViewingVersions.set(id, version + 1);
        runtime.sharing.expireViewing(); return;
      }
      if (!event.isEncrypted() || event.isDecryptionFailure()) return;
      if (event.getType() === 'com.palside.signal') { runtime.signals.consume(event, session); return; }
      if (event.getType() === 'com.palside.chart_mark') { runtime.signals.consumeMark(event, session); return; }
      if (event.getType() === 'com.palside.reaction') { runtime.interactions.consumeReaction(event, session); return; }
      if (event.getType() === FOLLOW_EVENT) { runtime.interactions.consumeFollow(event, session); return; }
      if (event.getType() === POKE_EVENT) { void runtime.interactions.consumePoke(event, session).catch(() => {}); return; }
      if (event.getType() !== 'com.palside.viewing') return;
      void runtime.sharing.consumeViewing(event, session).catch(() => {});
    });
    client.on(RoomEvent.Timeline, (event, _room, toStart, removed, data) => {
      // Classify before async decryption; pagination/cache/reconnect replay isn't a new arrival.
      if (isLiveTimelineArrival({ toStart, removed, liveEvent: data.liveEvent, ready: runtime.timeline.readyForLiveEvents, timestamp: event.getTs(), receiveSince: this.receiveSince })) arrivals.add(event);
      if (toStart && !removed && this.historyPage?.client === client) this.historyPage.events.add(event);
      else if (!removed) consume(event);
    });
    client.on(MatrixEventEvent.Decrypted, consume);
    if (!identity) await client.startClient(startOptions);
    else {
      const state = client.getSyncState();
      runtime.state.connection.messaging = state === 'PREPARED' || state === 'SYNCING' ? 'ready' : 'connecting';
      // Initial sync ran only to publish device keys; replay its stored events after identity verification.
      for (const room of client.getRooms()) for (const event of room.getLiveTimeline().getEvents()) consume(event);
    }
    if (!scope.current() || this.session !== session || this.client !== client) { client.stopClient(); guard(); throw new MessageError(uiMessage('extension.runtime.connectionChanged')); }
    status.roomsStarted = true;
    if (this.liveOpen) this.scheduleDeviceStateReport(true);
    if (status.roomCatchUp) runtime.rooms.reconnected();
    void runtime.rooms.start().catch(() => {});
    void this.preloadHistory().catch(() => {});
    } catch (error) {
      liveDispose();
      if (this.liveDispose === liveDispose) { this.liveDispose = undefined; this.liveOpen = false; }
      throw error;
    }
  }

export function history(this: SessionRuntime, room: Room) {
    const runtime = this.runtime, client = this.client, session = this.session, scope = this.scope();
    const check = () => { scope.check(); if (!client || this.client !== client || this.session !== session) throw new MessageError(uiMessage('extension.runtime.connectionChanged')); };
    const work = this.historyQueue.catch(() => {}).then(async () => {
      check();
      if (!client) return;
      const page = { client, events: new Set<MatrixEvent>() }; this.historyPage = page;
      try {
        await scope.wait(client.scrollback(room, HISTORY_PAGE_SIZE)); check();
        this.historyPages.set(room, (this.historyPages.get(room) ?? 0) + 1);
        await runtime.cache.cachePage(async () => {
          for (const event of page.events) {
            if (event.isEncrypted()) await scope.wait(client.decryptEventIfNeeded(event));
            check(); await scope.wait(runtime.timeline.consume(event));
          }
        });
      } finally { if (this.historyPage === page) this.historyPage = undefined; }
    });
    this.historyQueue = work; return work;
  }

export function preloadHistory(this: SessionRuntime): Promise<void> {
  const runtime = this.runtime, client = this.client, scope = this.scope();
  const team = runtime.state.remoteTeams.find(team => team.id === runtime.state.preferences.current && team.joined);
  const room = team && client?.getRoom(team.roomId);
  if (!team || !room || !this.cryptoInitialised) return Promise.resolve();
  const pending = this.historyPreloads.get(room); if (pending) return pending;
  if (runtime.state.history?.[team.id] && ((this.historyPages.get(room) ?? 0) >= HISTORY_PRELOAD_PAGES || !room.oldState.paginationToken)) return Promise.resolve();
  const current = () => scope.current() && this.client === client && runtime.state.preferences.current === team.id && runtime.state.remoteTeams.some(row => row.id === team.id && row.joined);
  const work = (async () => {
    runtime.state.history ??= {};
    const status = runtime.state.history[team.id] ??= { missingKeys: this.runtime.timeline.missingEvents.get(team.id)?.size ?? 0, loaded: false, loading: false };
    if ((this.historyPages.get(room) ?? 0) >= HISTORY_PRELOAD_PAGES || !room.oldState.paginationToken) { status.loaded = !room.oldState.paginationToken; runtime.emit(); return; }
    status.loading = true; runtime.emit();
    try {
      while (current() && (this.historyPages.get(room) ?? 0) < HISTORY_PRELOAD_PAGES && room.oldState.paginationToken) await this.history(room);
      if (scope.current() && this.client === client) status.loaded = !room.oldState.paginationToken;
    } finally { if (scope.current() && this.client === client) { status.loading = false; runtime.emit(); } }
  })();
  this.historyPreloads.set(room, work);
  void work.finally(() => { if (this.historyPreloads.get(room) === work) this.historyPreloads.delete(room); }).catch(() => {});
  return work;
}
