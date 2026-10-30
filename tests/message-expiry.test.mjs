import test from 'node:test';
import assert from 'node:assert/strict';
import { messageExpiry } from '../apps/extension/src/runtime/chat/message-expiry.ts';

const DAY = 86_400_000;

test('effective expiry is the earlier server and current-team deadline', () => {
  const origin = 1_000;
  assert.equal(messageExpiry(origin + 14 * DAY, origin, 7), origin + 7 * DAY);
  assert.equal(messageExpiry(origin + 3 * DAY, origin, 7), origin + 3 * DAY);
});

test('missing expiry inputs are expired instead of receiving a guessed retention window', () => {
  assert.equal(messageExpiry(undefined, undefined, undefined), 0);
  assert.equal(messageExpiry(undefined, 100, undefined), 0);
});
