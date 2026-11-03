/* global document -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/runtime/signals.ts') && specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { captureSignalTarget, resolveSignalSpot, spotAlive, textKey } = await import('../apps/extension/src/page-layer/signal-targets.ts');
hooks.deregister();

function fixture() {
  const saved = new Map();
  const set = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
  let styleReads = 0;
  function element(tag = 'p', parent, properties = {}) {
    const el = { nodeType: 1, tagName: tag.toUpperCase(), children: [], parentNode: parent, parentElement: parent, isConnected: true,
      get firstChild() { return this.children[0] ?? null; }, get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; },
      getAttribute(name) { return this.attributes?.[name] ?? null; },
      matches(selector) { return Boolean(this.private) || selector.split(',').includes(tag); },
      closest(selector) { if (selector === 'img,svg,video,audio,picture') return ['img', 'svg'].includes(tag) ? this : parent?.closest(selector) ?? null; return this.matches(selector) ? this : parent?.closest(selector) ?? null; },
      contains(node) { return node === this || this.children.some(child => child === node || child.contains?.(node)); },
      getBoundingClientRect() { return rect; }, ...properties };
    parent?.children.push(el); return el;
  }
  const body = element('body');
  const text = (value, parent = element('p', body), denied = false) => {
    const node = { nodeType: 3, parentElement: parent, parentNode: parent, isConnected: true, value,
      get length() { return this.value.length; },
      get nextSibling() { return parent.children[parent.children.indexOf(this) + 1] ?? null; },
      substringData(start, count) { assert.equal(denied, false, 'private text read'); assert.ok(count <= 256); return this.value.slice(start, start + count); },
      get data() { assert.equal(denied, false, 'private text read'); return this.value; } };
    parent.children.push(node); return node;
  };
  set('location', { hostname: 'example.com' }); set('Node', { TEXT_NODE: 3 });
  set('innerWidth', 1000); set('innerHeight', 800);
  set('getComputedStyle', node => { styleReads++; return { display: 'block', visibility: 'visible', opacity: '1', ...node.style }; });
  const charts = [];
  set('document', { body, baseURI: 'https://example.com/', elementFromPoint: () => body, querySelectorAll: () => charts, createRange() { return {
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    getClientRects: () => [rect],
    toString() { const nodes = []; const collect = node => { if (node.nodeType === 3) nodes.push(node); else node.children.forEach(collect); }; collect(body);
      const start = nodes.indexOf(this.startContainer), end = nodes.indexOf(this.endContainer);
      return nodes.slice(start, end + 1).map((node, i) => node.data.slice(i === 0 ? this.startOffset : 0, start + i === end ? this.endOffset : node.length)).join(''); },
  }; } });
  /** Point the next capture at a text node and offset. */
  const pressText = (node, offset) => { document.elementFromPoint = () => node.parentElement; document.caretPositionFromPoint = () => ({ offsetNode: node, offset }); };
  return { body, text, charts, pressText, styleReads: () => styleReads, element: (tag, parent = body, properties) => element(tag, parent, properties), set,
    restore() { for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } };
}
const kinds = target => target.kind === 'spot' ? target.anchors.map(anchor => anchor.kind) : [];

test('the words under the pointer come first; empty space and bad points are no word', () => {
  const env = fixture();
  try {
    const text = env.text('before hello world after');
    env.pressText(text, 9);
    document.getSelection = () => { throw Error('Selection must remain untouched'); };
    const target = captureSignalTarget(10, 10);
    const [quote] = target.anchors;
    assert.equal(quote.kind, 'quote'); assert.ok(quote.exact.includes('hello')); assert.ok(quote.exact.length <= 64);
    assert.deepEqual([quote.nth, quote.of], [0, 1]);
    const spot = resolveSignalSpot(target);
    assert.equal(spot.level, 0); assert.equal(spot.box.toString(), quote.exact); assert.equal(spotAlive(spot), true);
    assert.deepEqual(captureSignalTarget(NaN, 10), { kind: 'page' });
    document.caretPositionFromPoint = () => null;
    assert.deepEqual(kinds(captureSignalTarget(10, 10)), ['element']); // the paragraph itself, by its text
  } finally { env.restore(); }
});

test('ticking numbers still match: digits compare as 0 and whitespace collapses', () => {
  const env = fixture();
  try {
    assert.equal(textKey('Price  $0.001234\nUSD'), 'Price $0.000000 USD');
    const text = env.text('Price $0.001234 USD');
    env.pressText(text, 9);
    const target = captureSignalTarget(10, 10);
    text.value = 'Price $0.001240 USD';
    const spot = resolveSignalSpot(target);
    assert.equal(spot.level, 0); assert.equal(spot.box.startContainer, text);
  } finally { env.restore(); }
});

