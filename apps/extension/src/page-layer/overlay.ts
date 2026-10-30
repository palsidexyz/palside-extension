import type { PageLabels,PageUp } from '../runtime/browser/page-protocol';
import { createOverlayHost } from './overlay-host';
import { createDanmakuRenderer } from './danmaku-renderer';
import { createReferenceOutline } from './reference-outline';
import { createStickyProjection } from './sticky-projection';
import { createSelectionMenu } from './selection-menu';
import { createCaptureHost } from './capture-host';
import { invalidateTargets } from './targets';

export type Overlay = ReturnType<typeof createOverlay>;
export function createOverlay(send: (message: PageUp) => void) {
  const context = createOverlayHost();
  const { host, stage, timers } = context;
  const danmaku = createDanmakuRenderer(context, send);
  const reference = createReferenceOutline(context, send);
  const stickies = createStickyProjection(context, send, danmaku.scheduleArea);
  const selection = createSelectionMenu(context, send);
  const capture = createCaptureHost(stage, send);
  return {
    host, stage, isControl: context.isControl,
    setLabels(next: PageLabels) { context.labels = { ...context.labels, ...next }; },
    setDanmakuSettings: danmaku.setDanmakuSettings,
    showFlash: reference.show,
    updateStickies: stickies.updateStickies,
    setPicking: danmaku.setPicking,
    showSelection: selection.showSelection, repositionSelection: selection.repositionSelection,
    showSavedMark: selection.showSavedMark, hideSelection: selection.hideSelection, setSelectionPending: selection.setSelectionPending,
    updateDanmaku: danmaku.update, removeDanmaku: danmaku.remove, updatePayments: danmaku.updatePayments,
    startCapture: capture.startCapture, stopCapture: capture.stopCapture,
    clear() {
      invalidateTargets();
      stickies.clear();
      timers.forEach(timer => window.clearTimeout(timer)); timers.clear();
      danmaku.clear(); reference.clear(); selection.clear();
      stage.replaceChildren(danmaku.area); capture.stopCapture();
    },
    stop() {
      if (context.disposed) return;
      this.clear(); context.disposed = true;
      danmaku.dispose(); stickies.dispose(); host.remove();
    },
  };
}
