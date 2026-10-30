import type { RuntimeDevice } from './device';
import type { SessionRuntime } from './session-lifecycle';
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
        await Promise.all([
          ...(queued.has('account') ? [this.fetchSnapshot().catch(error => { failure = error; })] : []),
          ...(queued.has('blocks') ? [this.runtime.rooms.blocks().catch(() => {})] : []),
          ...(queued.has('invites') ? [this.runtime.rooms.invites(true).catch(() => {})] : []),
        ]);
        scope.check();
      } while (this.refreshQueued.size);
      if (failure) throw failure;
    })().finally(() => { if (this.refreshing === promise) this.refreshing = undefined; });
    this.refreshing = promise; return promise;
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
      // The next state change or SSE reconnect retries the presence report.
    }
  }

export type LiveStartup = { initialIssued: boolean; roomsStarted: boolean; roomCatchUp: boolean };
export function startLiveSync(auth: SessionRuntime, session: RuntimeDevice, current: () => boolean, status: LiveStartup) {
  const runtime = auth.runtime;
  return auth.connectLiveEvents({
      baseUrl: runtime.api.baseUrl,
      token: () => current() ? session.token : undefined,
      onRefresh: refreshScope => { if (current() && status.initialIssued && refreshScope === 'me') auth.requestRefresh(['account', 'blocks']); },
      onState: open => {
        if (!current()) return;
        auth.presenceVersion++; auth.sseOpen = open;
        if (open) {
          if (status.initialIssued) { auth.requestRefresh(refreshDomains); void runtime.wallet.refresh().catch(() => {}); }
          if (status.roomsStarted) { auth.scheduleDeviceStateReport(true); runtime.rooms.reconnected(); }
          else status.roomCatchUp = true;
        } else {
          runtime.state.data.people = runtime.state.data.people.map(person => ({ ...person, presence: undefined }));
          runtime.emit();
        }
      },
      onTeamInvites: () => { if (current() && status.initialIssued) auth.requestRefresh(['invites']); },
      onRoom: event => { if (current()) runtime.rooms.consume(event); },
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
}
