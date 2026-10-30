import { startLiveSync } from './live-sync';
import { restoreLocalData } from './local-restore';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionStatus } from '../transport/connection';
import { isLiveTimelineArrival } from '../chat/timeline-arrival';
import { createClient,PendingEventOrdering,ClientEvent,RoomEvent,MatrixEventEvent,MatrixScheduler,type MatrixClient,type MatrixEvent,type Room } from 'matrix-js-sdk';
import { type Identity } from '@palside/shared/identity';
import { deviceKeyPublication,ensureCryptoIdentity,ownDeviceSigned,secretStorageCallbacks,OnlySignedDevicesIsolationMode } from './crypto-identity';
import { POKE_EVENT } from '../../domain/annotations/social';
import type { RuntimeDevice } from './device';
import { silent } from '../composition/state';
import { sessionGuard } from './session';
import type { SessionRuntime } from './session-lifecycle';
import { refreshDomains } from './live-sync';

export async function connectRuntimeDevice(this: SessionRuntime, session: RuntimeDevice, identity?: Identity) {
    const runtime = this.runtime;
    const scope = this.scope();
    await this.finishCleanup(); scope.check();
    const disposeLive = this.liveDispose as (() => void) | undefined;
    if (disposeLive) disposeLive();
    this.liveDispose = undefined;
    this.sseOpen = false; this.presenceVersion++; this.snapshotPresence = undefined;
    runtime.state.data.people = runtime.state.data.people.map(person => ({ ...person, presence: undefined }));
    const previous = this.client; this.client = undefined; previous?.stopClient(); this.cryptoInitialised = false;
    runtime.state.connection.messaging = 'connecting'; runtime.timeline.readyForLiveEvents = false; this.receiveSince = Date.now();
    if (this.session?.account.id !== session.account.id) { runtime.rooms.reset(); this.hostEpoch++; runtime.state.toggles = { share: false, interact: false }; }
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
    const startOptions = { initialSyncLimit: 100, disablePresence: true, pendingEventOrdering: PendingEventOrdering.Detached };
    const client = createClient({ baseUrl: runtime.api.baseUrl, accessToken: session.token, userId: session.matrix.userId, deviceId: session.matrix.deviceId, cryptoCallbacks: secretStorageCallbacks(() => secretStorageKey), logger: silent, scheduler: new MatrixScheduler(() => -1), fetchFn: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const transactionId = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
      const original = runtime.sending.editOriginals.get(transactionId);
      const headers = new Headers(init?.headers); if (original) { headers.set('X-Palside-Original', original.id); headers.set('X-Palside-Edit-Base', String(original.baseEditedAt)); }
      return fetch(input, { ...init, headers }).then(response => {
        if (scope.current() && this.session === session && new URL(url).pathname.endsWith('/keys/upload')) publication?.observe(init?.body, response);
        return response;
      });
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
      if (runtime.state.connection.messaging === 'ready') runtime.state.connection.networkOnline = true;
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
      if (event.getType() === 'com.palside.reaction') { runtime.interactions.consumeReaction(event, session); return; }
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
    if (this.sseOpen) this.scheduleDeviceStateReport(true);
    if (status.roomCatchUp) runtime.rooms.reconnected();
    void runtime.rooms.start().catch(() => {});
    void (async () => {
      await new Promise(resolve => setTimeout(resolve, 0)); if (!scope.current()) return;
      for (const team of runtime.state.remoteTeams.filter(t => t.joined)) {
        const room = client.getRoom(team.roomId); if (!room) continue;
        for (let page = 0; page < 10 && room.oldState.paginationToken; page++) {
          try { await this.history(room); if (!scope.current()) return; } catch { break; }
        }
      }
    })();
    } catch (error) {
      liveDispose();
      if (this.liveDispose === liveDispose) { this.liveDispose = undefined; this.sseOpen = false; }
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
        await scope.wait(client.scrollback(room, 100)); check();
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
