/* global document, window, location, innerWidth, innerHeight, engines, locations, pageScroll, locationCalls -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const engineSource = `export default class Engine {
  comments = []; _ = { position: 0, runningList: [] }; emitted = []; destroyed = false;
  constructor(options) { this.options = options; globalThis.engines.push(this); }
  emit(comment) { this.comments.push(comment); this.emitted.push(comment); }
  clear() { this.cleared = true; }
  resize() {} show() {} hide() {}
  destroy() { this.destroyed = true; }
}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/page-layer/index.ts')) {
      const source = specifier === './overlay' ? 'export const defaultLabels = {}; export const createOverlay = send => { globalThis.layerSend = send; return globalThis.layerOverlay; };' : specifier === './picker' ? 'export const createPicker = () => globalThis.layerPicker;' : specifier === './signals' ? 'export const createSignals = () => ({configure(){},receive(){},result(){},suspend(){},clear(){},dispose(){}});' : specifier === 'wxt/browser' ? 'export const browser = {runtime:{getURL:path=>path}};' : undefined;
      if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    }
    if (['overlay', 'danmaku-renderer', 'reference-outline', 'sticky-projection', 'capture-host'].some(name => context.parentURL?.endsWith(`/page-layer/${name}.ts`))) {
      const source = specifier.startsWith('danmaku/') ? engineSource : specifier === './capture' ? 'export const createCaptureEditor = () => ({ stop() {} });' : specifier === './targets' ? 'export const invalidateTargets = () => globalThis.targetInvalidator?.(); export const locate = target => { globalThis.locationCalls.push(target); return globalThis.targetLocator ? globalThis.targetLocator(target) : globalThis.locations.get(target); };' : undefined;
      if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && context.parentURL?.includes('/src/page-layer/')) return next(specifier + '.ts', context);
    return next(specifier, context);
  },
});
const { createOverlay } = await import('../apps/extension/src/page-layer/overlay.ts');
const { measureDanmakuArea } = await import('../apps/extension/src/page-layer/danmaku-renderer.ts');
const { startPageLayer } = await import('../apps/extension/src/page-layer/index.ts');
const targets = await import('../apps/extension/src/page-layer/targets.ts');
hooks.deregister();

class ElementStub {
  nodeType = 1;
  children = []; style = { setProperty(name, value) { this[name] = value; } }; dataset = {}; listeners = new Map(); attributes = new Map(); isConnected = true;
  className = ''; hidden = false; offsetWidth = 28; offsetHeight = 28; clientWidth = 800;
  rect = { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 };
  classList = {
    add: name => { this.className += ' ' + name; },
    remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); },
    toggle: (name, on) => { if (on) this.classList.add(name); else this.classList.remove(name); },
  };
  constructor(tag) { this.tagName = tag; }
  get parentNode() { return this.parentElement; }
  get firstChild() { return this.children[0] ?? null; }
  get previousSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] ?? null; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  closest(selector) { return selector.split(',').includes(this.tagName.toLowerCase()) ? this : this.parentElement?.closest(selector) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  attachShadow(options) { this.shadowMode = options.mode; this.shadow = new ElementStub('shadow'); return this.shadow; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  toggleAttribute(name, on) { if (on) this.attributes.set(name, ''); else this.attributes.delete(name); }
  getBoundingClientRect() { return this.tagName === 'palside-page-layer' ? { ...this.rect, left: -globalThis.pageScroll.x, top: -globalThis.pageScroll.y } : this.rect; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() {}
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector === '[data-id]' && 'id' in node.dataset;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
function fixture() {
  const previous = new Map();
  const set = (key, value) => { previous.set(key, globalThis[key]); globalThis[key] = value; };
  let id = 0;
  const timers = new Map(), intervals = new Map(), frames = new Map(), listeners = new Map(), observers = [];
  const registry = new Map();
  const motion = { matches: false, addEventListener(type, listener) { this.listener = listener; }, removeEventListener() { this.listener = undefined; } };
  const body = new ElementStub('body'), root = new ElementStub('html'); root.append(body);
  set('engines', []); set('locations', new Map()); set('locationCalls', []); set('pageScroll', { x: 0, y: 0 });
  set('document', { body, documentElement: root, adoptedStyleSheets: [], createElement: tag => new ElementStub(tag), querySelectorAll: () => [],
    addEventListener(type, listener, options) { listeners.set(listener, { type, options, target: 'document' }); }, removeEventListener(type, listener) { listeners.delete(listener); },
  });
  set('getComputedStyle', element => ({ backgroundColor: 'rgb(255,255,255)', position: 'static', overflowX: 'visible', overflowY: 'visible', ...element.computedStyle }));
  set('location', { hostname: 'example.com' }); set('innerWidth', 800); set('innerHeight', 600);
  set('CSS', { highlights: registry }); set('CSSStyleSheet', class { replaceSync(rule) { this.rule = rule; } });
  set('Highlight', class { constructor(...ranges) { this.ranges = ranges; } });
  set('matchMedia', () => motion);
  set('requestAnimationFrame', callback => { frames.set(++id, callback); return id; });
  set('cancelAnimationFrame', frame => frames.delete(frame));
  class Observer {
    disconnected = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node, options) { this.disconnected = false; if (options) this.options = options; }
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
  }
  set('ResizeObserver', Observer); set('MutationObserver', Observer);
  set('window', {
    setTimeout(callback) { timers.set(++id, callback); return id; }, clearTimeout(timer) { timers.delete(timer); },
    setInterval(callback) { intervals.set(++id, callback); return id; }, clearInterval(timer) { intervals.delete(timer); },
    addEventListener(type, listener, options) { listeners.set(listener, { type, options }); }, removeEventListener(type, listener) { listeners.delete(listener); },
  });
  return { set, registry, timers, intervals, frames, listeners, observers, motion, restore() { for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}

test('native selection actions retain labels, preserve the Range on pointerdown and cancel on Escape', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const calls = [];
    overlay.setLabels({ quote: 'Quote', mark: 'Sticky', cancel: 'Cancel' });
    overlay.showSelection({ x: 100, y: 100 }, { quote: () => calls.push('quote'), sticky: () => calls.push('sticky'), cancel: () => calls.push('cancel') });
    let menu = overlay.host.shadow.querySelectorAll('.selection')[0];
    assert.deepEqual(menu.children.map(button => button.textContent), ['Quote', 'Sticky', 'Cancel']);
    let prevented = 0, stopped = 0;
    menu.listeners.get('pointerdown')({ preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    for (const button of menu.children) button.listeners.get('click')({ isTrusted: true });
    assert.deepEqual(calls, ['quote', 'sticky', 'cancel']);
    menu.listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    assert.equal(prevented, 2); assert.equal(stopped, 1); assert.equal(calls.at(-1), 'cancel');
    overlay.showSelection({ x: 100, y: 100 }, { quote: () => {}, cancel: () => {} });
    menu = overlay.host.shadow.querySelectorAll('.selection')[0];
    assert.deepEqual(menu.children.map(button => button.textContent), ['Quote', 'Cancel']);
  } finally { overlay.stop(); env.restore(); }
});

test('density caps pending flights, lowering density takes down excess, and retraction removes only its flight', () => {
  const env = fixture(), sent = [];
  const overlay = createOverlay(message => sent.push(message));
  try {
    const live = engines[0];
    for (const [density, count] of [['low', 4], ['mid', 8], ['high', 14]]) {
      overlay.clear(); overlay.setDanmakuSettings({ enabled: true, density });
      overlay.updateDanmaku(Array.from({ length: 20 }, (_, i) => ({ id: String(i), key: 'token:Solana:test', text: 'hello', author: { name: 'A' } })));
      assert.equal(live.comments.length, count);
    }
    overlay.setDanmakuSettings({ enabled: true, density: 'low' });
    assert.equal(live.comments.length, 4);
    const comment = live.comments[0], line = comment.render();
    line.listeners.get('click')({ isTrusted: true });
    assert.deepEqual(sent.at(-1), { type: 'open-room', key: 'token:Solana:test' });
    overlay.removeDanmaku([line.dataset.id]);
    assert.equal(live.comments.length, 3);
    assert.equal(live.comments.includes(comment), false);
    overlay.updateDanmaku([{ id: line.dataset.id, key: 'token:Solana:test', text: 'duplicate', author: { name: 'A' } }]);
    assert.equal(live.comments.length, 3);
  } finally { overlay.stop(); env.restore(); }
});

test('text pins use document coordinates and page highlights; nested scroll updates synchronously', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const target = { kind: 'quote', exact: 'hello', prefix: '', suffix: '' };
    const owner = new ElementStub('p'); document.body.append(owner);
    let top = 100;
    const range = { startContainer: { parentElement: owner }, getBoundingClientRect: () => ({ left: 100, top, width: 100, height: 20 }) };
    locations.set(target, { range });
    overlay.updateStickies([{ id: 's', target, text: 'note', author: { name: 'A' }, timestamp: Date.now() }]);
    const pin = overlay.host.shadow.querySelectorAll('.pin')[0];
    const initial = pin.style.transform;
    assert.equal(initial, 'translate(194px,78px)');
    assert.deepEqual([...env.registry.values()][0].ranges, [range]);
    pageScroll.y = 40; top = 60;
    for (const [listener, options] of env.listeners) if (options.type === 'scroll') listener({ target: document });
    assert.equal(pin.style.transform, initial, 'ordinary document scroll requires no pin position write');
    top = 30;
    for (const [listener, options] of env.listeners) if (options.type === 'scroll') listener({ target: owner });
    assert.equal(pin.style.transform, 'translate(194px,48px)');
    overlay.updateStickies([]);
    assert.equal(env.registry.size, 0);
    overlay.updateStickies([{ id: 's', target, text: 'note', author: { name: 'A' }, timestamp: Date.now() }]);
    assert.equal(env.registry.size, 1);
  } finally { overlay.stop(); env.restore(); }
});

test('reduced motion uses bounded stationary fading lines without advancing the media clock', () => {
  const env = fixture();
  env.motion.matches = true;
  const overlay = createOverlay(() => {});
  try {
    overlay.updateDanmaku(Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: 'hello', author: { name: 'A' } })));
    assert.equal(engines[0].emitted.length, 0);
    assert.equal(engines[0].options.media.paused, true);
    assert.equal(overlay.host.shadow.querySelectorAll('.static-dm')[0].childElementCount, 8);
  } finally { overlay.stop(); env.restore(); }
});

test('dispose is idempotent and releases engines, frames, observers, listeners, timers and adopted styles', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    overlay.updateDanmaku([{ id: 'd', text: 'hello', author: { name: 'A' } }]);
    assert.ok(env.listeners.size > 0);
    assert.ok(env.frames.size > 0);
    overlay.stop();
    overlay.stop();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.frames.size, 0);
    assert.equal(env.timers.size, 0);
    assert.equal(env.intervals.size, 0);
    assert.equal(env.registry.size, 0);
    assert.equal(document.adoptedStyleSheets.length, 0);
    assert.ok(env.observers.every(observer => observer.disconnected));
    assert.ok(engines.every(engine => engine.destroyed));
    assert.equal(overlay.host.parentElement, null);
  } finally { env.restore(); }
});

test('page off disconnects port listeners and picker exactly once; late messages are ignored', () => {
  const env = fixture();
  let stopped = 0, disposed = 0, deliveries = 0;
  const previous = ['layerOverlay', 'layerPicker', 'addEventListener', 'removeEventListener'].map(key => [key, globalThis[key]]);
  globalThis.layerOverlay = { stop() { stopped += 1; }, updateStickies() { deliveries += 1; } };
  globalThis.layerPicker = { dispose() { disposed += 1; } };
  globalThis.addEventListener = window.addEventListener;
  globalThis.removeEventListener = window.removeEventListener;
  const messages = new Set(), disconnects = new Set(), reasons = [];
  const channel = listeners => ({ addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) });
  const port = { postMessage() {}, onMessage: channel(messages), onDisconnect: channel(disconnects) };
  try {
    const stop = startPageLayer(port, reason => reasons.push(reason));
    const receive = [...messages][0];
    receive({ type: 'stickies', items: [] });
    assert.equal(deliveries, 1);
    receive({ type: 'off' });
    stop();
    receive({ type: 'stickies', items: [] });
    assert.equal(deliveries, 1);
    assert.equal(stopped, 1);
    assert.equal(disposed, 1);
    assert.equal(messages.size + disconnects.size, 0);
    assert.equal(env.listeners.size + env.intervals.size, 0);
    assert.deepEqual(reasons, ['off']);
  } finally {
    for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    env.restore();
  }
});

test('page configuration, context, menu suspension, capture and navigation have separate lifecycles', () => {
  const env = fixture();
  const previous = ['layerOverlay', 'layerPicker', 'addEventListener', 'removeEventListener', 'layerSend'].map(key => [key, globalThis[key]]);
  const calls = [], outbound = [], messages = new Set();
  globalThis.layerOverlay = Object.fromEntries(['setLabels', 'setDanmakuSettings', 'clear', 'stop', 'startCapture'].map(name => [name, (...args) => calls.push([name, ...args])]));
  globalThis.layerPicker = Object.fromEntries(['enable', 'set', 'setSelectionEnabled', 'invalidate', 'dispose', 'result'].map(name => [name, (...args) => calls.push([name, ...args])]));
  globalThis.addEventListener = window.addEventListener; globalThis.removeEventListener = window.removeEventListener;
  location.href = 'https://example.com/first';
  const port = { postMessage: message => outbound.push(message), onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) } };
  try {
    const stop = startPageLayer(port); const receive = [...messages][0];
    receive({ type: 'config', labels: {}, danmaku: {} });
    assert.deepEqual(calls.at(-1), ['enable', true]);
    assert.equal(calls.some(([name]) => name === 'set'), false, 'configuration does not invent a context token');
    receive({ type: 'pick', on: true, canSticky: true, contextId: 'ctx-1' });
    assert.deepEqual(calls.at(-1), ['set', true, true, 'ctx-1']);
    receive({ type: 'selection-enabled', on: false }); assert.deepEqual(calls.at(-1), ['setSelectionEnabled', false]);
    receive({ type: 'selection-enabled', on: true }); assert.deepEqual(calls.at(-1), ['setSelectionEnabled', true]);
    receive({ type: 'capture', src: 'data:image/png;base64,a' });
    assert.deepEqual(calls.at(-2), ['enable', false]);
    globalThis.layerSend({ type: 'capture-cancel' }); assert.deepEqual(calls.at(-1), ['enable', true]);
    assert.equal(outbound.at(-1).type, 'capture-cancel');
    receive({ type: 'clear' }); assert.deepEqual(calls.slice(-2), [['invalidate'], ['clear']]);
    location.href = 'https://example.com/second'; [...env.intervals.values()][0]();
    assert.equal(calls.slice(-4).some(([name]) => name === 'invalidate'), true); assert.equal(outbound.at(-1).url, location.href);
    receive({ type: 'capture', src: 'data:image/png;base64,a' }); globalThis.layerSend({ type: 'captured', src: 'data:image/png;base64,b' });
    assert.deepEqual(calls.at(-1), ['enable', true]);
    stop(); assert.equal(calls.filter(([name]) => name === 'dispose').length, 1);
  } finally { for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; env.restore(); }
});

test('sticky range hits are reused until relevant DOM changes invalidate them', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const target = { kind: 'quote', exact: 'hello', prefix: '', suffix: '' };
    const owner = new ElementStub('p'); document.body.append(owner);
    const range = { startContainer: { parentElement: owner }, commonAncestorContainer: owner, getBoundingClientRect: () => owner.getBoundingClientRect() };
    locations.set(target, { range });
    overlay.updateStickies([{ id: 's', target, text: 'note', author: { name: 'A' }, timestamp: Date.now() }]);
    assert.equal(locationCalls.length, 1);
    for (const [listener, options] of env.listeners) if (options.type === 'scroll') listener({ target: owner });
    assert.equal(locationCalls.length, 1, 'scrolling reuses the range instead of scanning text');
    const observer = env.observers.find(item => item.options?.subtree);
    assert.ok(observer.options.attributeFilter.includes('contenteditable'));
    assert.ok(observer.options.attributeFilter.includes('data-private'));
    locations.delete(target);
    observer.callback([{ target: owner, type: 'characterData' }]);
    observer.callback([{ target: owner, type: 'characterData' }]);
    assert.equal(env.timers.size, 1, 'repeated mutations share a bounded scan timer');
    const timers = [...env.timers.values()]; env.timers.clear(); for (const callback of timers) callback();
    const pending = [...env.frames.values()]; env.frames.clear();
    for (const callback of pending) callback();
    assert.equal(locationCalls.length, 2);
    assert.equal(env.registry.size, 0, 'an invalidated range is removed from highlights');
  } finally { overlay.stop(); env.restore(); }
});

test('hover tooltip insertion preserves the original range, pin and highlight object', () => {
  const env = fixture();
  const messages = [];
  const overlay = createOverlay(message => messages.push(message));
  try {
    const target = { kind: 'quote', exact: 'hello', prefix: '', suffix: '' };
    const owner = new ElementStub('p'); document.body.append(owner);
    const text = new ElementStub('#text'); owner.append(text);
    const range = { startContainer: text, endContainer: text, commonAncestorContainer: text, getBoundingClientRect: () => owner.getBoundingClientRect() };
    locations.set(target, { range });
    overlay.updateStickies([{ id: 's', target, text: 'note', author: { name: 'A' }, timestamp: Date.now() }]);
    const pin = overlay.host.shadow.querySelectorAll('.pin')[0], highlight = [...env.registry.values()][0];
    const observer = env.observers.find(item => item.options?.subtree);
    const flush = () => {
      const timers = [...env.timers.values()]; env.timers.clear(); timers.forEach(callback => callback());
      const frames = [...env.frames.values()]; env.frames.clear(); frames.forEach(callback => callback());
    };
    const tooltip = new ElementStub('div');
    locations.delete(target); // A fresh whole-page lookup would now be ambiguous because the tooltip repeats the quote.
    for (let i = 0; i < 3; i += 1) {
      document.body.append(tooltip);
      observer.callback([{ target: document.body, type: 'childList', addedNodes: [tooltip], removedNodes: [] }]); flush();
      assert.equal(overlay.host.shadow.querySelectorAll('.pin')[0], pin);
      assert.equal([...env.registry.values()][0], highlight);
      tooltip.remove();
      observer.callback([{ target: document.body, type: 'childList', addedNodes: [], removedNodes: [tooltip] }]); flush();
    }
    assert.equal(locationCalls.length, 1, 'unrelated tooltip mutations never scan or replace the known anchor');
    assert.equal(messages.some(message => message.type === 'stickies-located' && message.missing.includes('s')), false);
    text.isConnected = false;
    range.startContainer = owner; range.endContainer = owner; range.commonAncestorContainer = owner;
    observer.callback([{ target: owner, type: 'childList', addedNodes: [], removedNodes: [text] }]); flush();
    assert.equal(locationCalls.length, 2, 'removed original endpoints invalidate even when the live Range moved to its parent');
    assert.equal(env.registry.size, 0);
    assert.equal(overlay.host.shadow.querySelectorAll('.pin').length, 0);
  } finally { overlay.stop(); env.restore(); }
});

test('record refreshes preserve unchanged pins and ranges while updated notes refresh their content', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const target = { kind: 'quote', exact: 'hello', prefix: '', suffix: '' };
    const owner = new ElementStub('p'); document.body.append(owner);
    const range = { startContainer: { parentElement: owner }, commonAncestorContainer: owner, getBoundingClientRect: () => owner.getBoundingClientRect() };
    locations.set(target, { range });
    const item = { id: 's', target, text: 'note', author: { name: 'A' }, timestamp: Date.now() };
    overlay.updateStickies([item]);
    const pin = overlay.host.shadow.querySelectorAll('.pin')[0], highlight = [...env.registry.values()][0];
    for (let i = 0; i < 3; i += 1) overlay.updateStickies([structuredClone(item)]);
    assert.equal(overlay.host.shadow.querySelectorAll('.pin')[0], pin);
    assert.equal([...env.registry.values()][0], highlight);
    assert.equal(locationCalls.length, 1);
    const other = { ...item, id: 'other', target: { ...target, exact: 'other' } };
    overlay.updateStickies([structuredClone(item), other]);
    assert.equal(overlay.host.shadow.querySelectorAll('.pin')[0], pin, 'an unrelated new missing record does not recreate this pin');
    overlay.updateStickies([{ ...item, text: 'updated note' }]);
    assert.equal(overlay.host.shadow.querySelectorAll('.pin')[0].title, 'updated note');
    assert.equal([...env.registry.values()][0], highlight, 'editing a note does not replace its unchanged highlight');
  } finally { overlay.stop(); env.restore(); }
});

test('locating the same target reuses its outline and refreshes only one lifetime', () => {
  const env = fixture();
  const replies = [];
  const overlay = createOverlay(message => replies.push(message));
  try {
    const target = { kind: 'quote', exact: 'hello', prefix: '', suffix: '' };
    const owner = new ElementStub('p'); document.body.append(owner);
    locations.set(target, { el: owner });
    overlay.showFlash(target, { name: 'A' }, 'first');
    const box = overlay.stage.querySelectorAll('.box')[0];
    const originalTimers = [...env.timers.keys()];
    for (const callback of [...env.timers.values()].slice(0, 1)) callback();
    assert.ok(box.className.includes('leaving'));
    const reordered = { suffix: '', exact: 'hello', kind: 'quote', prefix: '' };
    locations.set(reordered, { el: owner });
    overlay.showFlash(reordered, { name: 'B' }, 'second');
    assert.equal(overlay.stage.querySelectorAll('.box')[0], box, 'same target reuses the actual node');
    assert.equal(overlay.stage.querySelectorAll('.box').length, 1);
    assert.equal(overlay.stage.querySelectorAll('.edge').length, 1);
    assert.equal(env.frames.size, 1);
    assert.equal(env.timers.size, 2);
    assert.ok(originalTimers.every(id => !env.timers.has(id)), 'old expiry callbacks are cancelled');
    assert.ok(!box.className.includes('leaving'));
    assert.deepEqual(replies.map(reply => [reply.requestId, reply.result]), [['first', 'shown'], ['second', 'shown']]);
    const expire = [...env.timers.values()].at(-1); expire();
    assert.equal(overlay.stage.querySelectorAll('.box').length, 0);
    assert.equal(overlay.stage.querySelectorAll('.edge').length, 0);
    assert.equal(env.frames.size, 0);
    assert.equal(env.timers.size, 0);
  } finally { overlay.stop(); env.restore(); }
});

test('different targets coexist but disconnected or missing references release their resources', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const first = { kind: 'quote', exact: 'first', prefix: '', suffix: '' };
    const second = { kind: 'quote', exact: 'second', prefix: '', suffix: '' };
    const one = new ElementStub('p'), two = new ElementStub('p'); document.body.append(one, two);
    locations.set(first, { el: one }); locations.set(second, { el: two });
    overlay.showFlash(first, { name: 'A' }); overlay.showFlash(second, { name: 'B' });
    assert.equal(overlay.stage.querySelectorAll('.box').length, 2);
    one.isConnected = false;
    const frames = [...env.frames.values()]; env.frames.clear(); for (const callback of frames) callback();
    assert.equal(overlay.stage.querySelectorAll('.box').length, 1);
    assert.equal(env.frames.size, 1);
    assert.equal(env.timers.size, 2);
    locations.delete(second); overlay.showFlash(second, { name: 'B' });
    assert.equal(overlay.stage.querySelectorAll('.box').length, 0);
    assert.equal(env.frames.size, 0);
    assert.equal(env.timers.size, 0);
  } finally { overlay.stop(); env.restore(); }
});

test('chart area falls back to top, top ignores charts, and full covers the viewport', () => {
  const env = fixture();
  try {
    assert.deepEqual(measureDanmakuArea('chart'), { top: 0, left: 0, width: innerWidth, height: innerHeight * 0.25 });
    assert.deepEqual(measureDanmakuArea('top'), measureDanmakuArea('chart'));
    assert.deepEqual(measureDanmakuArea('full'), { top: 0, left: 0, width: innerWidth, height: innerHeight });
  } finally { env.restore(); }
});

test('synthetic selection, sticky and danmaku actions cannot send or dismiss', () => {
  const env = fixture(), sent = [], actions = [];
  const overlay = createOverlay(message => sent.push(message));
  try {
    overlay.showSelection({ x: 100, y: 100 }, { quote: () => actions.push('quote'), sticky: () => actions.push('sticky'), cancel: () => actions.push('cancel') });
    const menu = overlay.host.shadow.querySelectorAll('.selection')[0];
    for (const button of menu.children) button.listeners.get('click')({ isTrusted: false });
    menu.listeners.get('keydown')({ isTrusted: false, key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(actions, []);
    overlay.showSavedMark('sticky');
    const saved = overlay.host.shadow.querySelectorAll('.selection').at(-1);
    saved.children[1].listeners.get('click')({ isTrusted: false });
    assert.deepEqual(sent, []);
    saved.children[1].listeners.get('click')({ isTrusted: true });
    assert.equal(sent.at(-1).type, 'open-sticky');
    overlay.setDanmakuSettings({ enabled: true });
    overlay.updateDanmaku([{ id: 'one', key: 'token:Solana:test', text: 'hello', author: { name: 'A' } }]);
    const line = engines[0].comments[0].render();
    line.listeners.get('click')({ isTrusted: false });
    assert.equal(sent.length, 1);
    line.listeners.get('click')({ isTrusted: true });
    assert.equal(sent.at(-1).type, 'open-room');
  } finally { overlay.stop(); env.restore(); }
});

function textPage(env, count = 13_000, length = 24) {
  env.set('Node', { TEXT_NODE: 3 });
  env.set('NodeFilter', { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 });
  let traversals = 0;
  document.createTreeWalker = (root, flags, filter) => {
    traversals += 1;
    function* walk(parent) {
      for (const child of parent.children) {
        const decision = flags & (1 << (child.nodeType - 1)) ? filter?.acceptNode(child) ?? 1 : 3;
        if (decision === 1) yield child;
        if (decision !== 2) yield* walk(child);
      }
    }
    const iterator = walk(root);
    return { nextNode: () => iterator.next().value ?? null };
  };
  env.set('targetLocator', targets.locate);
  env.set('targetInvalidator', targets.invalidateTargets);
  const sources = [];
  const append = value => {
    const owner = new ElementStub('p'), text = new ElementStub('#text');
    Object.assign(text, { nodeType: 3, data: value, length: value.length, reads: 0,
      substringData(start, count) { this.reads += 1; return this.data.slice(start, start + count); } });
    owner.append(text); document.body.append(owner); sources.push(text); return text;
  };
  for (let i = 0; i < count; i += 1) append('x'.repeat(length));
  document.createRange = () => ({
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    get commonAncestorContainer() { return this.startContainer.parentElement; },
    getBoundingClientRect() { return this.startContainer.parentElement.getBoundingClientRect(); },
    toString() {
      const start = sources.indexOf(this.startContainer), end = sources.indexOf(this.endContainer);
      return sources.slice(start, end + 1).map((node, i) => node.data.slice(i === 0 ? this.startOffset : 0, start + i === end ? this.endOffset : node.length)).join('');
    },
  });
  const mutate = target => {
    for (const observer of env.observers.filter(item => item.options?.subtree && !item.disconnected)) observer.callback([{ target, type: 'characterData' }]);
  };
  return { sources, append, mutate, get traversals() { return traversals; } };
}

test('many stickies and reference locates share one complete traversal of a large page', () => {
  const env = fixture(), messages = [];
  let overlay;
  try {
    const page = textPage(env);
    const items = Array.from({ length: 20 }, (_, i) => {
      const target = { kind: 'quote', exact: `quote ${i}!`, prefix: 'before ', suffix: ' after' };
      page.append(` before ${target.exact} after `);
      return { id: String(i), target, text: 'note', author: { name: 'A' }, timestamp: 1 };
    });
    const address = { kind: 'address', text: '0x1234567890abcdef1234567890abcdef12345678' };
    page.append(` ${address.text} `);
    items.push({ id: 'address', target: address, text: 'note', author: { name: 'A' }, timestamp: 1 });
    overlay = createOverlay(message => messages.push(message));
    overlay.updateStickies(items);
    for (const item of items) overlay.showFlash(item.target, { name: 'A' }, item.id);
    assert.equal(messages.filter(item => item.type === 'located' && item.result === 'shown').length, items.length);
    assert.ok(overlay.host.shadow.querySelectorAll('.pin').length > 0);
    assert.equal(messages.some(item => item.missing?.length), false);
    assert.equal(page.traversals, 1);
    assert.ok(page.sources.every(node => node.reads === 1));
    const calls = locationCalls.length;
    page.mutate(page.sources[0]);
    for (const [id, callback] of [...env.timers]) { env.timers.delete(id); callback(); }
    for (const [id, callback] of [...env.frames]) { env.frames.delete(id); callback(); }
    assert.equal(locationCalls.length, calls, 'unrelated mutations preserve attached sticky locations');
    overlay.showFlash(items[0].target, { name: 'A' }, 'again');
    assert.equal(page.traversals, 2, 'a reference rebuilds the invalidated shared index');
    overlay.showFlash(items[1].target, { name: 'A' });
    assert.equal(page.traversals, 2);
  } finally { overlay?.stop(); targets.invalidateTargets(); env.restore(); }
});

test('related text mutations coalesce sticky relocation and preserve quote context rules', () => {
  const env = fixture(), messages = [];
  let overlay;
  try {
    const page = textPage(env, 0);
    const target = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const source = page.append('before known target after');
    overlay = createOverlay(message => messages.push(message));
    overlay.updateStickies([{ id: 'sticky', target, text: 'note', author: { name: 'A' }, timestamp: 1 }]);
    assert.equal(overlay.host.shadow.querySelectorAll('.pin').length, 1);
    source.data = 'xxxxxx known target after';
    page.mutate(source); page.mutate(source);
    for (const [id, callback] of [...env.timers]) { env.timers.delete(id); callback(); }
    for (const [id, callback] of [...env.frames]) { env.frames.delete(id); callback(); }
    assert.equal(overlay.host.shadow.querySelectorAll('.pin').length, 0);
    assert.ok(messages.some(item => item.missing?.includes('sticky')));
    assert.equal(page.traversals, 2);
  } finally { overlay?.stop(); targets.invalidateTargets(); env.restore(); }
});
