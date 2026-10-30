import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSendQueue } from '../apps/extension/src/runtime/chat/messages.ts';
import { emojiOnly } from '../apps/extension/src/domain/chat/model.ts';
import { glidePlan, glideEase, trailView } from '../apps/extension/src/features/palside/chat/chat-reading.ts';
import { hitSegments, matchOffsets } from '../apps/extension/src/features/palside/chat/text-highlights.ts';

test('send queue groups per team, orders each team by slot and keeps the earliest slot as next', () => {
  const queue = collectSendQueue([
    { id: 'b', teamId: 'one', at: 3000 },
    { id: 'a', teamId: 'one', at: 2000 },
    { id: 'c', teamId: 'two', at: 2500 },
    { teamId: 'two', at: 1500 },
  ]);
  assert.deepEqual(queue.one, { count: 2, nextAt: 2000, items: [{ id: 'a', at: 2000 }, { id: 'b', at: 3000 }] });
  // A slot without a message ID still counts and paces, but there is no row to mark.
  assert.deepEqual(queue.two, { count: 2, nextAt: 1500, items: [{ id: 'c', at: 2500 }] });
  assert.deepEqual(collectSendQueue([]), {});
});

test('only one to three emoji stand alone as large emoji', () => {
  for (const text of ['🔥', '👀👀', '🚀🚀🚀', '❤️', '1️⃣', '🇨🇳', '👨‍👩‍👧', '👍🏽', ' 🫡 ']) assert.equal(emojiOnly(text), true, text);
  for (const text of ['🔥🔥🔥🔥', '这波 🔥', '©', '❤', '1', '', '   ']) assert.equal(emojiOnly(text), false, text);
});

test('jump glides approach far targets from within reach and scale duration with distance', () => {
  assert.deepEqual(glidePlan(0, 0), { start: 0, path: 0, duration: 0 });
  const near = glidePlan(1000, 1200);
  assert.equal(near.start, 1000); assert.equal(near.path, 200); assert.equal(near.duration, 375);
  const far = glidePlan(9000, 100);
  assert.equal(far.start, 900); assert.equal(far.path, -800); assert.equal(far.duration, 600);
  assert.equal(glideEase(0), 0); assert.equal(glideEase(1), 1); assert.ok(glideEase(.5) > .5);
});

test('the jump trail keeps the origin and the latest stops, eliding the middle', () => {
  assert.deepEqual(trailView(['o', 'a']), [{ entry: 'o', index: 0 }, { entry: 'a', index: 1 }]);
  assert.deepEqual(trailView(['o', 'a', 'b', 'c', 'd']), [{ entry: 'o', index: 0 }, { entry: 'a', index: 1, gap: true }, { entry: 'c', index: 3 }, { entry: 'd', index: 4 }]);
});

test('search hits are found case-insensitively and survive the result clamp', () => {
  assert.deepEqual(matchOffsets('Pump PUMP pump', 'pump'), [[0, 4], [5, 9], [10, 14]]);
  assert.deepEqual(matchOffsets('anything', '  '), []);
  assert.deepEqual(hitSegments('看这个代币', '代币'), [{ text: '看这个', hit: false }, { text: '代币', hit: true }]);
  const deep = hitSegments('The quick brown fox jumps over the lazy dog and keeps running toward Solana', 'solana');
  assert.equal(deep[0].text, '…');
  assert.ok(deep[1].text.startsWith('keeps') || deep[1].text.startsWith('and'), deep[1].text);
  assert.deepEqual(deep.at(-1), { text: 'Solana', hit: true });
  assert.deepEqual(hitSegments('none', 'x'), [{ text: 'none', hit: false }]);
});

test('a partial quote is positions only and shows only while the original is readable and unedited', async () => {
  const { readQuoteRange, quotedFragment } = await import("../apps/extension/src/domain/chat/model.ts");
  assert.deepEqual(readQuoteRange({ start: 2, end: 6, base: 0 }), { start: 2, end: 6, base: 0 });
  for (const bad of [undefined, null, 'x', { start: 3, end: 3, base: 0 }, { start: -1, end: 2, base: 0 }, { start: 0, end: 2.5, base: 0 }, { start: 0, end: 50_000, base: 0 }, { start: 0, end: 2 }]) assert.equal(readQuoteRange(bad), undefined, JSON.stringify(bad));
  const original = { id: 'o', teamId: 't', author: 'a', text: '开发者钱包转出了一笔', time: '', status: 'sent', expiresAt: 2000 };
  const range = { start: 3, end: 7, base: 0 };
  assert.equal(quotedFragment(original, range, undefined, 1000), '钱包转出');
  // Edited since, recalled, expired, missing or unsent originals fall back to a whole-message reply.
  assert.equal(quotedFragment({ ...original, editedAt: 5 }, range, undefined, 1000), undefined);
  assert.equal(quotedFragment({ ...original, recalled: true }, range, undefined, 1000), undefined);
  assert.equal(quotedFragment(original, range, undefined, 3000), undefined);
  assert.equal(quotedFragment(undefined, range), undefined);
  assert.equal(quotedFragment({ ...original, status: 'sending' }, range, undefined, 1000), undefined);
  assert.equal(quotedFragment({ ...original, editedAt: 5 }, { ...range, base: 5 }, undefined, 1000), '钱包转出');
});
