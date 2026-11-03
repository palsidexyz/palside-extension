import { HOUR_MS, DAY_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
import { renderMessage } from '../packages/i18n/src/core.ts';

const { unlockLocalMnemonic } = productionModules({ Error, openMnemonic: async (_vault, pin) => { if (pin !== '123456') throw Error('WRONG_PASSWORD'); return 'words'; } })('apps/extension/src/runtime/account/local-password.ts');
function fixture() {
  let now = 1000; const values = new Map([['vault', {}]]);
  const input = { storage: { get: async key => structuredClone(values.get(key)), put: async (key, _account, _kind, value) => values.set(key, structuredClone(value)) }, accountId: 'self', check() {}, locks: { request: (_key, fn) => fn() }, now: () => now };
  return { values, advance: ms => { now += ms; }, now: () => now, unlock: (password = '000000') => unlockLocalMnemonic({ ...input, password }) };
}
test('PIN lockouts escalate, saturate at one day, and a correct PIN resets every counter', async () => {
  const f = fixture();
  for (const delay of [900_000, HOUR_MS, DAY_MS, DAY_MS]) {
    for (let i = 0; i < 4; i++) await assert.rejects(f.unlock(), { code: 'WRONG_PASSWORD' });
    await assert.rejects(f.unlock(), error => {
      assert.equal(error.code, 'PASSWORD_LOCKED'); assert.equal(error.lockedUntil, f.now() + delay);
      assert.equal(error.text.values.time, error.lockedUntil);
      assert.match(renderMessage('zh-CN', error.text), /后可再试/);
      assert.match(renderMessage('en', error.text), /Try again after/);
      return true;
    });
    await assert.rejects(f.unlock('123456'), { code: 'PASSWORD_LOCKED' });
    f.advance(delay);
  }
  assert.equal(await f.unlock('123456'), 'words');
  assert.deepEqual(f.values.get('self:password-attempts'), { failures: 0, failedAt: 0, lockouts: 0, lockedUntil: 0 });
  for (let i = 0; i < 4; i++) await assert.rejects(f.unlock(), { code: 'WRONG_PASSWORD' });
  await assert.rejects(f.unlock(), { code: 'PASSWORD_LOCKED', lockedUntil: f.now() + 900_000 });
});
test('unlocked failures expire after 24 hours without removing earlier lockout escalation', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(f.unlock());
  f.advance(900_000);
  for (let i = 0; i < 4; i++) await assert.rejects(f.unlock(), { code: 'WRONG_PASSWORD' });
  f.advance(DAY_MS);
  await assert.rejects(f.unlock(), { code: 'WRONG_PASSWORD' });
  assert.equal(f.values.get('self:password-attempts').failures, 1);
  for (let i = 0; i < 3; i++) await assert.rejects(f.unlock(), { code: 'WRONG_PASSWORD' });
  await assert.rejects(f.unlock(), { code: 'PASSWORD_LOCKED', lockedUntil: f.now() + HOUR_MS });
});
