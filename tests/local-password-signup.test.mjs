import { MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test('PoW uses the announced difficulty, waits beyond the network timeout, and reports after 60 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, signing, slow = 0, fetched = 0;
  const { Api } = productionModules({ pathFor: () => '/accounts', setTimeout, clearTimeout, AbortSignal, createHttpAuth: input => { signing = input; return new Promise(resolve => { finish = resolve; }); }, authorizationHeader: () => 'Nostr signed', decodeContract: (_schema, value) => value, fetch: async () => { fetched++; return new Response('{}'); } })('apps/extension/src/runtime/transport/api.ts');
  const controller = new AbortController();
  const request = new Api('https://service.test').request('accounts.create', { secretKey: new Uint8Array(32), body: { label: 'Chrome' }, difficulty: 21, signal: controller.signal, onProofOfWorkSlow: () => { slow++; } });
  assert.equal(signing.difficulty, 21); assert.equal(signing.signal, controller.signal);
  t.mock.timers.tick(59_999); await drain(); assert.equal(slow, 0); assert.equal(fetched, 0); assert.equal(signing.signal.aborted, false);
  t.mock.timers.tick(1); await drain(); assert.equal(slow, 1); assert.equal(fetched, 0);
  finish({}); await request; assert.equal(fetched, 1);
});
test('cancelling during PoW prevents any registration request and clears its waiting timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let fetched = 0, slow = 0;
  const { Api } = productionModules({ pathFor: () => '/accounts', setTimeout, clearTimeout, AbortSignal, createHttpAuth: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })), decodeContract: (_schema, value) => value, fetch: async () => { fetched++; return new Response('{}'); } })('apps/extension/src/runtime/transport/api.ts');
  const controller = new AbortController();
  const request = new Api('https://service.test').request('accounts.create', { secretKey: new Uint8Array(32), body: { label: 'Chrome' }, difficulty: 21, signal: controller.signal, onProofOfWorkSlow: () => { slow++; } });
  controller.abort(new Error('cancelled')); await assert.rejects(request, /cancelled/);
  t.mock.timers.tick(MINUTE_MS); await drain(); assert.equal(fetched, 0); assert.equal(slow, 0);
});

test('signup refreshes the announced bits and exposes then clears the waiting state', async () => {
  let pending, finish; const calls = [], states = [];
  const { passwordSetCommand } = productionModules({ sealMnemonic: async () => ({}), isValidPin: () => true })('apps/extension/src/runtime/account/command-handlers.ts');
  const attempt = { signal: new AbortController().signal, current: () => true, check() {}, wait: p => p };
  const runtime = { state: { setup: 'password', config: { signupDifficulty: 19 } }, auth: { mnemonic: 'words', pendingIdentity: { secretKey: new Uint8Array(32) }, authMode: 'create', authenticationScope: () => attempt, finishCleanup: async () => {}, scope: () => attempt }, api: { async request(id, input) { calls.push(id); if (id === 'system.config') return { signupDifficulty: 21 }; pending = input; return new Promise(resolve => { finish = resolve; }); } }, storage: { put: async () => {}, putMany: async () => {}, remove: async () => {} }, wallet: { start: async () => {} }, emit: () => states.push(runtime.state.signupWaiting) };
  runtime.auth.connect = async session => { runtime.auth.session = session; runtime.auth.client = {}; runtime.auth.cryptoInitialised = true; };
  const work = passwordSetCommand.call({ runtime }, { payload: { password: '123456' } });
  await drain(); assert.deepEqual(calls, ['system.config', 'accounts.create']); assert.equal(pending.difficulty, 21);
  pending.onProofOfWorkSlow(); assert.equal(runtime.state.signupWaiting, true);
  finish({ account: { id: 'alice', nickname: 'Alice' }, token: 'token', matrix: {} }); await work;
  assert.equal(runtime.state.signupWaiting, undefined); assert.equal(states[0], true);
});
