import test from 'node:test';
import assert from 'node:assert/strict';
import { isMessageVisible } from '../apps/extension/src/features/palside/chat/message-visibility.ts';

const viewport = { top: 100, bottom: 300, left: 0, right: 320 };
test('ordinary messages need substantial visible area and clipped or hidden messages remain unread', () => {
  assert.equal(isMessageVisible({ top: 250, bottom: 350, left: 20, right: 300 }, viewport), false);
  assert.equal(isMessageVisible({ top: 240, bottom: 340, left: 20, right: 300 }, viewport), true);
  assert.equal(isMessageVisible({ top: 400, bottom: 500, left: 20, right: 300 }, viewport), false);
  assert.equal(isMessageVisible({ top: 100, bottom: 200, left: 310, right: 500 }, viewport), false);
  assert.equal(isMessageVisible({ top: 0, bottom: 0, left: 0, right: 0 }, viewport), false);
});
test('a message taller than the chat can be read when it fills the viewport, but jumping past its tail does not read it', () => {
  assert.equal(isMessageVisible({ top: -300, bottom: 700, left: 20, right: 300 }, viewport), true);
  assert.equal(isMessageVisible({ top: -830, bottom: 170, left: 20, right: 300 }, viewport), false);
  assert.equal(isMessageVisible({ top: -300, bottom: 700, left: 20, right: 300 }, { ...viewport, bottom: 100 }), false);
});
