import { DEVICE_IDLE_SECONDS } from '@palside/shared/rules/accounts';
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
      const idle = await bg.browser.idle.queryState(DEVICE_IDLE_SECONDS);
      if (version !== replayVersion) return;
      await bg.run({ name: 'device-state', payload: { state: bg.panels.size > 0 || idle === 'active' ? 'active' : 'away' } });
      if (version !== replayVersion) return;
      await bg.sharing.observer.replay();
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
    const interactionChanged = JSON.stringify(previous?.preferences.siteInteraction ?? null) !== JSON.stringify(next.preferences.siteInteraction ?? null);
    const roomChanged = previous?.preferences.rooms?.off !== next.preferences.rooms?.off || previous?.rooms?.current?.key !== next.rooms?.current?.key;
    const policyChanged = contextChanged || interactionChanged || roomChanged;
    if ((interactionChanged || roomChanged) && !contextChanged) {
      void bg.danmaku.broadcastDanmakuSettings().then(bg.signals.broadcastSignals).catch(() => {});
    }
    const pageChanged = previous?.data.views !== next.data.views || previous?.data.messages !== next.data.messages || previous?.drafts !== next.drafts || previous?.pages !== next.pages;
    if (policyChanged) bg.pages.pagePolicyChanged(contextChanged);
    if (policyChanged || pageChanged) bg.pages.restoreAllPages();
    const pageContentChanged = pageChanged || previous?.chainRoom !== next.chainRoom || previous?.rooms !== next.rooms || previous?.data.people !== next.data.people || previous?.remoteTeams !== next.remoteTeams;
    if (policyChanged || pageContentChanged) bg.pages.routePageState();
    if (policyChanged || previous?.signals !== next.signals) void bg.signals.routeSignals(previous, next).catch(() => {});
    if (policyChanged || previous?.chartMarks !== next.chartMarks || previous?.chartDrawings !== next.chartDrawings || previous?.remoteTeams !== next.remoteTeams) void bg.signals.routeMarks().catch(() => {});
    if (policyChanged || pageChanged || previous?.followers !== next.followers || previous?.publishedViewing !== next.publishedViewing) void bg.follow.routeLead().catch(() => {});
    if (previous?.leadScrolls !== next.leadScrolls) bg.follow.routeScroll();
    if (previous?.leadTabs !== next.leadTabs) void bg.follow.routeTabs().catch(() => {});
    if (policyChanged || pageChanged) void bg.pages.pushPageStatus();
    bg.notifications.notificationState(previous, next);
    bg.updates.stateChanged(previous, next);
    if (contextChanged || pageChanged || previous?.tokens !== next.tokens) void bg.roomTab.refresh();
    else if (previous?.rooms !== next.rooms) bg.roomTab.stateChanged(next);
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
