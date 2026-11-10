import type { RuntimeDevice } from './device';
import type { SessionRuntime } from './session-lifecycle';
import { refreshLobbyApplications } from '../teams/command-handlers';
import { clientVersion } from '../transport/api';
export type RefreshDomain = 'account' | 'blocks' | 'invites';
export const refreshDomains: RefreshDomain[] = ['account', 'blocks', 'invites'];

export async function refresh(this: SessionRuntime, domains: readonly RefreshDomain[] = ['account']): Promise<void> {
    if (!this.session) return;
    for (const domain of domains) this.refreshQueued.add(domain);
    if (this.refreshing) return this.refreshing;
    const scope = this.scope();
    const promise = (async () => {
      let failure: unknown;
      do {
        const queued = this.refreshQueued; this.refreshQueued = new Set();
        if (queued.has('account')) this.changedAt = 0;
        await Promise.all([
          ...(queued.has('account') ? [this.fetchSnapshot().catch(error => { failure = error; })] : []),
          ...(queued.has('blocks') ? [this.runtime.rooms.blocks().catch(() => {})] : []),
          ...(queued.has('invites') ? [this.runtime.rooms.invites(true).catch(() => {})] : []),
        ]);
        scope.check();
        // A change pushed while that read was in flight, and not proven to be in it, needs one more read.
        if (this.changedAt > this.snapshotReadAt) { this.refreshQueued.add('account'); this.refreshQueued.add('blocks'); }
        this.changedAt = 0;
      } while (this.refreshQueued.size);
      if (failure) throw failure;
    })().finally(() => { if (this.refreshing === promise) this.refreshing = undefined; });
    this.refreshing = promise; return promise;
  }

/** The service pushed a change to this account at service time `at`: read again unless a snapshot already holds it. */
export function accountChanged(this: SessionRuntime, at: number) {
    if (at <= this.snapshotReadAt) return;
    if (this.refreshing) { this.changedAt = Math.max(this.changedAt, at); return; }
    this.requestRefresh(['account', 'blocks']);
  }

export function requestRefresh(this: SessionRuntime, domains: readonly RefreshDomain[] = ['account']) {
    void this.refresh(domains).catch(() => {});
  }

export function scheduleDeviceStateReport(this: SessionRuntime, force = false) {
    if (!this.session || !force && this.reportedDeviceState === this.deviceState) return;
    clearTimeout(this.deviceStateTimer);
    this.deviceStateTimer = setTimeout(() => {
      this.deviceStateTimer = undefined;
      void this.reportDeviceState(force).catch(() => {});
    }, force ? 0 : 2_000);
  }

export async function reportDeviceState(this: SessionRuntime, force = false) {
    const runtime = this.runtime;
    const scope = this.scope();
    const session = this.session;
    const state = this.deviceState;
    if (!session || !force && this.reportedDeviceState === state) return;
    try {
      await scope.wait(runtime.api.request('presence.update', { body: { state } }));
      if (this.session !== session) return;
      this.reportedDeviceState = state;
      if (this.deviceState !== state) this.scheduleDeviceStateReport();
    } catch { scope.check();
      // The next state change or live reconnect retries the presence report.
    }
  }

export type LiveStartup = { initialIssued: boolean; roomsStarted: boolean; roomCatchUp: boolean };
export function startLiveSync(auth: SessionRuntime, session: RuntimeDevice, current: () => boolean, status: LiveStartup) {
  const runtime = auth.runtime;
  // Every request of this device rides the socket from now on; a later session's link is never cleared by this one ending.
  const link = runtime.api.live.attach();
  let opened = false;
  const stop = auth.connectLiveEvents({
      baseUrl: runtime.api.baseUrl,
      onChannel: channel => link.ready(channel && current() ? channel : undefined),
      token: () => current() ? session.token : undefined,
      onUnauthorized: () => { if (current()) void auth.expireRuntimeDevice().catch(() => {}); },
      version: clientVersion, onOutdated: () => { if (current()) runtime.api.onOutdated?.(); },
      onRefresh: refresh => { if (current() && status.initialIssued && refresh.scope === 'me') { auth.accountChanged(refresh.at); void refreshLobbyApplications(runtime.dispatch).catch(() => {}); } },
      onState: open => {
        if (!current()) return;
        auth.presenceVersion++; auth.liveOpen = open;
        if (open) {
          // Reads wait for the socket, so the first one of a session already sees every change after it; a reconnect may have missed
          // pushes and reads everything again.
          const reconnected = opened; opened = true;
          if (status.initialIssued && reconnected) auth.requestRefresh(refreshDomains);
          if (status.initialIssued) void runtime.wallet.refresh().catch(() => {});
          runtime.directory.resume();
          if (status.roomsStarted) { auth.scheduleDeviceStateReport(true); runtime.rooms.reconnected(); }
          else status.roomCatchUp = true;
        } else {
          runtime.state.data.people = runtime.state.data.people.map(person => ({ ...person, presence: undefined }));
          runtime.emit();
        }
      },
      onTeamInvites: () => { if (current() && status.initialIssued) auth.requestRefresh(['invites']); },
      onRoom: event => { if (current()) runtime.rooms.consume(event); },
      onTokens: entries => { if (current()) runtime.directory.push(entries); },
      onChainConfig: config => { if (current()) void runtime.wallet.event({ type: 'config', config }).catch(() => {}); },
      onChain: event => { if (current()) void runtime.wallet.event(event).catch(() => {}); },
      onBanned: ban => {
        if (!current()) return;
        void auth.clearDevice(false).then(() => { runtime.state.banned = ban; runtime.emit(); }).catch(() => {});
      },
      onPresence: (account, presence) => {
        if (!current()) return;
        auth.snapshotPresence?.set(account, presence);
        runtime.state.data.people = runtime.state.data.people.map(person => person.id === account ? { ...person, presence: presence === 'offline' ? undefined : presence } : person);
        runtime.emit();
      },
    });
  return () => { stop(); link.detach(); };
}
