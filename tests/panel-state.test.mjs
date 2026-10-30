import test from 'node:test';
import assert from 'node:assert/strict';
import { stateForPanel } from '../apps/extension/src/runtime/transport/panel-state.ts';

test('notification navigation reaches only its target window while drafts remain shared', () => {
  const state = Object.freeze({ jumpMessageId: 'message-a', jumpWindowId: 12, drafts: { team: { value: { text: 'unsent' } } } });
  assert.equal(stateForPanel(state, 12), state);
  const other = stateForPanel(state, 13);
  assert.equal(other.jumpMessageId, undefined);
  assert.equal(other.jumpWindowId, undefined);
  assert.equal(other.drafts, state.drafts);
  assert.equal(state.jumpMessageId, 'message-a');
});

test('a connecting panel waits for its window identity before consuming navigation', () => {
  const state = { jumpMessageId: 'message-a', jumpWindowId: 12 };
  assert.equal(stateForPanel(state, undefined).jumpMessageId, undefined);
  assert.equal(stateForPanel(state, 12).jumpMessageId, 'message-a');
  assert.equal(stateForPanel({ jumpMessageId: 'untargeted' }, 12).jumpMessageId, undefined);
});

test('panel projection is memoized while shared slices retain identity', () => {
  const state = { jumpMessageId: 'message-a', jumpWindowId: 12, data: { messages: [] }, drafts: {} };
  const first = stateForPanel(state, 13);
  assert.equal(stateForPanel(state, 13), first);
  assert.equal(first.data, state.data);
  assert.equal(first.drafts, state.drafts);
});
