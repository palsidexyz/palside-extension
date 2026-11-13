import type { PageDown,PageLabels,PageUp } from '../runtime/browser/page-protocol';
import { createOverlay } from './overlay';
import { defaultLabels } from './overlay-host';
import { createSignals } from './signals';
import { createChartMarks } from './chart-marks';
import { browser } from 'wxt/browser';

/** Connect the page layer to the background port and route every PageDown variant. */
export function startPageLayer(port: {
  postMessage: (message: PageUp) => void;
  onMessage: { addListener: (listener: (message: PageDown) => void) => void; removeListener?: (listener: (message: PageDown) => void) => void };
  onDisconnect?: { addListener: (listener: () => void) => void; removeListener?: (listener: () => void) => void };
}, onStop?: (reason: 'off' | 'disconnect') => void) {
  let capturing = false;
  /** 跟看: your first own input in the follow tab pauses following. */
  let followTouch: AbortController | undefined;
  /** 跟看, the followed side: where this page is scrolled, at most every 1.5 s, the last position always sent. */
  let lead: AbortController | undefined;
  const scrollRatio = () => { const room = document.documentElement.scrollHeight - innerHeight; return room > 0 ? Math.min(1, Math.max(0, scrollY / room)) : 0; };
  const send = (message: PageUp) => {
    if (message.type === 'captured' || message.type === 'capture-cancel') { capturing = false; signals.suspend(false); chart.suspend(false); }
    try {
      port.postMessage(message);
    } catch {
      // The disconnect listener performs final cleanup.
    }
  };
  let labels: PageLabels = { ...defaultLabels };
  let lastUrl = location.href;
  const overlay = createOverlay(send);
  const signals = createSignals(send, (browser.runtime.getURL as (path: string) => string)('signals/'), overlay.onPageChange);
  const chart = createChartMarks(send);

  send({ type: 'url', url: lastUrl });

  const navigation = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // A capture ends on any address change, as the background closes it. Signals and highlights wait for the background: it
    // sends `clear` when the address is another page, and keeps them for the same page under another tab or query (`samePage`).
    if (capturing) {
      signals.clear(); signals.suspend(true); chart.clear();
      capturing = false;
      overlay.clear();
    }
    send({ type: 'url', url: lastUrl });
  };
  // Fires as each same-document change commits, whichever world made it, including replaceState with the same address.
  const entries = (window as Window & { navigation?: EventTarget }).navigation!;
  entries.addEventListener('currententrychange', navigation);

  let stopped = false;
  const off = (reason: 'off' | 'disconnect') => {
    if (stopped) return;
    stopped = true;
    entries.removeEventListener('currententrychange', navigation);
    followTouch?.abort(); lead?.abort();
    signals.dispose();
    chart.dispose();
    overlay.stop();
    port.onMessage.removeListener?.(receive);
    port.onDisconnect?.removeListener?.(disconnect);
    onStop?.(reason);
  };

  const receive = (message: PageDown) => {
    if (stopped) return;
    if (message.type === 'signal-config') {
      signals.configure(message.on, message.settings, message.labels);
      signals.suspend(capturing);
    } else if (message.type === 'chart-config') {
      chart.configure(message.on, message.labels);
      chart.suspend(capturing);
    } else if (message.type === 'drawings') {
      chart.setDrawings(message.items, message.people, message.share, message.hideAll, message.intro, message.opened);
    } else if (message.type === 'drawing-result') {
      chart.drawingResult(message.ok, message.error);
    } else if (message.type === 'follow-tab') {
      followTouch?.abort(); followTouch = undefined;
      if (message.on) {
        const watch = followTouch = new AbortController();
        const touched = (event: Event) => { if (!event.isTrusted || watch.signal.aborted) return; watch.abort(); send({ type: 'follow-touch' }); };
        for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(type, touched, { capture: true, passive: true, signal: watch.signal });
      }
    } else if (message.type === 'lead') {
      lead?.abort(); lead = undefined;
      if (message.on) {
        const watch = lead = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined, last = 0, sent = -1;
        const report = () => { timer = undefined; if (watch.signal.aborted) return; const y = Math.round(scrollRatio() * 1e4) / 1e4; if (y === sent) return; sent = y; last = performance.now(); send({ type: 'lead-scroll', y }); };
        window.addEventListener('scroll', () => { if (!timer) timer = setTimeout(report, Math.max(0, last + 1_500 - performance.now())); }, { passive: true, signal: watch.signal });
        watch.signal.addEventListener('abort', () => clearTimeout(timer));
      }
    } else if (message.type === 'scroll-to') {
      const room = document.documentElement.scrollHeight - innerHeight;
      // A follow tab behind another tab does not run a smooth scroll; it jumps there, so it is in place when you switch to it.
      const smooth = document.visibilityState === 'visible' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (room > 0 && Number.isFinite(message.y)) window.scrollTo({ top: Math.round(Math.min(1, Math.max(0, message.y)) * room), behavior: smooth ? 'smooth' : 'auto' });
    } else if (message.type === 'marks') {
      chart.setMarks(message.items);
    } else if (message.type === 'mark-result') {
      chart.result(message.requestId, message.ok, message.error);
    } else if (message.type === 'signal') {
      void signals.receive(message.item, message.author);
    } else if (message.type === 'signal-replay') {
      void signals.replay(message.kind, message.target, message.author).then(result => send({ type: 'located', requestId: message.requestId, result }));
    } else if (message.type === 'drawing-show') {
      void chart.reveal(message.id).then(result => { if (!stopped) send({ type: 'located', requestId: message.requestId, result }); });
    } else if (message.type === 'signal-result') {
      signals.result(message.requestId, message.ok, message.error);
    } else if (message.type === 'config') {
      labels = message.labels;
      overlay.setLabels(labels);
      overlay.setDanmakuSettings(message.danmaku);
    } else if (message.type === 'clear') {
      signals.clear();
      chart.clear();
      overlay.clear();
    } else if (message.type === 'danmaku') {
      overlay.updateDanmaku(message.items);
    } else if (message.type === 'danmaku-remove') {
      overlay.removeDanmaku(message.ids);
    } else if (message.type === 'capture') {
      capturing = true;
      signals.suspend(true); chart.suspend(true);
      overlay.startCapture(message.src, message.labels);

    } else if (message.type === 'off') {
      off('off');
    }
  };
  const disconnect = () => off('disconnect');
  port.onMessage.addListener(receive);
  port.onDisconnect?.addListener(disconnect);
  return () => off('off');
}
