import type { PageLabels,PageUp } from '../runtime/browser/page-protocol';
import { createOverlayHost } from './overlay-host';
import { createDanmakuRenderer } from './danmaku-renderer';
import { createCaptureHost } from './capture-host';

export type Overlay = ReturnType<typeof createOverlay>;
export function createOverlay(send: (message: PageUp) => void) {
  const context = createOverlayHost();
  const { host, stage, timers } = context;
  const danmaku = createDanmakuRenderer(context, send);
  const capture = createCaptureHost(stage, send);
  return {
    host, stage, isControl: context.isControl, onPageChange: context.onPageChange,
    setLabels(next: PageLabels) { context.labels = { ...context.labels, ...next }; },
    setDanmakuSettings: danmaku.setDanmakuSettings,
    updateDanmaku: danmaku.update, removeDanmaku: danmaku.remove, updatePayments: danmaku.updatePayments,
    startCapture: capture.startCapture, stopCapture: capture.stopCapture,
    clear() {
      timers.forEach(timer => window.clearTimeout(timer)); timers.clear();
      danmaku.clear();
      stage.replaceChildren(danmaku.area); capture.stopCapture();
    },
    stop() {
      if (context.disposed) return;
      this.clear(); context.disposed = true;
      danmaku.dispose(); context.stopPageChanges(); host.remove();
    },
  };
}
