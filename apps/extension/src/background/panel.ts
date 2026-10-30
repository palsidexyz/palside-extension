import { errorMessage,message as uiMessage } from '@palside/i18n';
import type { Reply } from '../runtime/transport/reply';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

/**
 * A side panel on the `palside/panel` port: it announces its window in `hello`, receives state, language, danmaku settings and
 * page status, and reports activity. A restarted worker takes its first state from the offscreen snapshot.
 */
export function panel(bg: Background) {
  const { browser } = bg;
  let roomPanels: Promise<unknown> = Promise.resolve();
  function reportRoomPanels() {
    roomPanels = roomPanels.catch(() => {}).then(() => bg.run({ name: 'room-panels', payload: { connected: bg.panels.size > 0 } }));
    void roomPanels.catch(() => {});
    return roomPanels;
  }

  function sendSnapshot(port: Port, result: Reply) {
    if (result.ok) bg.state ??= result.value as RuntimeState;
    return bg.post(port, result.ok ? { type: 'state', state: bg.state } : { type: 'error', message: result.text ?? errorMessage(result) });
  }

  return {
    reportRoomPanels,
    connectPanel(port: Port) {
      if (port.sender?.id !== browser.runtime.id || port.sender?.tab || !bg.extensionPage(port.sender?.url, '/sidepanel.html')) return;
      /** Activity announced before the first state arrived; the snapshot applies it. */
      let pendingActivity = false;
      bg.panels.set(port, undefined);
      reportRoomPanels();
      bg.danmaku.sendDanmakuSettings(port);
      bg.sharing.updateDeviceState();
      void bg.language.refresh().then(value => { if (bg.panels.has(port)) bg.post(port, { type: 'language', state: value }); });

      port.onMessage.addListener(message => {
        if (message.type === 'hello' && Number.isInteger(message.windowId)) {
          // 网页互动 pauses in a window without a panel and resumes when one opens there.
          const opened = ![...bg.panels.values()].includes(message.windowId);
          bg.panels.set(port, message.windowId);
          void bg.roomTab.refresh();
          if (opened) bg.pages.pagePolicyChanged(false);
          bg.stickies.deliverPendingSticky(port, message.windowId);
          bg.sharing.updateDeviceState();
          pendingActivity ||= !bg.state && message.activity === true;
          void bg.sharing.observer.refresh(message.activity === true);
          void bg.pages.pushPageStatus();
          void bg.pages.restoreActivePage(message.windowId).catch(() => {});
          bg.capture.panelReady(port, message.windowId);
        }
        if (message.type === 'resync') {
          if (bg.state) bg.post(port, { type: 'state', state: bg.state });
          else void bg.run({ name: 'snapshot' }).then(result => { if (bg.panels.has(port)) sendSnapshot(port, result); });
        }
        if (message.type === 'activity' && bg.state?.authenticated) {
          const windowId = bg.panels.get(port);
          if (windowId !== undefined) void browser.windows.get(windowId).then(window => {
            if (window.focused && bg.sharing.observationPolicy()) return bg.run({ name: 'page', payload: { activity: true } });
          });
        }
      });
      port.onDisconnect.addListener(() => {
        const windowId = bg.panels.get(port);
        bg.panels.delete(port);
        void bg.roomTab.refresh();
        reportRoomPanels();
        bg.sharing.updateDeviceState();
        if (windowId !== undefined) {
          const lastForWindow = ![...bg.panels.values()].includes(windowId);
          if (bg.capture.captures.get(windowId)?.panel === port || lastForWindow) bg.capture.discardCapture(windowId);
          if (lastForWindow) { bg.selection.resetWindowSelection(windowId); bg.pages.pagePolicyChanged(false); }
        }
        if (port.sender?.documentId) {
          void bg.run({ name: 'visible-drop', payload: { panel: port.sender.documentId } }).catch(() => {});
          void bg.run({ name: 'wallet-panel-drop', payload: { owner: port.sender.documentId } }).catch(() => {});
        }
        void bg.sharing.observer.refresh();
      });

      void bg.run({ name: 'snapshot' }).then(async result => {
        reportRoomPanels();
        if (!bg.panels.has(port)) return;
        // A newer broadcast wins over a late snapshot, including logout and pause.
        const restoring = !bg.state;
        if (!sendSnapshot(port, result) || !result.ok || !restoring && !pendingActivity) return;
        const windowId = bg.panels.get(port);
        const activity = pendingActivity;
        pendingActivity = false;
        const window = activity && windowId !== undefined ? await browser.windows.get(windowId) : undefined;
        if (!bg.panels.has(port) || bg.panels.get(port) !== windowId) return;
        // A restarted worker has no page policy until it accepts the snapshot.
        if (restoring) {
          void bg.roomTab.refresh();
          void bg.pages.registerPageLayer().catch(() => {});
          void bg.pages.pushPageStatus();
          if (windowId !== undefined) void bg.pages.restoreActivePage(windowId).catch(() => {});
        }
        // Reconnecting ports send activity=false and must never reclaim device selection.
        await bg.sharing.observer.refresh(activity && window?.focused === true, true);
      }).catch(() => { bg.post(port, { type: 'error', message: uiMessage('common.connectionLost') }); });
    },
  };
}
