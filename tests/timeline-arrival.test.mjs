import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveTimelineArrival } from '../apps/extension/src/runtime/chat/timeline-arrival.ts';

test('only a live tail event received after sync is ready qualifies as a new arrival', () => {
  const live = { toStart: false, removed: false, liveEvent: true, ready: true, timestamp: 200, receiveSince: 100 };
  assert.equal(isLiveTimelineArrival(live), true);
  for (const patch of [{ toStart: true }, { removed: true }, { liveEvent: false }, { liveEvent: undefined }, { ready: false }, { timestamp: 99 }]) {
    assert.equal(isLiveTimelineArrival({ ...live, ...patch }), false, JSON.stringify(patch));
  }
});
