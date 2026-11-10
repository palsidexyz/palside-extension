import test from "node:test";
import assert from "node:assert/strict";
import { caption, quoteContext, randomId } from '../apps/extension/src/page-layer/text.ts';
import { defaultDanmakuSettings, normalizeDanmakuSettings } from '../apps/extension/src/runtime/browser/page-protocol.ts';
import { danmakuAreaRect, createMediaClock } from '../apps/extension/src/page-layer/danmaku-helpers.ts';

test('page-layer ids are v4 UUIDs without the secure-context crypto.randomUUID', () => {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  try {
    const id = randomId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, randomId());
  } finally { Object.defineProperty(crypto, 'randomUUID', { configurable: true, writable: true, value: original }); }
});

test('captions stay compact', () => {
  assert.equal(caption({ kind: 'quote', exact: 'hello world', prefix: '', suffix: '' }), '“hello world”');
  assert.ok(Array.from(caption({ kind: 'quote', exact: 'x'.repeat(200), prefix: '', suffix: '' })).length <= 40);
});

test('quote context keeps exact text and up to 24 characters around it', () => {
  const source = 'prefix '.repeat(10) + '引用内容' + ' suffix'.repeat(10);
  const start = source.indexOf('引用内容');
  const target = quoteContext(source, start, start + 4);
  assert.deepEqual(target, { kind: 'quote', exact: '引用内容', prefix: source.slice(start - 24, start), suffix: source.slice(start + 4, start + 28) });
  assert.equal(quoteContext(source, 0, 1), undefined);
});

test('danmaku settings validate defaults and clamp opacity', () => {
  assert.deepEqual(normalizeDanmakuSettings(undefined), defaultDanmakuSettings);
  assert.deepEqual(normalizeDanmakuSettings({ enabled: false, area: 100, speed: 190, opacity: 120 }), { enabled: false, area: 100, density: 'mid', speed: 190, size: 'md', opacity: 100 });
  assert.deepEqual(normalizeDanmakuSettings({ area: 'bad', speed: 3, opacity: 1 }), { ...defaultDanmakuSettings, opacity: 30 });
});

test('danmaku sizes accept supported values and default missing or invalid settings to medium', () => {
  for (const size of ['sm', 'md', 'lg']) assert.equal(normalizeDanmakuSettings({ size }).size, size);
  for (const size of [undefined, null, '', 'SM', 'xl', 13, {}, ['sm']]) assert.equal(normalizeDanmakuSettings({ size }).size, 'md');
  assert.equal(normalizeDanmakuSettings({ enabled: false, opacity: 45 }).size, 'md');
  assert.equal(normalizeDanmakuSettings(null).size, 'md');
});

test('danmaku area is a band from the top of the viewport, a quarter by default', () => {
  assert.deepEqual(danmakuAreaRect(800, 600), { top: 0, left: 0, width: 800, height: 150 });
  assert.deepEqual(danmakuAreaRect(800, 600, 50), { top: 0, left: 0, width: 800, height: 300 });
  assert.deepEqual(danmakuAreaRect(800, 600, 75), { top: 0, left: 0, width: 800, height: 450 });
  assert.deepEqual(danmakuAreaRect(800, 600, 100), { top: 0, left: 0, width: 800, height: 600 });
});

test('danmaku areas are the viewport bands; anything else starts at the top quarter', () => {
  assert.equal(normalizeDanmakuSettings({ area: 'full' }).area, 25);
  assert.equal(normalizeDanmakuSettings({ area: 75 }).area, 75);
  assert.equal(normalizeDanmakuSettings({ area: 40 }).area, 25);
});


test('fake media clock advances while playing and stops while paused', async () => {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 1);
  try {
    const clock = createMediaClock();
    clock.play();
    await new Promise(resolve => setTimeout(resolve, 8));
    const running = clock.currentTime;
    assert.ok(running > 0);
    clock.pause();
    await new Promise(resolve => setTimeout(resolve, 8));
    assert.equal(clock.currentTime, running);
  } finally {
    globalThis.requestAnimationFrame = previous;
  }
});


test('quote captions preserve composed graphemes at the title limit', () => {
  for (const grapheme of ['👨‍👩‍👧‍👦', 'e\u0301', '🇹🇼']) {
    assert.equal(caption({ kind: 'quote', exact: grapheme.repeat(31), prefix: '', suffix: '' }), `“${grapheme.repeat(31)}”`);
    assert.equal(caption({ kind: 'quote', exact: grapheme.repeat(32), prefix: '', suffix: '' }), `“${grapheme.repeat(30)}…”`);
  }
});
