import { errorMessage, message as uiMessage, MessageError } from '@palside/i18n';
import { browser } from 'wxt/browser';
import { PalsideService } from '../../src/runtime/composition/core';
import type { Command } from '../../src/runtime/transport/command-map';
import type { Reply } from '../../src/runtime/transport/reply';
import { createPatchSliceCache, diffState } from '../../src/runtime/transport/state-diff';
const service = new PalsideService(async payload => { await browser.runtime.sendMessage({ type: 'palside/notify', payload }); }, async url => { try { const result = await browser.runtime.sendMessage({ type: 'palside/foreground', url }); return result?.visible === true; } catch { return false; } }, undefined, async request => {
  try { const result = await browser.runtime.sendMessage({ type: 'palside/token-page', request }); return result?.metadata; } catch { return; }
});
const epoch = crypto.randomUUID();
let starting: Promise<void> | undefined;
let started = false;
let announcedReset = -1;
function announceReady() {
  announcedReset = service.auth.hostEpoch;
  sendState(service.state, true);
  return browser.runtime.sendMessage({ type: 'palside/runtime-ready', epoch: `${epoch}:${announcedReset}` });
}
function start() {
  starting ??= service.initialise().then(async () => {
    started = true;
    await announceReady();
  }).catch(error => {
    starting = undefined;
    void browser.runtime.sendMessage({ type: 'palside/runtime-error', message: uiMessage('extension.runtime.runtimeStartFailed') }).catch(() => {});
    throw error;
  });
  return starting;
}
const patchCache = createPatchSliceCache();
let sentState: typeof service.state | undefined;
let queuedState: typeof service.state | undefined;
let flushScheduled = false;
function sendState(state: typeof service.state, full = false) {
  if (full) queuedState = undefined;
  const patch = diffState(full ? undefined : sentState, state, patchCache);
  sentState = state;
  void browser.runtime.sendMessage({ type: 'palside/state-patch', patch }).catch(() => {});
}
function scheduleState(state: typeof service.state) {
  queuedState = state;
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    const next = queuedState;
    queuedState = undefined;
    if (next && (!sentState || next.revision > sentState.revision)) sendState(next);
  }, 0);
}
service.subscribe(state => {
  scheduleState(state);
  if (started && announcedReset !== service.auth.hostEpoch) void announceReady().catch(() => {});
});
browser.runtime.onMessage.addListener((message, sender, respond) => {
  const background = sender.id === browser.runtime.id && !sender.tab && (!sender.url || sender.url === browser.runtime.getURL('/background.js'));
  if (!background) return;
  if (message?.type === 'palside/state-resync') {
    sendState(service.state, true);
    return;
  }
  if (sender.id !== browser.runtime.id || sender.tab || message?.target !== 'palside/offscreen') return;
  const command = message.command as Command | undefined;
  if (!command || typeof command.name !== 'string') return;
  void start().then(() => service.command(command)).then(value => respond({ ok: true, value } satisfies Reply), error => {
    if (!(error instanceof MessageError)) console.error('[palside]', error);
    respond({ ok: false, message: 'Action failed', text: errorMessage(error), code: typeof error?.code === 'string' ? error.code : undefined, ...Object.fromEntries(['lockedUntil', 'retryAfterMs', 'remaining'].filter(key => typeof error?.[key] === 'number' && Number.isFinite(error[key])).map(key => [key, error[key]])) } satisfies Reply);
  });
  return true;
});
sendState(service.state, true);
void start().catch(() => {});

window.addEventListener('online', () => service.networkChanged(true));
window.addEventListener('offline', () => service.networkChanged(false));
