import { DAY_MS as DAY } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageExpiry, messageExpiry, PERMANENT } from '../apps/extension/src/runtime/chat/message-expiry.ts';


test('effective expiry is the earlier server and current-team deadline', () => {
  const origin = 1_000;
  assert.equal(messageExpiry(origin + 14 * DAY, origin, 7), origin + 7 * DAY);
  assert.equal(messageExpiry(origin + 3 * DAY, origin, 7), origin + 3 * DAY);
});

test('missing expiry inputs are expired instead of receiving a guessed retention window', () => {
  assert.equal(messageExpiry(undefined, undefined, undefined), 0);
  assert.equal(messageExpiry(undefined, 100, undefined), 0);
});

test('permanent retention is a finite far deadline, and images still end 30 days after sending', () => {
  const origin = 1_000;
  assert.equal(messageExpiry(undefined, origin, null), PERMANENT);
  assert.equal(messageExpiry(origin + 3 * DAY, origin, null), origin + 3 * DAY);
  assert.ok(JSON.parse(JSON.stringify(PERMANENT)) > Date.now());
  assert.equal(imageExpiry({ timestamp: origin }, PERMANENT), origin + 30 * DAY);
  assert.equal(imageExpiry({ timestamp: origin }, origin + DAY), origin + DAY);
});
