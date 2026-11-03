import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRetentionDays, retentionOptions, retentionPeriod, retentionKey, retentionFromKey, isShorterRetention } from '../apps/extension/src/features/palside/teams/retention.ts';

test('retention labels and select values cover finite periods and permanent without a fallback', () => {
  assert.equal(defaultRetentionDays, null);
  assert.deepEqual(retentionOptions, [1, 7, 30, null]);
  for (const days of retentionOptions) {
    assert.equal(retentionFromKey(retentionKey(days)), days);
    assert.ok(retentionPeriod(days));
  }
  assert.deepEqual(retentionPeriod(null), retentionPeriod(retentionFromKey('forever')));
  for (const value of [14, 0, undefined, '30']) assert.throws(() => retentionPeriod(value), RangeError);
  for (const value of ['14', '', 'null']) assert.equal(retentionFromKey(value), undefined);
  assert.equal(isShorterRetention(30, null), true);
  assert.equal(isShorterRetention(null, 1), false);
  assert.equal(isShorterRetention(7, 30), true);
  assert.equal(isShorterRetention(30, 7), false);
});
