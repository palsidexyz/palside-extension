/* global document, window, location, innerWidth, innerHeight, engines -- installed on globalThis by this file's DOM fixture */
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
      const source = specifier === './overlay' ? 'export const defaultLabels = {}; export const createOverlay = send => { globalThis.layerSend = send; return globalThis.layerOverlay; };' : specifier === './signals' ? 'export const createSignals = () => ({configure(){},receive(){},result(){},suspend(){},clear(){},dispose(){}});' : specifier === 'wxt/browser' ? 'export const browser = {runtime:{getURL:path=>path}};' : undefined;
      if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    }
    if (['overlay', 'danmaku-renderer', 'capture-host'].some(name => context.parentURL?.endsWith(`/page-layer/${name}.ts`))) {
      const source = specifier.startsWith('danmaku/') ? engineSource : specifier === './capture' ? 'export const createCaptureEditor = () => ({ stop() {} });' : undefined;
      if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && context.parentURL?.includes('/src/page-layer/')) return next(specifier + '.ts', context);
    return next(specifier, context);
  },
});
const { createOverlay } = await import('../apps/extension/src/page-layer/overlay.ts');
const { measureDanmakuArea } = await import('../apps/extension/src/page-layer/danmaku-renderer.ts');
const { startPageLayer } = await import('../apps/extension/src/page-layer/index.ts');
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
  matches(selector) { return selector.split(',').includes(this.tagName.toLowerCase()); }
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
  const clock = { now: 1_000 }, delays = [];
  set('performance', { now: () => clock.now });
  set('engines', []); set('pageScroll', { x: 0, y: 0 });
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
    navigation: { addEventListener() {}, removeEventListener() {} },
    setTimeout(callback, delay) { delays.push(delay); timers.set(++id, callback); return id; }, clearTimeout(timer) { timers.delete(timer); },
    setInterval(callback) { intervals.set(++id, callback); return id; }, clearInterval(timer) { intervals.delete(timer); },
    addEventListener(type, listener, options) { listeners.set(listener, { type, options }); }, removeEventListener(type, listener) { listeners.delete(listener); },
  });
  return { set, clock, delays, registry, timers, intervals, frames, listeners, observers, motion, restore() { for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}

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
    // A 红包 line names its packet, so the side panel opens that envelope.
    overlay.setDanmakuSettings({ enabled: true, density: 'high' });
    overlay.updateDanmaku([{ id: 'p1', key: 'token:Solana:test', text: '', packet: true, author: { name: 'Kai' } }]);
    const packetLine = live.comments.at(-1).render();
    assert.equal(packetLine.dataset.packet, '');
    packetLine.listeners.get('click')({ isTrusted: true });
    assert.deepEqual(sent.at(-1), { type: 'open-room', key: 'token:Solana:test', packet: 'p1' });
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

test('page off disconnects port listeners exactly once; late messages are ignored', () => {
  const env = fixture();
  let stopped = 0, deliveries = 0;
  const previous = ['layerOverlay', 'addEventListener', 'removeEventListener'].map(key => [key, globalThis[key]]);
  globalThis.layerOverlay = { stop() { stopped += 1; }, removeDanmaku() { deliveries += 1; } };
  globalThis.addEventListener = window.addEventListener;
  globalThis.removeEventListener = window.removeEventListener;
  const messages = new Set(), disconnects = new Set(), reasons = [];
  const channel = listeners => ({ addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) });
  const port = { postMessage() {}, onMessage: channel(messages), onDisconnect: channel(disconnects) };
  try {
    const stop = startPageLayer(port, reason => reasons.push(reason));
    const receive = [...messages][0];
    receive({ type: 'danmaku-remove', ids: [] });
    assert.equal(deliveries, 1);
    receive({ type: 'off' });
    stop();
    receive({ type: 'danmaku-remove', ids: [] });
    assert.equal(deliveries, 1);
    assert.equal(stopped, 1);
    assert.equal(messages.size + disconnects.size, 0);
    assert.equal(env.listeners.size + env.intervals.size, 0);
    assert.deepEqual(reasons, ['off']);
  } finally {
    for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    env.restore();
  }
});

