import type { PageDown,PageLabels,PageUp } from '../runtime/browser/page-protocol';
import { createOverlay } from './overlay';
import { defaultLabels } from './overlay-host';
import { createPicker } from './picker';
import { createSignals } from './signals';
import { browser } from 'wxt/browser';

/** Connect the page layer to the background port and route every PageDown variant. */
export function startPageLayer(port: {
  postMessage: (message: PageUp) => void;
  onMessage: { addListener: (listener: (message: PageDown) => void) => void; removeListener?: (listener: (message: PageDown) => void) => void };
  onDisconnect?: { addListener: (listener: () => void) => void; removeListener?: (listener: () => void) => void };
}, onStop?: (reason: 'off' | 'disconnect') => void) {
  let configured = false, capturing = false;
  const send = (message: PageUp) => {
    if (message.type === 'captured' || message.type === 'capture-cancel') { capturing = false; picker.enable(configured); signals.suspend(false); }
    try {
      port.postMessage(message);
    } catch {
      // The disconnect listener performs final cleanup.
    }
  };
  let labels: PageLabels = { ...defaultLabels };
  let lastUrl = location.href;
  const overlay = createOverlay(send);
  const picker = createPicker(overlay, send);
  const signals = createSignals(send, (browser.runtime.getURL as (path: string) => string)('signals/'));

  send({ type: 'url', url: lastUrl });

  const navigation = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    picker.invalidate();
    signals.clear(); signals.suspend(true);
    capturing = false;
    overlay.clear();
    picker.enable(configured);
    send({ type: 'url', url: lastUrl });
  };
  const poll = window.setInterval(navigation, 500);
  addEventListener('popstate', navigation);

  let stopped = false;
  const off = (reason: 'off' | 'disconnect') => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(poll);
    removeEventListener('popstate', navigation);
    signals.dispose();
    picker.dispose();
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
    } else if (message.type === 'signal') {
      void signals.receive(message.item, message.author);
    } else if (message.type === 'signal-result') {
      signals.result(message.requestId, message.ok, message.error);
    } else if (message.type === 'config') {
      labels = message.labels;
      overlay.setLabels(labels);
      overlay.setDanmakuSettings(message.danmaku);
      configured = true;
      picker.enable(!capturing);
    } else if (message.type === 'clear') {
      signals.clear();
      picker.invalidate();
      overlay.clear();
    } else if (message.type === 'danmaku') {
      overlay.updateDanmaku(message.items);
    } else if (message.type === 'room-payments') {
      overlay.updatePayments(message);
    } else if (message.type === 'danmaku-remove') {
      overlay.removeDanmaku(message.ids);
    } else if (message.type === 'stickies') {
      overlay.updateStickies(message.items);
    } else if (message.type === 'flash') {
      overlay.showFlash(message.target, message.author, message.requestId, message.focus);
    } else if (message.type === 'pick') {
      picker.set(message.on, message.canSticky !== false, message.contextId);
    } else if (message.type === 'selection-enabled') {
      picker.setSelectionEnabled(message.on);
    } else if (message.type === 'pick-result') {
      picker.result(message);
    } else if (message.type === 'capture') {
      capturing = true;
      signals.suspend(true);
      picker.enable(false);
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