test('numbers tell rows apart; a loose match only counts when it is the only one', () => {
  const env = fixture();
  try {
    const rows = ['Buy 1.25 SOL', 'Buy 0.75 SOL', 'Buy 2.00 SOL'].map(value => env.text(value));
    env.pressText(rows[1], 5);
    const target = captureSignalTarget(10, 10);
    assert.deepEqual([target.anchors[0].nth, target.anchors[0].of], [0, 1]);
    assert.equal(resolveSignalSpot(target).box.startContainer, rows[1]);
    rows[1].value = 'Buy 0.80 SOL';
    assert.equal(resolveSignalSpot(target), undefined); // three rows read alike once digits are ignored
  } finally { env.restore(); }
});

test('an unnamed container falls back to its class list; members load the same site build', () => {
  const env = fixture();
  try {
    const feed = env.element('div', env.body, { classList: ['rows', 'feed', 'x:bad'] });
    for (let i = 0; i < 12; i++) env.text(`Trade ${i} `.repeat(4), env.element('div', feed));
    document.elementFromPoint = () => feed; document.caretPositionFromPoint = () => null;
    const target = captureSignalTarget(50, 10);
    assert.deepEqual(target.anchors.map(anchor => anchor.cls), ['feed rows']);
    assert.equal(resolveSignalSpot(target).box, feed);
  } finally { env.restore(); }
});

test('repeated text points at the same one of several only when both pages hold as many', () => {
  const env = fixture();
  try {
    const rows = [0, 1, 2].map(() => env.text('Buy now'));
    env.pressText(rows[1], 1);
    const target = captureSignalTarget(10, 10);
    assert.deepEqual([target.anchors[0].nth, target.anchors[0].of], [1, 3]);
    assert.equal(resolveSignalSpot(target).box.startContainer, rows[1]);
    env.text('Buy now');
    assert.equal(resolveSignalSpot(target), undefined); // four on this page: no guessing which one
    env.pressText(rows[1], 1);
    assert.equal(captureSignalTarget(10, 10).kind, 'page'); // past three equal items, order does not identify one
  } finally { env.restore(); }
});

test('when the words are gone the block around them carries the signal, at its relative point', () => {
  const env = fixture();
  try {
    let box = { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 };
    const card = env.element('section', env.body, { attributes: { 'aria-label': 'Market stats' }, getBoundingClientRect: () => box });
    const text = env.text('Volume rising fast', env.element('p', card));
    env.pressText(text, 2);
    const target = captureSignalTarget(50, 10);
    assert.deepEqual(kinds(target), ['quote', 'element', 'element']);
    const block = target.anchors[2];
    assert.deepEqual([block.tag, block.label, block.x, block.y], ['section', 'Market stats', 0.25, 0.25]);
    text.value = 'Volume falling'; // the words changed, so the quote and the paragraph's text are gone
    box = { left: 100, top: 100, right: 500, bottom: 300, width: 400, height: 200 };
    const spot = resolveSignalSpot(target);
    assert.equal(spot.level, 2); assert.equal(spot.box, card); assert.deepEqual([spot.x, spot.y], [0.25, 0.25]);
  } finally { env.restore(); }
});

test('a section without a label is named by its heading, as ARIA names it', () => {
  const env = fixture();
  try {
    const article = env.element('article', env.body, { getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 }) });
    const title = env.element('h2', article); env.text('About the token', title);
    article.querySelector = () => title;
    env.text('A long paragraph that reads as content rather than as a name, well past what a button or a cell would say.', env.element('p', article));
    document.elementFromPoint = () => article; document.caretPositionFromPoint = () => null;
    const target = captureSignalTarget(150, 150);
    assert.deepEqual(target.anchors.map(anchor => [anchor.tag, anchor.label]), [['article', 'About the token']]);
    assert.equal(resolveSignalSpot(target).box, article);
  } finally { env.restore(); }
});

test('an element taller than half the viewport or larger than a quarter of it is never a fallback', () => {
  const env = fixture();
  try {
    const wide = env.element('main', env.body, { attributes: { id: 'content' }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 }) });
    const button = env.element('button', wide, { attributes: { 'aria-label': 'Swap' } });
    document.elementFromPoint = () => button;
    const target = captureSignalTarget(20, 10);
    assert.deepEqual(target.anchors.map(anchor => anchor.tag), ['button']);
  } finally { env.restore(); }
});

