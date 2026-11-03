import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function events() { const handlers = []; return { addListener(fn) { handlers.push(fn); }, emit(value) { handlers.forEach(fn => fn(value)); } }; }
test('panel reconnect backs off to 5 seconds, pauses while hidden, and resets after state delivery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const document = new EventTarget(); document.visibilityState = 'visible';
  const window = new EventTarget(); const attempts = [], ports = []; let failing = true;
  const browser = { windows: { getCurrent: async () => ({ id: 1 }) }, runtime: { connect() { attempts.push(Date.now()); if (failing) throw Error('offline'); const port = { onMessage: events(), onDisconnect: events(), postMessage() {}, disconnect() {} }; ports.push(port); return port; } } };
  const { observeState } = productionModules({ browser, document, window, setTimeout, clearTimeout })('apps/extension/src/runtime/transport/bridge.ts');
  const stop = observeState(Object.fromEntries(['onState', 'onError', 'onLanguage', 'onDisconnect', 'onPage', 'onCaptured', 'onDanmaku'].map(key => [key, () => {}])));
  for (const delay of [500, 1000, 2000, 4000, 5000]) { t.mock.timers.tick(delay); await drain(); }
  assert.deepEqual(attempts, [0, 500, 1500, 3500, 7500, 12500]);
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(20000); await drain(); assert.equal(attempts.length, 6);
  failing = false; document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await drain(); assert.equal(attempts.length, 7);
  ports[0].onMessage.emit({ type: 'state', state: {} }); ports[0].onDisconnect.emit();
  t.mock.timers.tick(499); await drain(); assert.equal(attempts.length, 7);
  t.mock.timers.tick(1); await drain(); assert.equal(attempts.length, 8);
  stop(); t.mock.timers.tick(20000); await drain(); assert.equal(attempts.length, 8);
});
test('openPage requests always use the reusable-page route without a reuse option', async () => {
  const sent = [];
  const { openPage } = productionModules({ browser: { runtime: { sendMessage: async value => { sent.push(value); return { ok: true }; } } } })('apps/extension/src/runtime/transport/bridge.ts');
  await openPage('https://example.com'); assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'palside/open', url: 'https://example.com' }]);
});
