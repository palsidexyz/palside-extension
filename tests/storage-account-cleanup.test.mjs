import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';

test('account cleanup removes signal settings and notification records only for that account', async () => {
  const values = { 'palside:signal-settings:alice': { volume: 0.2 }, 'palside:signal-settings:bob': { volume: 0.7 }, 'palside:alice:$message': { accountId: 'alice' }, 'palside:bob:$message': { accountId: 'bob' }, 'palside:language': 'en' };
  const browser = { storage: { local: { get: async keys => keys === null ? { ...values } : Object.fromEntries(keys.map(key => [key, values[key]])), remove: async key => { delete values[key]; } } }, permissions: { contains: async () => false } };
  const load = productionModules();
  const { signals } = load('apps/extension/src/background/signals.ts');
  const { notifications } = load('apps/extension/src/background/notifications.ts');
  const bg = { browser };
  await signals(bg).clearAccount('alice'); await notifications(bg).clearAccount('alice');
  assert.deepEqual(Object.keys(values).sort(), ['palside:bob:$message', 'palside:language', 'palside:signal-settings:bob']);
});
test('browser cleanup forwards the sign-out preference policy and rejects unacknowledged cleanup', async () => {
  const requests = []; let ok = true;
  const { clearBrowserAccount } = productionModules({ browser: { runtime: { id: "palside-test", sendMessage: async value => { requests.push(value); return { ok }; } } } })('apps/extension/src/runtime/browser/account-cleanup.ts');
  await clearBrowserAccount('alice', true); await clearBrowserAccount('alice', false);
  assert.deepEqual(requests.map(value => value.preservePreferences), [true, false]);
  ok = false; await assert.rejects(clearBrowserAccount('alice', false), /cleanup failed/);
});

test('browser cleanup has no Chrome-owned storage in a web host', async () => {
  const source = await import('../apps/extension/src/runtime/browser/account-cleanup.ts');
  await source.clearBrowserAccount('alice', false);
});
test('session cleanup keeps its durable intent until browser account cleanup is acknowledged', async () => {
  let fail = true; const calls = [], values = new Map();
  const { SessionRuntime } = productionModules({ clearBrowserAccount: async (account, preserve) => { calls.push([account, preserve]); if (fail) throw Error('worker unavailable'); } })('apps/extension/src/runtime/account/session-lifecycle.ts');
  const runtime = { storage: { put: async (key, _account, _kind, value) => values.set(key, value), remove: async key => { values.delete(key); }, clearAccount: async () => {} } };
  const auth = new SessionRuntime(runtime);
  auth.resumeCleanup({ accountId: 'alice', preservePreferences: false });
  assert.equal(await auth.cleanup.flush(), false); assert.ok(values.has('device-cleanup'));
  fail = false; assert.equal(await auth.cleanup.flush(), true); assert.equal(values.has('device-cleanup'), false);
  assert.deepEqual(calls, [['alice', false], ['alice', false]]);
});