test('a chart press points into the chart area; the canvas itself is never read', () => {
  const env = fixture();
  try {
    const chartBox = { left: 100, top: 100, right: 700, bottom: 500, width: 600, height: 400 };
    const chart = env.element('div', env.body, { getBoundingClientRect: () => chartBox });
    const canvas = env.element('canvas', chart, { attributes: { id: 'public-chart' } }); env.text('pixels', canvas, true);
    document.elementFromPoint = () => canvas;
    assert.deepEqual(captureSignalTarget(400, 200), { kind: 'page' }); // no chart known on this site
    env.charts.push(chart);
    const target = captureSignalTarget(400, 200);
    assert.deepEqual(target, { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.25 }] });
    const spot = resolveSignalSpot(target);
    assert.equal(spot.box, chart); assert.deepEqual([spot.x, spot.y], [0.5, 0.25]);
  } finally { env.restore(); }
});

test('fields, frames and images never give up their text', () => {
  const env = fixture();
  try {
    for (const tag of ['input', 'textarea', 'select', 'iframe', 'img']) {
      const parent = env.element(tag); const text = env.text('secret value', parent, true);
      env.pressText(text, 2);
      const target = captureSignalTarget(10, 10);
      assert.ok(target.kind === 'page' || target.anchors.every(anchor => anchor.kind !== 'quote' && !anchor.text), tag);
    }
  } finally { env.restore(); }
});

test('links, buttons, forms and images are anchored by what a person sees, never by a DOM path', () => {
  const env = fixture();
  try {
    for (const [tag, attributes] of [['a', { href: 'https://example.com/story' }], ['button', { id: 'buy-button' }], ['form', { id: 'trade-form' }], ['img', { src: 'https://example.com/photo.png', alt: 'Public landscape' }]]) {
      const element = env.element(tag, env.body, { attributes });
      document.elementFromPoint = () => element; document.caretPositionFromPoint = () => null;
      const target = captureSignalTarget(25, 10);
      assert.equal(target.anchors[0].kind, 'element', tag); assert.equal('path' in target.anchors[0], false);
      assert.equal(resolveSignalSpot(target).box, element, tag);
    }
    const image = env.body.children.at(-1);
    image.attributes = { src: 'https://example.com/other.png' };
    assert.equal(resolveSignalSpot({ kind: 'spot', anchors: [{ kind: 'element', tag: 'img', src: 'https://example.com/photo.png', alt: 'x', nth: 0, of: 1, x: 0.5, y: 0.5 }] }), undefined);
  } finally { env.restore(); }
});

test('private and hidden subtrees are unread and a match never spans them', () => {
  const env = fixture();
  try {
    env.text('hello'); env.text('secret', env.element('input'), true); env.text('world');
    env.text('helloworld', env.element('div', env.body, { style: { display: 'none' } }), true);
    const quote = { kind: 'quote', exact: 'helloworld', prefix: '', suffix: '', nth: 0, of: 1 };
    assert.equal(resolveSignalSpot({ kind: 'spot', anchors: [quote] }), undefined);
    const visible = env.text('helloworld');
    assert.equal(resolveSignalSpot({ kind: 'spot', anchors: [quote] }).box.startContainer, visible);
  } finally { env.restore(); }
});

test('one capture walks the page once, and a page past the caps falls through instead of guessing', () => {
  const env = fixture();
  try {
    for (let i = 0; i < 300; i++) env.text(`row ${i}`, env.element('div'));
    const text = env.text('known target', env.element('button', env.body, { attributes: { 'aria-label': 'Known' } }));
    env.pressText(text, 2);
    const before = env.styleReads();
    captureSignalTarget(10, 10);
    assert.ok(env.styleReads() - before < 1000, `style reads: ${env.styleReads() - before}`);
    for (let i = 0; i < 20_001; i++) env.element('span');
    assert.equal(resolveSignalSpot({ kind: 'spot', anchors: [{ kind: 'quote', exact: 'known target', prefix: '', suffix: '', nth: 0, of: 1 }] }), undefined);
  } finally { env.restore(); }
});

test('a detached or hidden spot is not alive', () => {
  const env = fixture();
  try {
    const button = env.element('button', env.body, { attributes: { 'aria-label': 'Swap' } });
    const spot = resolveSignalSpot({ kind: 'spot', anchors: [{ kind: 'element', tag: 'button', label: 'Swap', nth: 0, of: 1, x: 0.5, y: 0.5 }] });
    assert.equal(spotAlive(spot), true);
    button.style = { display: 'none' }; assert.equal(spotAlive(spot), false);
  } finally { env.restore(); }
});
