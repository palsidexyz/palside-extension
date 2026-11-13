import { DAY_MS, MINUTE_MS, SECOND_MS } from '@palside/shared/units';
import { retryDelayMs } from '@palside/shared/backoff';
import { clearBrowserAccount } from '../browser/account-cleanup';
import { refresh, requestRefresh, accountChanged, scheduleDeviceStateReport, reportDeviceState, refreshDomains, type RefreshDomain } from './live-sync';
import { fetchSnapshot } from './snapshot';
import { connectRuntimeDevice,history,preloadHistory } from './matrix-session';
import { start } from './local-restore';
import { type PresenceState } from '@palside/shared/contracts/common';
import type { DeviceState } from '@palside/shared/contracts/presence';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionBlock } from '../transport/connection';
import { createClient,type MatrixClient,type MatrixEvent,type Room } from 'matrix-js-sdk';
import { type Identity } from '@palside/shared/identity';
import { ApiError } from '../transport/api';
import { connectLiveEvents } from '../transport/live-events';
import type { RuntimeDevice } from './device';
import { SNAPSHOT_INTERVAL,emptyState } from '../composition/state';
import { sessionScope } from './session';
import { DeviceCleanup,within,type CleanupIntent } from './cleanup';
import type { PalsideService } from '../composition/core';


/** A failed reconnect or snapshot is retried after 5 s, doubling up to 5 min. */
const MAINTENANCE_BACKOFF = { baseMs: 5 * SECOND_MS, maxMs: 5 * MINUTE_MS };

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
  /** Unknown until the worker reports Chrome's idle state; nothing is reported before that. */
  deviceState?: DeviceState;
  reportedDeviceState?: DeviceState;
  deviceStateFailures = 0;
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
  liveOpen = false;
  refreshQueued = new Set<RefreshDomain>();
  /** Service time the last snapshot started reading, and the latest pushed change not yet proven to be in a snapshot. */
  snapshotReadAt = 0;
  changedAt = 0;
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
    this.maintenanceFailures = 0; this.maintenanceRetryAt = 0;
    runtime.state.connection.retrying = true; runtime.emit();
    try {
      if (!this.cryptoInitialised && session) await this.connect(session);
      else { this.client?.retryImmediately(); await this.refresh(refreshDomains); }
    } finally { if (this.session === session) { runtime.state.connection.retrying = false; runtime.emit(); } }
  }
  /** Consecutive failed maintenance attempts, and when the next may start: a down service is asked again with backoff, not every tick. */
  maintenanceFailures = 0;
  maintenanceRetryAt = 0;
  async maintainConnection() {
    const runtime = this.runtime;
    if (!this.session || this.pendingDevice) return;
    if (this.connecting) return this.connecting.promise;
    const { connection } = runtime.state;
    if (connection.messaging === 'failed' || !connection.networkOnline) return;
    const now = Date.now();
    if (now < this.maintenanceRetryAt) return;
    if (this.cryptoInitialised && connection.messaging !== 'ready') this.client?.retryImmediately();
    if (this.cryptoInitialised && connection.service === 'ready' && !this.snapshotStale(now)) return;
    const session = this.session;
    try {
      await (this.cryptoInitialised ? this.refresh(refreshDomains) : this.connect(session));
      if (this.session === session) { this.maintenanceFailures = 0; this.maintenanceRetryAt = 0; }
    } catch (error) {
      if (this.session !== session) return;
      this.maintenanceRetryAt = Date.now() + Math.max(error instanceof ApiError ? error.retryAfterMs ?? 0 : 0, retryDelayMs(++this.maintenanceFailures, MAINTENANCE_BACKOFF));
      throw error;
    }
  }
  /** Each device reads the new UTC day's 荣誉 within this spread after midnight, so the service does not see every device at once. */
  dayRefreshDelay = Math.floor(Math.random() * 10 * MINUTE_MS);
  /**
   * With the event stream open every account change arrives as a `refresh` push and reconnects read everything again, so the
   * snapshot is only re-read when a new UTC day changes 荣誉 and 热度. Without the stream it is re-read every `SNAPSHOT_INTERVAL`.
   */
  snapshotStale(now: number) {
    if (!this.liveOpen) return now - this.snapshotAt >= SNAPSHOT_INTERVAL;
    return Math.floor((now - this.dayRefreshDelay) / DAY_MS) > Math.floor((this.snapshotAt - this.dayRefreshDelay) / DAY_MS);
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
      if (this.generation === generation && this.session === session) { this.liveDispose?.(); this.liveDispose = undefined; this.liveOpen = false; this.client?.stopClient(); this.client = undefined; this.cryptoInitialised = false; if (runtime.state.connection.messaging !== 'failed') runtime.state.connection.messaging = 'unavailable'; runtime.emit(); }
      throw error;
    }).finally(() => { if (abort) signal?.removeEventListener('abort', abort); if (this.connecting?.promise === promise) this.connecting = undefined; });
    this.connecting = { session, promise }; return promise;
  }
  connectRuntimeDevice(session: RuntimeDevice, identity?: Identity) { return connectRuntimeDevice.call(this, session, identity); }
  historyPages = new WeakMap<Room, number>();
  historyPreloads = new WeakMap<Room, Promise<void>>();
  preloadHistory() { return preloadHistory.call(this); }
  historyPage?: { client: MatrixClient; events: Set<MatrixEvent> };
  historyQueue: Promise<void> = Promise.resolve();
  history(room: Room) { return history.call(this, room); }

  refresh(domains: readonly RefreshDomain[] = ['account']) { return refresh.call(this, domains); }
  requestRefresh(domains: readonly RefreshDomain[] = ['account']) { return requestRefresh.call(this, domains); }
  accountChanged(at: number) { return accountChanged.call(this, at); }
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
      if (intent.accountId) jobs.push(runtime.storage.clearAccount(intent.accountId, intent.preservePreferences), clearBrowserAccount(intent.accountId, intent.preservePreferences));
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
    this.liveDispose?.(); this.liveDispose = undefined; this.liveOpen = false; this.refreshQueued.clear();
    clearTimeout(this.deviceStateTimer); this.deviceStateTimer = undefined; this.reportedDeviceState = undefined; this.deviceStateFailures = 0;
    const old = this.session ?? this.pendingDevice; this.session = undefined; runtime.api.token = undefined;
    const client = this.client; this.client = undefined; client?.stopClient();
    this.scheduleCleanup(old, preservePreferences, client);
    this.connecting = undefined; this.refreshing = undefined; this.cryptoOpening = undefined;
    runtime.timeline.reset(); runtime.sending.reset(); runtime.sharing.reset(); runtime.cache.reset(); runtime.interactions.reset();
    runtime.dispatch.mutations.clear(); runtime.state.sendQueue = undefined;
    this.mnemonic = undefined; this.pendingIdentity = undefined; this.pendingDevice = undefined;
    this.cryptoInitialised = false; this.snapshotAt = 0; this.snapshotReadAt = 0; this.changedAt = 0; this.maintenanceFailures = 0; this.maintenanceRetryAt = 0; this.directoryExpiresAt = 0; this.authMode = undefined;
    const config = runtime.state.config;
    runtime.state = { ...emptyState(), revision: runtime.state.revision, ready: true, config, pokes: undefined };
    runtime.emit();
    if (!await this.cleanup.flush() && scope.current()) { runtime.state.error = uiMessage('extension.runtime.deviceCleanupPending'); runtime.emit(); }
  }
}
