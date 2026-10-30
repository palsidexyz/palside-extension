import { REACTION_TTL_MS } from '@palside/shared/contracts/limits';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReactionBatcher, pruneReactions, readReaction, REACTION_DISPLAY, REACTION_MAX_COUNT } from '../apps/extension/src/domain/annotations/reactions.ts';

const valid = { id: 'abcdef12-3456', teamId: 'team', emoji: '🔥', count: 3, sentAt: 10_000 };

test('received reactions accept only the fixed set, sane counts and live timestamps', () => {
  assert.deepEqual(readReaction(valid, 10_000), { id: valid.id, teamId: 'team', emoji: '🔥', count: 3 });
  assert.equal(readReaction({ ...valid, emoji: '💩' }, 10_000), undefined);
  assert.equal(readReaction({ ...valid, emoji: '<img>' }, 10_000), undefined);
  for (const count of [0, -1, 1.5, REACTION_MAX_COUNT + 1, '3']) assert.equal(readReaction({ ...valid, count }, 10_000), undefined);
  assert.equal(readReaction({ ...valid, sentAt: 10_000 - REACTION_TTL_MS - 1 }, 10_000), undefined);
  assert.equal(readReaction({ ...valid, sentAt: 16_000 }, 10_000), undefined);
  assert.equal(readReaction({ ...valid, id: 'x' }, 10_000), undefined);
});

test('the live window drops expired reactions and keeps the newest', () => {
  const at = n => ({ ...valid, id: `reaction-${n}`, personId: 'p', at: n });
  assert.deepEqual(pruneReactions([at(0), at(5_000)], REACTION_DISPLAY + 1).map(item => item.at), [5_000]);
  assert.equal(pruneReactions(Array.from({ length: 30 }, (_, i) => at(i)), 100).length, 24);
});

test('taps merge into one send, a held press streams, switching emoji flushes first', async () => {
  let now = 0; const sent = [];
  const batcher = new ReactionBatcher((teamId, emoji, count) => sent.push([teamId, emoji, count]), 40, 100, () => now);
  batcher.add('t', '🔥'); batcher.add('t', '🔥'); batcher.add('t', '🔥');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(sent, [['t', '🔥', 3]]);
  batcher.add('t', '🚀'); now = 50; batcher.add('t', '🚀'); now = 100; batcher.add('t', '🚀');
  assert.deepEqual(sent.at(-1), ['t', '🚀', 3]);
  batcher.add('t', '👀'); batcher.add('other', '👀');
  assert.deepEqual(sent.slice(-1), [['t', '👀', 1]]);
  batcher.flush(); assert.deepEqual(sent.at(-1), ['other', '👀', 1]);
  for (let i = 0; i < REACTION_MAX_COUNT; i++) batcher.add('t', '👍');
  assert.deepEqual(sent.at(-1), ['t', '👍', REACTION_MAX_COUNT]);
});
