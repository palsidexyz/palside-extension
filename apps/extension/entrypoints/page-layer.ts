import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { browser } from 'wxt/browser';
import { startPageLayer } from '../src/page-layer';

export default defineUnlistedScript(() => {
  const key = '__palsidePageLayer';
  const scope = globalThis as typeof globalThis & { [key]?: boolean };
  // The flag only marks a running layer: once it stops, the next injection (quote, mark, capture) starts a fresh one.
  const start = () => {
    scope[key] = true;
    const startedAt = Date.now();
    let port: ReturnType<typeof browser.runtime.connect>;
    try { port = browser.runtime.connect({ name: 'palside/page' }); } catch { scope[key] = false; return; }
    startPageLayer(port, reason => {
      scope[key] = false;
      // Chrome restarts an idle background on its own; that drop is not a decision to leave the page, so reconnect once
      // the layer had settled. An immediate drop means the background turned the page away.
      if (reason === 'disconnect' && Date.now() - startedAt > 5_000) setTimeout(() => { if (!scope[key] && browser.runtime?.id) start(); }, 1_000);
    });
  };
  if (!scope[key]) start();
});