test('page configuration, capture and navigation have separate lifecycles', () => {
  const env = fixture();
  const previous = ['layerOverlay', 'addEventListener', 'removeEventListener', 'layerSend'].map(key => [key, globalThis[key]]);
  const calls = [], outbound = [], messages = new Set();
  globalThis.layerOverlay = Object.fromEntries(['setLabels', 'setDanmakuSettings', 'clear', 'stop', 'startCapture'].map(name => [name, (...args) => calls.push([name, ...args])]));
  globalThis.addEventListener = window.addEventListener; globalThis.removeEventListener = window.removeEventListener;
  location.href = 'https://example.com/first';
  const entries = new Set();
  window.navigation = { addEventListener: (_type, listener) => entries.add(listener), removeEventListener: (_type, listener) => entries.delete(listener) };
  const port = { postMessage: message => outbound.push(message), onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) } };
  try {
    const stop = startPageLayer(port); const receive = [...messages][0];
    receive({ type: 'config', labels: {}, danmaku: {} });
    assert.deepEqual(calls.slice(-2).map(([name]) => name), ['setLabels', 'setDanmakuSettings']);
    receive({ type: 'capture', src: 'data:image/png;base64,a' });
    assert.equal(calls.at(-1)[0], 'startCapture');
    globalThis.layerSend({ type: 'capture-cancel' });
    assert.equal(outbound.at(-1).type, 'capture-cancel');
    receive({ type: 'clear' }); assert.deepEqual(calls.at(-1), ['clear']);
    const before = outbound.length;
    for (const listener of entries) listener();
    assert.equal(outbound.length, before, 'replaceState to the same address is not a navigation');
    location.href = 'https://example.com/second'; for (const listener of entries) listener();
    assert.equal(outbound.at(-1).url, location.href);
    receive({ type: 'capture', src: 'data:image/png;base64,a' });
    const cleared = calls.filter(([name]) => name === 'clear').length;
    location.href = 'https://example.com/third'; for (const listener of entries) listener();
    assert.equal(calls.filter(([name]) => name === 'clear').length, cleared + 1, 'an address change ends a running capture');
    stop(); stop(); assert.equal(calls.filter(([name]) => name === 'stop').length, 1);
  } finally { for (const [key, value] of previous) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; env.restore(); }
});

test('replayed lines wait for room on a full screen while live lines are skipped, and a retraction reaches the wait', () => {
  const env = fixture();
  const overlay = createOverlay(() => {});
  try {
    const item = (id, replay) => ({ id, key: 'token:Solana:test', text: id, author: { name: 'A' }, ...(replay ? { replay: true } : {}) });
    overlay.updateDanmaku(Array.from({ length: 12 }, (_, i) => item(`r${i}`, true)));
    overlay.updateDanmaku([item('live')]);
    const live = engines[0], ids = () => live.comments.map(comment => comment.render().dataset.id);
    const shown = Array.from({ length: 8 }, (_, i) => `r${i}`);
    assert.deepEqual(ids(), shown, 'the screen limit holds and the live line is skipped');
    overlay.removeDanmaku(['r8', 'r0', 'r1']);
    const tick = [...env.intervals.values()][0];
    tick(); assert.deepEqual(ids().slice(-1), ['r9'], 'one line per second; the retracted one never flies');
    tick(); assert.deepEqual(ids().slice(-2), ['r9', 'r10']);
    tick(); assert.equal(ids().length, 8); assert.equal(ids().includes('r11'), false, 'still waiting');
    overlay.clear(); overlay.removeDanmaku(['r2', 'r3']);
    tick(); assert.equal(ids().includes('r11'), false, 'a cleared page keeps no wait');
  } finally { overlay.stop(); env.restore(); }
});

test('danmaku area takes its share of the viewport height from the top and ignores charts', () => {
  const env = fixture();
  try {
    assert.deepEqual(measureDanmakuArea(), { top: 0, left: 0, width: innerWidth, height: innerHeight * 0.5 });
    assert.deepEqual(measureDanmakuArea(25), { top: 0, left: 0, width: innerWidth, height: innerHeight * 0.25 });
    assert.deepEqual(measureDanmakuArea(50), { top: 0, left: 0, width: innerWidth, height: innerHeight * 0.5 });
    assert.deepEqual(measureDanmakuArea(100), { top: 0, left: 0, width: innerWidth, height: innerHeight });
  } finally { env.restore(); }
});

test('synthetic danmaku clicks cannot open the room', () => {
  const env = fixture(), sent = [];
  const overlay = createOverlay(message => sent.push(message));
  try {
    overlay.setDanmakuSettings({ enabled: true });
    overlay.updateDanmaku([{ id: 'one', key: 'token:Solana:test', text: 'hello', author: { name: 'A' } }]);
    const line = engines[0].comments[0].render();
    line.listeners.get('click')({ isTrusted: false });
    assert.equal(sent.length, 0);
    line.listeners.get('click')({ isTrusted: true });
    assert.equal(sent.at(-1).type, 'open-room');
  } finally { overlay.stop(); env.restore(); }
});

