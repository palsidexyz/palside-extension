/* global document -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/runtime/signals.ts') && specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { captureSignalTarget, resolveSignalTarget, resolveSignalElement } = await import('../apps/extension/src/page-layer/signal-targets.ts');
hooks.deregister();

function fixture() {
  const saved = new Map();
  const set = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  const rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
  function element(tag = 'p', parent, properties = {}) {
    const el = { nodeType: 1, tagName: tag.toUpperCase(), children: [], parentNode: parent, parentElement: parent, isConnected: true,
      get firstChild() { return this.children[0] ?? null; }, get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; },
      getAttribute(name) { return this.attributes?.[name] ?? null; },
      closest(selector) { if (selector === 'img,svg,video,audio,picture') return ['img', 'svg'].includes(tag) ? this : null; return this.private || ['input', 'button', 'form'].includes(tag) || tag === 'canvas' && selector.split(',').includes('canvas') ? this : parent?.closest(selector) ?? null; },
      contains(node) { return node === this || this.children.some(child => child === node || child.contains?.(node)); },
      getBoundingClientRect() { return rect; }, ...properties };
    parent?.children.push(el); return el;
  }
  const body = element('body');
  const text = (value, parent = element('p', body), denied = false) => {
    const node = { nodeType: 3, parentElement: parent, parentNode: parent, isConnected: true, length: value.length,
      get nextSibling() { return parent.children[parent.children.indexOf(this) + 1] ?? null; },
      substringData(start, count) { assert.equal(denied, false, 'private text read'); assert.ok(count <= 256); return value.slice(start, start + count); },
      get data() { assert.equal(denied, false, 'private text read'); return value; } };
    parent.children.push(node); return node;
  };
  set('location', { hostname: 'example.com' }); set('Node', { TEXT_NODE: 3 });
  set('getComputedStyle', node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.style }));
  set('document', { body, elementFromPoint: () => body, createRange() { return {
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    getClientRects: () => [rect],
    toString() { const nodes = []; const collect = node => { if (node.nodeType === 3) nodes.push(node); else node.children.forEach(collect); }; collect(body);
      const start = nodes.indexOf(this.startContainer), end = nodes.indexOf(this.endContainer);
      return nodes.slice(start, end + 1).map((node, i) => node.data.slice(i === 0 ? this.startOffset : 0, start + i === end ? this.endOffset : node.length)).join(''); },
  }; } });
  return { body, text, element: (tag, parent = body, properties) => element(tag, parent, properties), set, restore() { for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } };
}
const quote = (exact, prefix = '', suffix = '') => ({ kind: 'quote', exact, prefix, suffix });

test('captures a short contextual word quote without touching Selection and rejects distant carets', async () => {
  const env = fixture();
  try {
    const text = env.text('before hello world after');
    document.elementFromPoint = () => text.parentElement;
    document.caretPositionFromPoint = () => ({ offsetNode: text, offset: 9 });
    document.getSelection = () => { throw Error('Selection must remain untouched'); };
    const target = captureSignalTarget(10, 10);
    assert.equal(target.kind, 'quote'); assert.ok(target.exact.includes('hello')); assert.ok(target.exact.length <= 64);
    assert.equal((await resolveSignalTarget(target)).toString(), target.exact);
    assert.deepEqual(captureSignalTarget(500, 500), { kind: 'page' });
    assert.deepEqual(captureSignalTarget(NaN, 10), { kind: 'page' });
  } finally { env.restore(); }
});

test('capture rejects sensitive text, images and chart canvas before reading text', () => {
  const env = fixture();
  try {
    for (const tag of ['button', 'form', 'canvas', 'img']) {
      const parent = env.element(tag); const text = env.text('secret value', parent, true);
      document.elementFromPoint = () => parent; document.caretPositionFromPoint = () => ({ offsetNode: text, offset: 2 });
      assert.deepEqual(captureSignalTarget(10, 10), { kind: 'page' });
    }
  } finally { env.restore(); }
});

test('image identity preserves an element-relative point across responsive geometry', async () => {
  const env = fixture();
  try {
    let rect = { left: 100, top: 200, right: 500, bottom: 400, width: 400, height: 200 };
    const image = env.element('img', env.body, { attributes: { src: 'https://example.com/photo.png', alt: 'Public landscape' }, getBoundingClientRect: () => rect });
    document.elementFromPoint = () => image;
    const target = captureSignalTarget(200, 350);
    assert.equal(target.kind, 'element'); assert.equal(target.x, .25); assert.equal(target.y, .75);
    rect = { left: 20, top: 50, right: 220, bottom: 150, width: 200, height: 100 };
    const resolved = await resolveSignalElement(target);
    assert.equal(resolved, image);
    assert.deepEqual({ x: rect.left + target.x * rect.width, y: rect.top + target.y * rect.height }, { x: 70, y: 125 });
    env.element('img', env.body, { attributes: image.attributes });
    assert.equal(await resolveSignalElement(target), undefined);
  } finally { env.restore(); }
});

test('captures links, readable padding and explicitly identified public canvas', async () => {
  const env = fixture();
  try {
    for (const [tag, attributes] of [['a', { href: 'https://example.com/story' }], ['canvas', { id: 'price-chart' }], ['div', {}]]) {
      const element = env.element(tag, env.body, { attributes });
      if (tag === 'div') env.text('Public story headline', element);
      document.elementFromPoint = () => element;
      const target = captureSignalTarget(25, 10);
      assert.equal(target.kind, 'element', tag);
      assert.equal(await resolveSignalElement(target), element);
    }
  } finally { env.restore(); }
});

test('zero-box layout wrappers do not hide matching descendants', async () => {
  const env = fixture();
  try {
    const wrapper = env.element('div', env.body, { style: { display: 'contents' }, getBoundingClientRect: () => ({ width: 0, height: 0 }) });
    const image = env.element('img', wrapper, { attributes: { src: 'https://example.com/photo.png' } });
    document.elementFromPoint = () => image;
    const target = captureSignalTarget(25, 10);
    assert.equal(await resolveSignalElement(target), image);
  } finally { env.restore(); }
});

test('element capture and resolution exclude private parents, changed identity and selector-only evidence', async () => {
  const env = fixture();
  try {
    const canvas = env.element('canvas', env.body, { attributes: { id: 'public-chart' } });
    document.elementFromPoint = () => canvas;
    const target = captureSignalTarget(20, 10);
    canvas.attributes = { id: 'different-chart' };
    assert.equal(await resolveSignalElement(target), undefined);
    assert.equal(await resolveSignalElement({ kind: 'element', tag: 'canvas', path: 'canvas', x: .2, y: .5 }), undefined);
    for (const attributes of [{ class: 'wallet-balance' }, { id: 'tradePanel' }]) {
      const parent = env.element('div', env.body, { attributes });
      const image = env.element('img', parent, { attributes: { src: 'https://example.com/public.png' } });
      document.elementFromPoint = () => image;
      assert.deepEqual(captureSignalTarget(20, 10), { kind: 'page' });
      assert.equal(await resolveSignalElement({ kind: 'element', tag: 'img', src: 'https://example.com/public.png', x: .2, y: .5 }), undefined);
    }
    const form = env.element('form');
    const child = env.element('div', form); env.text('secret', child, true);
    document.elementFromPoint = () => child;
    assert.deepEqual(captureSignalTarget(20, 10), { kind: 'page' });
  } finally { env.restore(); }
});

test('generic trade regions exclude otherwise public canvases and descendants', async () => {
  const env = fixture();
  try {
    const panel = env.element('div', env.body, { attributes: { class: 'trade-panel' } });
    const canvas = env.element('canvas', panel, { attributes: { id: 'public-chart' } });
    document.elementFromPoint = () => canvas;
    assert.deepEqual(captureSignalTarget(20, 10), { kind: 'page' });
    assert.equal(await resolveSignalElement({ kind: 'element', tag: 'canvas', id: 'public-chart', x: .2, y: .5 }), undefined);
  } finally {
    env.restore();
  }
});

test('element resolution rejects partial scans, aborts and DOM mutations', async () => {
  const env = fixture();
  try {
    env.element('canvas', env.body, { attributes: { id: 'public-chart' } });
    const target = { kind: 'element', tag: 'canvas', id: 'public-chart', x: .2, y: .5 };
    assert.equal(await resolveSignalElement(target, { budgetMs: 0 }), undefined);
    assert.equal(await resolveSignalElement(target, { signal: AbortSignal.abort() }), undefined);
    for (let i = 0; i < 200; i++) env.element('span');
    let notify;
    env.set('MutationObserver', class { constructor(callback) { notify = callback; } observe() {} takeRecords() { return []; } disconnect() {} });
    let time = 0; env.set('performance', { now: () => ++time / 10 });
    setTimeout(() => notify(), 0);
    assert.equal(await resolveSignalElement(target, { budgetMs: 1000 }), undefined);
  } finally { env.restore(); }
});

test('resolves cross-node text with strict context and normalized whitespace', async () => {
  const env = fixture();
  try {
    env.text('wrong hello world context');
    const p = env.element(); const first = env.text('before hello ', p); const last = env.text('\nworld after', env.element('span', p));
    const target = quote('hello world', 'before ', ' after');
    const range = await resolveSignalTarget(target);
    assert.equal(range.startContainer, first); assert.equal(range.startOffset, 7);
    assert.equal(range.endContainer, last); assert.equal(range.endOffset, 6);
    assert.equal(await resolveSignalTarget({ ...target, suffix: ' changed' }), undefined);
    assert.equal(await resolveSignalTarget(quote('helloworld')), undefined);
    assert.equal(await resolveSignalTarget({ kind: 'page' }), undefined);
  } finally { env.restore(); }
});

test('ambiguity and numeric changes never use approximate matches', async () => {
  const env = fixture();
  try {
    env.text('Price 1 23 USD'); env.text('Price 1\n23 USD');
    assert.equal(await resolveSignalTarget(quote('1 23', 'Price ', ' USD')), undefined);
    assert.equal(await resolveSignalTarget(quote('12 3', 'Price ', ' USD')), undefined);
    assert.equal(await resolveSignalTarget(quote('123', 'Price ', ' USD')), undefined);
  } finally { env.restore(); }
});

test('sensitive subtrees are unread and interrupt matching across their boundaries', async () => {
  const env = fixture();
  try {
    env.text('hello'); env.text('secret', env.element('button'), true); env.text('world');
    env.text('helloworld', env.element('div', env.body, { attributes: { class: 'wallet-balance' } }), true);
    env.text('helloworld', env.element('div', env.body, { style: { display: 'none' } }), true);
    assert.equal(await resolveSignalTarget(quote('helloworld')), undefined);
    const publicText = env.text('helloworld');
    assert.equal((await resolveSignalTarget(quote('helloworld'))).startContainer, publicText);
  } finally { env.restore(); }
});

test('zero budget and cancellation return no partial match, and work yields to timers', async () => {
  const env = fixture();
  try {
    env.text('known target'); env.text('x'.repeat(100_000));
    const target = quote('known target');
    assert.equal(await resolveSignalTarget(target, { budgetMs: 0 }), undefined);
    assert.equal(await resolveSignalTarget(target, { signal: AbortSignal.abort() }), undefined);
    let time = 0; env.set('performance', { now: () => ++time / 10 });
    const controller = new AbortController(); let yielded = false;
    setTimeout(() => { yielded = true; controller.abort(); }, 0);
    assert.equal(await resolveSignalTarget(target, { signal: controller.signal, budgetMs: 1000 }), undefined);
    assert.equal(yielded, true);
    assert.equal(await resolveSignalTarget(target, { budgetMs: 1 }), undefined);
  } finally { env.restore(); }
});

test('DOM mutations during a yielded scan invalidate the result', async () => {
  const env = fixture();
  try {
    env.text('known target'); env.text('x'.repeat(1000));
    let notify; let disconnected = false;
    env.set('MutationObserver', class { constructor(callback) { notify = callback; } observe() {} takeRecords() { return []; } disconnect() { disconnected = true; } });
    let time = 0; env.set('performance', { now: () => ++time / 10 });
    setTimeout(() => notify(), 0);
    assert.equal(await resolveSignalTarget(quote('known target'), { budgetMs: 1000 }), undefined);
    assert.equal(disconnected, true);
  } finally { env.restore(); }
});

test('signal text has no node or text cap while signal elements retain their traversal cap', async () => {
  const env = fixture();
  try {
    env.set('performance', { now: () => 0 });
    for (let i = 0; i < 12_001; i += 1) env.text('x'.repeat(24));
    const source = env.text(' known target ');
    assert.equal((await resolveSignalTarget(quote('known target')))?.startContainer, source);
    const image = env.element('img', env.body, { attributes: { id: 'public-image' } });
    const target = { kind: 'element', tag: 'img', id: 'public-image', x: .5, y: .5 };
    assert.equal(await resolveSignalElement(target), undefined);
    env.body.children = [image];
    assert.equal(await resolveSignalElement(target), image);
  } finally { env.restore(); }
});
