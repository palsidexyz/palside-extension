import { pageTeam } from '../runtime/browser/page-layer-host.ts';
import { applyPatch,type StatePatch } from '../runtime/transport/state-patch.ts';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import type { Background } from './index.ts';

/**
 * The offscreen runtime owns the state; the worker keeps the latest copy, relays it to every panel, and derives its page,
 * sharing, image and notification policies from each change.
 */
export function stateSync(bg: Background) {
  let resyncPending = false;
  let epoch: string | undefined;
  let replayVersion = 0;
  let replaying = Promise.resolve();

  function replayHost() {
    const version = ++replayVersion;
    bg.roomTab.invalidate();
    replaying = replaying.catch(() => {}).then(async () => {
      if (version !== replayVersion) return;
      await bg.run({ name: 'room-panels', payload: { connected: false } });
      if (version !== replayVersion) return;
      await bg.roomTab.refresh();
      const idle = await bg.browser.idle.queryState(60);
      if (version !== replayVersion) return;
      await bg.run({ name: 'device-state', payload: { state: bg.panels.size > 0 || idle === 'active' ? 'active' : 'away' } });
      if (version !== replayVersion) return;
      await bg.sharing.observer.refresh(false);
      if (version === replayVersion) await bg.panel.reportRoomPanels();
    });
    void replaying.catch(() => {});
  }

  function requestStateResync() {
    if (resyncPending) return;
    resyncPending = true;
    void bg.browser.runtime.sendMessage({ type: 'palside/state-resync' }).catch(() => { resyncPending = false; });
  }

  function acceptState(next: RuntimeState, patch?: StatePatch) {
    if (patch) resyncPending = false;
    const previous = bg.state, sharingBefore = bg.sharing.observationPolicy()?.key;
    bg.state = next;
    if (previous && (previous.account?.id !== next.account?.id || previous.authenticated !== next.authenticated)) replayHost();
    if (previous?.account?.id !== next.account?.id || previous?.authenticated !== next.authenticated || !next.authenticated) bg.images.clearImageSessions();
    for (const port of bg.panels.keys()) bg.post(port, patch ? { type: 'state-patch', patch } : { type: 'state', state: next });
    if (sharingBefore !== bg.sharing.observationPolicy()?.key) bg.sharing.sharingPolicyChanged();

    const contextChanged = pageTeam(previous) !== pageTeam(next) || previous?.authenticated !== next.authenticated || previous?.account?.id !== next.account?.id || previous?.preferences.current !== next.preferences.current;
    const interactionChanged = JSON.stringify(previous?.preferences.interaction ?? null) !== JSON.stringify(next.preferences.interaction ?? null);
    const interacting = (state: RuntimeState | undefined) => Boolean(state?.preferences.web.interact && state.toggles.interact);
    const roomChanged = previous?.preferences.rooms?.off !== next.preferences.rooms?.off || previous?.preferences.web.interact !== next.preferences.web.interact || previous?.rooms?.current?.key !== next.rooms?.current?.key;
    const policyChanged = contextChanged || interactionChanged || roomChanged || interacting(previous) !== interacting(next);
    if ((interactionChanged || roomChanged) && !contextChanged) {
      void bg.danmaku.broadcastDanmakuSettings().then(bg.signals.broadcastSignals).then(() => { for (const [port, info] of bg.pages.pagePorts) void bg.stickies.pushStickies(port, info); }).catch(() => {});
    }
    const pageChanged = previous?.data.views !== next.data.views || previous?.data.messages !== next.data.messages || previous?.drafts !== next.drafts;
    if (policyChanged) bg.pages.pagePolicyChanged(contextChanged);
    if (policyChanged || pageChanged || previous?.items.stickies !== next.items.stickies) bg.pages.restoreAllPages();
    const pageContentChanged = pageChanged || previous?.items.stickies !== next.items.stickies || previous?.chainRoom !== next.chainRoom || previous?.rooms !== next.rooms || previous?.data.people !== next.data.people || previous?.remoteTeams !== next.remoteTeams || previous?.preferences.hiddenStickies !== next.preferences.hiddenStickies;
    if (policyChanged || pageContentChanged) void bg.pages.routePageState(previous, next);
    if (policyChanged || previous?.signals !== next.signals) void bg.signals.routeSignals(previous, next).catch(() => {});
    if (policyChanged || pageChanged) void bg.pages.pushPageStatus();
    bg.notifications.notificationState(previous, next);
    if (contextChanged || pageChanged) void bg.roomTab.refresh();
  }

  return {
    acceptState,
    runtimeReady(value: unknown) {
      if (typeof value !== 'string' || !value || value === epoch) return;
      epoch = value; resyncPending = false;
      replayHost();
    },
    /** A patch applies only on top of the revision it was made from; otherwise the full state is asked for again. */
    acceptPatch(patch: StatePatch | undefined) {
      if (!patch || typeof patch.revision !== 'number' || patch.base !== undefined && patch.base !== bg.state?.revision) { requestStateResync(); return; }
      acceptState(applyPatch(bg.state, patch), patch);
    },
  };
}
