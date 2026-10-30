import test from "node:test";
import assert from "node:assert/strict";
import { abbreviate, sameAddress, caption, quoteContext } from '../apps/extension/src/page-layer/text.ts';
import { defaultDanmakuSettings, normalizeDanmakuSettings } from '../apps/extension/src/runtime/browser/page-protocol.ts';
import { fallbackDanmakuArea, createMediaClock } from '../apps/extension/src/page-layer/danmaku-helpers.ts';

test('abbreviated addresses compare by first six and last four characters', () => {
  assert.equal(abbreviate('0x12ab34567890cd34'), '0x12ab…cd34');
  assert.equal(sameAddress('0x12ab34…cd34', '0x12ab34567890cd34'), true);
  assert.equal(sameAddress('0x12ab34…cd34', '0x12ac35…cd34'), false);
});

test('captions stay compact for addresses and quotes', () => {
  assert.equal(caption({ kind: 'address', text: '0x12ab34567890cd34' }), '0x12ab…cd34');
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
  assert.deepEqual(normalizeDanmakuSettings({ enabled: false, area: 'full', speed: 190, opacity: 120 }), { enabled: false, area: 'full', density: 'mid', speed: 190, size: 'md', opacity: 100 });
  assert.deepEqual(normalizeDanmakuSettings({ area: 'bad', speed: 3, opacity: 1 }), { ...defaultDanmakuSettings, opacity: 30 });
});

test('danmaku sizes accept supported values and default missing or invalid settings to medium', () => {
  for (const size of ['sm', 'md', 'lg']) assert.equal(normalizeDanmakuSettings({ size }).size, size);
  for (const size of [undefined, null, '', 'SM', 'xl', 13, {}, ['sm']]) assert.equal(normalizeDanmakuSettings({ size }).size, 'md');
  assert.equal(normalizeDanmakuSettings({ enabled: false, opacity: 45 }).size, 'md');
  assert.equal(normalizeDanmakuSettings(null).size, 'md');
});

test('danmaku area fallback occupies the top quarter of the viewport', () => {
  assert.deepEqual(fallbackDanmakuArea(800, 600), { top: 0, left: 0, width: 800, height: 150 });
  assert.deepEqual(fallbackDanmakuArea(800, 600, 'full'), { top: 0, left: 0, width: 800, height: 600 });
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
