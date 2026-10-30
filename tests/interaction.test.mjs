import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInteraction, interactionAllows, readFavorites, readInteraction } from '../apps/extension/src/domain/annotations/interaction.ts';

test('网页互动 preferences fill missing features and reject anything else', () => {
  assert.deepEqual(readInteraction({}), defaultInteraction);
  assert.deepEqual(readInteraction({ signal: false }), { signal: false, sticky: true });
  assert.equal(readInteraction({ unknownField: 'yes' }), undefined);
  assert.equal(readInteraction({ unknownField: false }), undefined, 'unknown fields are rejected');
  assert.equal(readInteraction({ unknownField: true, signal: true, sticky: true }), undefined);
  assert.equal(readInteraction({ danmaku: true }), undefined, 'public room display is not an interaction feature');
  assert.equal(readInteraction({ sticky: 'no' }), undefined);
  assert.equal(readInteraction({ ping: true }), undefined);
  assert.equal(readInteraction([]), undefined);
});

test('互动选项: each feature has its own switch, and 网页互动 has something to draw only while one is on', () => {
  const off = { signal: false, sticky: false };
  assert.equal(interactionAllows(off), false);
  for (const feature of ['signal', 'sticky']) {
    assert.equal(interactionAllows(off, feature), false, feature);
    assert.equal(interactionAllows({ ...off, [feature]: true }, feature), true, feature);
    assert.equal(interactionAllows({ ...off, [feature]: true }), true, feature);
  }
  assert.equal(interactionAllows({ signal: true, sticky: false }, 'sticky'), false);
  assert.equal(interactionAllows(undefined), true);
  assert.equal(interactionAllows(undefined, 'signal'), true);
});

test('favorites keep exact hosts and page scopes, deduplicated and bounded', () => {
  const value = readFavorites({ sites: ['GMGN.ai', 'gmgn.ai'], pages: [{ url: 'https://gmgn.ai/sol/token/abc?utm_source=x', title: ' PONS ' }, { url: 'https://gmgn.ai/sol/token/abc', title: 'dup' }] });
  assert.deepEqual(value?.sites, ['gmgn.ai']);
  assert.equal(value?.pages.length, 1);
  assert.equal(value?.pages[0].title, 'PONS');
  assert.equal(readFavorites({ sites: ['localhost'], pages: [] }), undefined);
  assert.equal(readFavorites({ sites: [], pages: [{ url: 'chrome://settings', title: 'x' }] }), undefined);
  assert.equal(readFavorites({ sites: Array.from({ length: 201 }, (_, i) => `s${i}.example.com`), pages: [] }), undefined);
  assert.equal(readFavorites({ sites: [], pages: [], extra: 1 }), undefined);
});
