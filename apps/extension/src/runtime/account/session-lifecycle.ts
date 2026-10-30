import { refresh,requestRefresh,scheduleDeviceStateReport,reportDeviceState } from './live-sync';
import { fetchSnapshot } from './snapshot';
import { connectRuntimeDevice,history } from './matrix-session';
import { start } from './local-restore';
import { type PresenceState } from '@palside/shared/contracts/common';
import type { DeviceState } from '@palside/shared/contracts/presence';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionBlock,connectionStatus } from '../transport/connection';
import { createClient,type MatrixClient,type MatrixEvent,type Room } from 'matrix-js-sdk';
import { type Identity } from '@palside/shared/identity';
import { ApiError } from '../transport/api';
import { connectLiveEvents } from '../transport/live-events';
import type { RuntimeDevice } from './device';
import { SNAPSHOT_INTERVAL,emptyState } from '../composition/state';
import { sessionScope } from './session';
import { DeviceCleanup,within,type CleanupIntent } from './cleanup';
import type { PalsideService } from '../composition/core';

import { refreshDomains,type RefreshDomain } from './live-sync';

export class SessionRuntime {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  session?: RuntimeDevice;
  generation = 0;
  hostEpoch = 0;
  readonly cleanup = new DeviceCleanup();
  cryptoOpening?: Promise<void>;
  identityAbort?: AbortController;
  private authenticationAbort = new AbortController();
  presenceVersion = 0;
  snapshotPresence?: Map<string, PresenceState>;
  client?: MatrixClient;
  cryptoInitialised = false;
  refreshing?: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
  receiveSince = Date.now();
  snapshotAt = 0;
  deviceState: DeviceState = 'away';
  reportedDeviceState?: DeviceState;
  deviceStateTimer?: ReturnType<typeof setTimeout>;
  directoryExpiresAt = 0;
  authQueue: Promise<unknown> = Promise.resolve();
  initialising?: Promise<void>;
  mnemonic?: string;
  pendingIdentity?: Identity;
  pendingDevice?: RuntimeDevice;
  authMode?: 'create' | 'login';
  connecting?: { session: RuntimeDevice; promise: Promise<void> };
  connectLiveEvents = connectLiveEvents;
  liveDispose?: () => void;
  sseOpen = false;
  refreshQueued = new Set<RefreshDomain>();
  scope() {
    const generation = this.generation;
    return sessionScope(() => this.generation === generation, () => new MessageError(uiMessage('extension.runtime.loginChanged')));
  }
  cancelAuthentication() {
    this.generation++;
    this.authenticationAbort.abort(new MessageError(uiMessage('extension.runtime.loginChanged')));
    this.identityAbort?.abort();
  }
  beginAuthentication() {
    this.cancelAuthentication();
    this.authenticationAbort = new AbortController();
  }
  authenticationScope() {
    const { signal } = this.authenticationAbort;
    const scope = sessionScope(() => !signal.aborted, () => new MessageError(uiMessage('extension.runtime.loginChanged')));
    return { ...scope, signal };
  }
  async finishCleanup() {
    if (!await this.cleanup.flush()) throw new MessageError(uiMessage('extension.runtime.deviceCleanupPending'));
  }
  initialise() {
    this.initialising ??= this.start().catch(error => { this.initialising = undefined; throw error; }); return this.initialising;
  }
  start() { return start.call(this); }
  networkChanged(online: boolean) {
    const runtime = this.runtime;
    runtime.state.connection.networkOnline = online;
    runtime.state.connection.service = 'connecting';
    runtime.state.connection.messaging = 'connecting';
    runtime.timeline.readyForLiveEvents = false; this.receiveSince = Date.now(); runtime.emit();
    if (online) void this.reconnect().catch(() => {});
    else void runtime.wallet.offline();
  }
  requireConnection() {
    const runtime = this.runtime;
    const message = connectionBlock(runtime.state.connection);
    if (message) throw new ApiError(0, { error: 'CONNECTION_UNAVAILABLE', text: message });
  }
  scheduleDeviceStateReport(force = false) { return scheduleDeviceStateReport.call(this, force); }
  reportDeviceState(force = false) { return reportDeviceState.call(this, force); }
  async expireRuntimeDevice() {
    const runtime = this.runtime;
    if (this.pendingDevice && this.session === this.pendingDevice) { const client = this.client; this.client = undefined; client?.stopClient(); this.cryptoInitialised = false; return; }
    await this.clearDevice(); runtime.state.error = uiMessage('extension.runtime.deviceRevoked'); runtime.emit();
  }
  async reconnect() {
    const runtime = this.runtime;
    if (runtime.state.connection.retrying || this.pendingDevice) return;
    const session = this.session;
    runtime.state.connection.retrying = true; runtime.emit();
    try {
      if (!this.cryptoInitialised && session) await this.connect(session);
      else { this.client?.retryImmediately(); await this.refresh(refreshDomains); }
    } finally { if (this.session === session) { runtime.state.connection.retrying = false; runtime.emit(); } }
  }
  async maintainConnection() {
    const runtime = this.runtime;
    if (!this.session || this.pendingDevice) return;
    if (this.connecting) return this.connecting.promise;
    if (runtime.state.connection.messaging === 'failed') return;
    if (!this.cryptoInitialised) return this.connect(this.session);
    if (runtime.state.connection.messaging !== 'ready') this.client?.retryImmediately();
    else if (connectionStatus(runtime.state.connection) === 'connected' && Date.now() - this.snapshotAt < (this.sseOpen ? 60_000 : SNAPSHOT_INTERVAL)) return;
    await this.refresh(refreshDomains);
  }
  connect(session: RuntimeDevice, identity?: Identity): Promise<void> {
    const runtime = this.runtime;
    const running = this.connecting;
    if (running) { const scope = this.scope(); return running.session === session && !identity ? running.promise : running.promise.catch(() => {}).then(() => { scope.check(); return this.connect(session, identity); }); }
    const generation = ++this.generation;
    runtime.wallet.reset();
    const work = this.connectRuntimeDevice(session, identity);
    const signal = identity ? this.authenticationAbort.signal : undefined;
    let abort: (() => void) | undefined;
    const connection = signal ? Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    })]) : work;
    const promise = connection.catch(error => {
      if (this.generation === generation && this.session === session) { this.liveDispose?.(); this.liveDispose = undefined; this.sseOpen = false; this.client?.stopClient(); this.client = undefined; this.cryptoInitialised = false; if (runtime.state.connection.messaging !== 'failed') runtime.state.connection.messaging = 'unavailable'; runtime.emit(); }
      throw error;
    }).finally(() => { if (abort) signal?.removeEventListener('abort', abort); if (this.connecting?.promise === promise) this.connecting = undefined; });
    this.connecting = { session, promise }; return promise;
  }
  connectRuntimeDevice(session: RuntimeDevice, identity?: Identity) { return connectRuntimeDevice.call(this, session, identity); }
  historyPage?: { client: MatrixClient; events: Set<MatrixEvent> };
  historyQueue: Promise<void> = Promise.resolve();
  history(room: Room) { return history.call(this, room); }

  refresh(domains: readonly RefreshDomain[] = ['account']) { return refresh.call(this, domains); }
  requestRefresh(domains: readonly RefreshDomain[] = ['account']) { return requestRefresh.call(this, domains); }
  fetchSnapshot() { return fetchSnapshot.call(this); }
  async revokeDevice(session: RuntimeDevice) {
    const runtime = this.runtime;
    try { return await within(runtime.api.request('accounts.logout', { token: session.token, timeoutMs: 3000 }).then(() => true, () => false), 3000) ?? false; }
    catch { return false; }
  }
  async discardPendingDevice() {
    const session = this.pendingDevice; this.pendingDevice = undefined;
    if (session) {
      const remote = this.revokeDevice(session);
      this.scheduleCleanup(session, false);
      await Promise.all([remote, this.cleanup.flush()]);
    }
    await this.finishCleanup();
  }
  scheduleCleanup(session: RuntimeDevice | undefined, preservePreferences: boolean, client?: MatrixClient, opening = this.cryptoOpening) {
    this.resumeCleanup({ ...(session ? { accountId: session.account.id, cryptoDatabasePrefix: `palside-local-crypto-${session.account.id}` } : {}), preservePreferences }, client, opening);
  }
  resumeCleanup(intent: CleanupIntent, client?: MatrixClient, opening?: Promise<void>) {
    const runtime = this.runtime;
    this.cleanup.add('device-cleanup', async () => {
      await runtime.storage.put('device-cleanup', '_device', 'cleanup', intent);
      const jobs = ['device', 'vault', 'pending-device', 'pending-invite'].map(key => runtime.storage.remove(key));
      if (intent.accountId) jobs.push(runtime.storage.clearAccount(intent.accountId, intent.preservePreferences));
      if (intent.cryptoDatabasePrefix) jobs.push((async () => {
        await opening?.catch(() => {});
        const owner = client ?? createClient({ baseUrl: runtime.api.baseUrl });
        if (!client || opening) owner.stopClient();
        await owner.clearStores({ cryptoDatabasePrefix: intent.cryptoDatabasePrefix });
      })());
      const results = await Promise.allSettled(jobs);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      await runtime.storage.remove('device-cleanup');
    });
  }
  async clearDevice(preservePreferences = false) {
    const runtime = this.runtime;
    this.cancelAuthentication(); this.presenceVersion++; this.snapshotPresence = undefined;
    runtime.wallet.reset(); runtime.signals.reset(); runtime.rooms.reset(); this.hostEpoch++;
    this.identityAbort?.abort(); this.identityAbort = undefined;
    const scope = this.scope();
    runtime.dispatch.inviteRequest++; runtime.dispatch.inviteExpiresAt = 0; runtime.sharing.invalidatePage();
    this.liveDispose?.(); this.liveDispose = undefined; this.sseOpen = false; this.refreshQueued.clear();
    clearTimeout(this.deviceStateTimer); this.deviceStateTimer = undefined; this.reportedDeviceState = undefined;
    const old = this.session ?? this.pendingDevice; this.session = undefined; runtime.api.token = undefined;
    const client = this.client; this.client = undefined; client?.stopClient();
    this.scheduleCleanup(old, preservePreferences, client);
    this.connecting = undefined; this.refreshing = undefined; this.cryptoOpening = undefined;
    runtime.timeline.readyForLiveEvents = false; runtime.timeline.notifying.clear(); runtime.sending.sendRequests.clear(); runtime.sending.inFlight.clear(); runtime.dispatch.mutations.clear(); runtime.sending.editOriginals.clear(); runtime.sharing.publishing = false;
    runtime.sharing.peerViewing.clear(); runtime.sharing.activeViewing.clear(); runtime.sharing.viewingOrder = 0; runtime.sharing.ownViewing = undefined; runtime.timeline.missingEvents.clear(); runtime.timeline.edits.clear(); runtime.timeline.redactions.clear(); runtime.timeline.visiblePanels.clear(); runtime.timeline.visibleMessages.clear(); runtime.cache.preparedViews.clear(); this.mnemonic = undefined; this.pendingIdentity = undefined; this.pendingDevice = undefined; runtime.sharing.page = undefined; runtime.sharing.invalidatePage(); runtime.sharing.peerViewingVersions.clear(); this.cryptoInitialised = false; runtime.sharing.selectedDevice = false; clearTimeout(runtime.sharing.viewingTimer); clearTimeout(runtime.sharing.viewingExpiryTimer); clearTimeout(runtime.interactions.reactionTimer); runtime.sharing.preferencesQueue = Promise.resolve(); runtime.sharing.persistedPreferences = undefined; runtime.sending.outgoing.clear(); runtime.cache.eventTimes.clear(); runtime.sending.pacer.clear(); runtime.sending.queued.clear(); runtime.state.sendQueue = undefined; runtime.timeline.pendingRead.clear(); clearTimeout(runtime.timeline.readTimer); this.snapshotAt = 0;
    for (const url of runtime.cache.mediaUrls.values()) URL.revokeObjectURL(url); runtime.cache.mediaUrls.clear();
    runtime.sharing.pagePreview = false;
    this.directoryExpiresAt = 0;
    this.authMode = undefined;
    const config = runtime.state.config;
    runtime.interactions.stickyRecords = [];
    runtime.interactions.annotationDeletions.clear();
    runtime.state = { ...emptyState(), revision: runtime.state.revision, ready: true, config, items: { stickies: [] }, pokes: undefined };
    runtime.emit();
    if (!await this.cleanup.flush() && scope.current()) { runtime.state.error = uiMessage('extension.runtime.deviceCleanupPending'); runtime.emit(); }
  }
}
