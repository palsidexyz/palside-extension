import { SECOND_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { WHEEL, pickSlice } from '../packages/shared/src/signal-art/geometry.ts';
import { createSignalManifest } from '../packages/shared/src/signal-art/manifest.ts';
import { defaultSignalSettings, isEmote, normalizeSignalSettings, SIGNAL_TTL } from '../apps/extension/src/runtime/annotations/signals.ts';

function script(file) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source).replace(/^export /, '')).join('\n');
  return ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function fixture() {
  const timers = new Map(), handlers = new Map(); let sequence = 0;
  const listen = (object, name, callback, options) => {
    if (!handlers.has(object)) handlers.set(object, new Map());
    const events = handlers.get(object); if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback); options?.signal?.addEventListener('abort', () => events.get(name).delete(callback), { once: true });
  };
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.className = ''; this.hidden = false;
      this.classList = { add: value => { this.className += ` ${value}`; }, remove: value => { this.className = this.className.split(' ').filter(c => c !== value).join(' '); }, toggle: (value, on) => on ? this.classList.add(value) : this.classList.remove(value) };
    }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    setAttribute(name, value) { this.attrs[name] = value; if (name === 'class') this.className = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    replaceWith(node) { const parent = this.parent; parent.children[parent.children.indexOf(this)] = node; node.parent = parent; }
    querySelector(selector) { return this.children.find(child => child.className.split(' ').includes(selector.slice(1))) ?? this.children.map(child => child.querySelector(selector)).find(Boolean); }
    addEventListener(...args) { listen(this, ...args); }
    getAnimations() { return []; }
    get lastElementChild() { return this.children.at(-1); }
  }
  const document = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, documentElement: new Element('html'),
    createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag),
    elementFromPoint: () => hit, addEventListener(...args) { listen(this, ...args); } };
  // `blocked` stands for an editable field; a canvas is blocked by its tag.
  const hit = { readable: true, closest(selector) { return this.blocked || selector.split(',').includes(this.tagName?.toLowerCase()) ? this : null; } };
  const window = { navigation: { addEventListener(...args) { listen(this, ...args); } }, addEventListener(...args) { listen(this, ...args); } };
  const motion = { matches: false, addEventListener(...args) { listen(this, ...args); } };
  const calls = [], plays = [], audio = [], observers = [];
  const ctx = vm.createContext({ SECOND_MS, document, window, matchMedia: () => motion, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: element => ({ zoom: element.style.zoom ?? '1' }),
    location: { href: 'https://example.com/', hostname: 'example.com' }, AbortController, crypto, performance, Date,
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    setTimeout: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence; }, clearTimeout: id => timers.delete(id),
    WHEEL, pickSlice, createSignalManifest, defaultSignalSettings, isEmote, normalizeSignalSettings, SIGNAL_TTL, signalArtCss: '', paletteCss: '',
    adapterFor: () => ({}), privateSelector: 'canvas,[data-private]', isTradeElement: element => element.attrs?.id === 'trade',
    readable: element => element?.readable === true, normalizeQuoteWhitespace: value => value.trim().replace(/\s+/g, ' '),
    captureSignalTarget: () => ({ kind: 'page' }), resolveSignalSpot: () => undefined, spotAlive: spot => spot.alive !== false,
    Audio: class { constructor(url) { audio.push(url); } pause() {} removeAttribute() {} load() {} play() { return Promise.reject(Error('denied')); } },
    EmoteStage: class { constructor(layer) { this.layer = layer; } dispose() {} clear() {} spawn(owner, art, x, y) { const root = new Element('div'); this.layer.append(root); plays.push({ owner, art, x, y }); } },
    spawnPing: (layer, ping, x, y) => { const root = new Element('div'); layer.append(root); plays.push({ ping, x, y }); return root; },
  });
  vm.runInContext(script('../packages/shared/src/signal-art/wheel.ts'), ctx);
  vm.runInContext(script('../apps/extension/src/page-layer/signals.ts'), ctx);
  const controller = vm.runInContext('createSignals', ctx)(message => calls.push(message), 'chrome-extension://test/signals/');
  const labels = Object.fromEntries(['failed', 'locate', 'unmatched', 'page', 'cancel', 'send', 'emote', 'danger', 'together'].map(key => [key, key]));
  const configure = (settings = {}, on = true) => controller.configure(on, { ...defaultSignalSettings, ...settings }, labels);
  configure();
  function emit(type, changes = {}, target = window) {
    const event = { clientX: 500, clientY: 400, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      composedPath: () => [hit], preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, stopPropagation() {}, ...changes };
    for (const fn of handlers.get(target)?.get(type) ?? []) fn(event);
    return event;
  }
  const drag = (end = { clientY: 250 }, start = {}) => { emit('pointerdown', start); emit('pointermove', { ...start, ...end }); return emit('pointerup', { ...start, ...end }); };
  const host = document.documentElement.children[0];
  const receive = overrides => controller.receive({ id: crypto.randomUUID(), kind: 'danger', target: { kind: 'page' }, sentAt: Date.now(), at: Date.now(), ...overrides }, { name: 'Friend' });
  return { controller, configure, emit, drag, calls, plays, timers, audio, ctx, hit, document, window, motion, host, receive, handlers, observers };
}

test('modified clicks and sub-threshold moves stay native; release in centre cancels', () => {
  const f = fixture();
  try {
    assert.equal(f.emit('selectstart').prevented, undefined);
    assert.equal(f.emit('pointerdown').prevented, undefined);
    assert.equal(f.emit('selectstart').prevented, true);
    assert.equal(f.emit('dragstart').prevented, true);
    assert.equal(f.emit('pointermove', { clientX: 507 }).prevented, undefined);
    assert.equal(f.emit('pointerup', { clientX: 507 }).prevented, undefined);
    assert.equal(f.calls.length, 0);
    f.emit('pointerdown'); assert.equal(f.emit('pointermove', { clientX: 508 }).prevented, true);
    f.emit('pointerup'); assert.equal(f.calls.length, 0);
  } finally { f.controller.dispose(); }
});
test('all eight directions follow the configured wheel; near an edge the pick is the slice drawn under the pointer', () => {
  const f = fixture();
  try {
    const directions = [[0, -150], [150, -150], [150, 0], [150, 150], [0, 150], [-150, 150], [-150, 0], [-150, -150]];
    directions.forEach(([x, y]) => f.drag({ clientX: 500 + x, clientY: 400 + y }));
    assert.deepEqual(f.calls.map(call => call.emote ?? call.kind), ['danger', 'watch', 'together', 'agree', 'gm', 'attention', 'question', 'paper-hands']);
    assert.equal(f.calls[4].kind, 'attention');
    f.configure({ wheel: ['help', 'disagree', 'together', 'diamond-hands'] }); f.calls.length = 0;
    directions.slice(0, 4).forEach(([x, y]) => f.drag({ clientX: 500 + x, clientY: 400 + y }));
    assert.deepEqual(f.calls.map(call => call.emote ?? call.kind), ['help', 'disagree', 'together', 'diamond-hands']);
    f.configure();
    f.emit('pointerdown', { clientX: 1, clientY: 1 }); f.emit('pointermove', { clientX: 11, clientY: 1 });
    const wheel = f.host.shadow.children.find(node => node.id === 'wheel');
    assert.equal(wheel.style.left, '68px'); assert.equal(wheel.style.top, '68px'); // only the core is kept on screen
    assert.equal(wheel.attrs.viewBox, '-300 -300 600 600');
    assert.equal(wheel.querySelector('.centerTxt').textContent, 'emote'); // paper-hands: the pointer sits up-left of the drawn centre
    f.emit('pointermove', { clientX: 400, clientY: 196 }); assert.equal(wheel.querySelector('.centerTxt').textContent, 'together');
    assert.equal(wheel.querySelector('.backTxt').textContent, 'cancel');
    f.emit('pointerup', { clientX: 400, clientY: 196 }); assert.equal(f.calls.at(-1).kind, 'together');
    assert.equal(f.emit('click').prevented, true); assert.equal(f.emit('click').prevented, undefined);
  } finally { f.controller.dispose(); }
});
test('root CSS zoom is inverted without changing browser CSS pixel geometry', () => {
  const f = fixture();
  try {
    f.document.documentElement.style.zoom = '1.5'; f.ctx.innerWidth = 360; f.ctx.innerHeight = 740;
    f.ctx.devicePixelRatio = 3;
    f.emit('pointerdown', { clientX: 5, clientY: 5 }); f.emit('pointermove', { clientX: 355, clientY: 180 });
    assert.equal(Number(f.host.style.zoom), 1 / 1.5);
    const wheel = f.host.shadow.children.find(node => node.id === 'wheel');
    const core = parseFloat(wheel.style.width) * WHEEL.innerR / WHEEL.size;
    assert.ok(parseFloat(wheel.style.left) - core >= 7.99);
    assert.ok(parseFloat(wheel.style.left) + core <= 352.01);
    f.emit('pointerup', { clientX: 355, clientY: 180 }); assert.equal(f.calls[0].kind, 'together');
    f.document.documentElement.style.zoom = '1'; f.emit('resize', {}, f.window);
    assert.equal(f.host.style.zoom, '1');
  } finally { f.controller.dispose(); }
});
test('the shortcut is the exact modifier set; configuration and private fields gate input', () => {
  const f = fixture();
  try {
    f.emit('pointerdown'); f.emit('pointermove', { clientX: 503, shiftKey: true }); f.emit('pointermove', { clientY: 250 }); f.emit('pointerup', { clientY: 250 });
    assert.equal(f.calls.length, 0); // modifiers changed before the wheel opened
    f.drag({ clientY: 250 }, { shiftKey: true }); assert.equal(f.calls.length, 0); // Alt + Shift is not Alt
    f.configure({ key: ['Alt', 'Shift'] });
    f.drag({ clientY: 250 }, { shiftKey: true }); assert.equal(f.calls.at(-1).kind, 'danger');
    f.drag(); assert.equal(f.calls.length, 1);
    f.configure({ key: ['Shift'] });
    f.drag({ clientY: 250 }, { altKey: false, shiftKey: true }); assert.equal(f.calls.length, 2);
    f.drag({ clientY: 250 }, { altKey: false, shiftKey: true, metaKey: true }); assert.equal(f.calls.length, 2);
    f.configure();
    f.hit.blocked = true; const count = f.calls.length; f.drag(); assert.equal(f.calls.length, count);
    f.hit.blocked = false; f.hit.readable = false; f.drag(); assert.equal(f.calls.length, count + 1); // an invisible overlay still starts, as a page signal
    f.hit.readable = true; f.controller.suspend(true); f.drag(); assert.equal(f.calls.length, count + 1);
  } finally { f.controller.dispose(); }
});
test('recognized Control gesture reserves native context menu before threshold; unrecognized Control stays native', () => {
  const f = fixture();
  try {
    const ctrl = { altKey: false, ctrlKey: true, button: 2, buttons: 2 };
    f.emit('pointerdown', ctrl); assert.equal(f.emit('contextmenu', ctrl).prevented, undefined); f.emit('pointerup', ctrl);
    f.configure({ key: ['Control'], wheel: ['diamond-hands'] });
    f.emit('pointerdown', ctrl); assert.equal(f.emit('contextmenu', ctrl).prevented, true); f.emit('pointerup', ctrl);
    assert.equal(f.calls.length, 0);
    f.emit('pointerdown', ctrl); f.emit('pointermove', { ...ctrl, clientY: 250 });
    assert.equal(f.emit('contextmenu', ctrl).prevented, true);
    f.emit('pointerup', { ...ctrl, clientY: 250 }); assert.equal(f.calls.at(-1).emote, 'diamond-hands');
  } finally { f.controller.dispose(); }
});
test('a press on a chart canvas starts a signal; what it points at is read once, at release', () => {
  const f = fixture();
  try {
    let captures = 0; f.ctx.captureSignalTarget = (x, y) => { captures++; return { kind: 'spot', anchors: [{ kind: 'chart', x: x / 1000, y: y / 800 }] }; };
    Object.assign(f.hit, { readable: false, tagName: 'CANVAS' });
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); assert.equal(captures, 0);
    f.emit('pointerup', { clientY: 250 });
    assert.equal(captures, 1); assert.deepEqual(f.calls.at(-1).target, { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] });
  } finally { f.controller.dispose(); }
});
test('an open wheel keeps its pick when the modifier is let go early, the page scrolls or focus is still in the side panel', () => {
  const f = fixture();
  try {
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); f.emit('keyup', { altKey: false });
    f.emit('pointermove', { clientY: 240, altKey: false }); f.emit('pointerup', { clientY: 240, altKey: false });
    assert.equal(f.calls.at(-1).kind, 'danger');
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); f.emit('scroll', {}, f.window); f.emit('pointerup', { clientY: 250 });
    assert.equal(f.calls.length, 2);
    f.document.focused = false; f.emit('pointerdown'); f.document.focused = true;
    f.emit('pointermove', { clientY: 250 }); f.emit('pointerup', { clientY: 250 });
    assert.equal(f.calls.length, 3);
    f.emit('pointerdown'); f.emit('keyup', { altKey: false }); f.emit('pointermove', { clientY: 250, altKey: false }); f.emit('pointerup', { clientY: 250, altKey: false });
    assert.equal(f.calls.length, 3); // let go before the wheel opened: a plain drag
  } finally { f.controller.dispose(); }
});
test('a page whose focus is in the side panel still shows received signals, and blur keeps shown ones', () => {
  const f = fixture();
  try {
    f.document.focused = false; f.receive(); assert.equal(f.plays.length, 1);
    f.emit('blur', {}, f.window); assert.equal(f.host.shadow.children.find(el => el.id === 'pings').children.length, 1);
  } finally { f.controller.dispose(); }
});
test('holding still opens the wheel; a second button or Escape cancels and swallows the rest of the press', () => {
  const f = fixture();
  try {
    const wheel = f.host.shadow.children.find(node => node.id === 'wheel');
    f.emit('pointerdown'); assert.doesNotMatch(wheel.className, /open/);
    [...f.timers.values()].find(timer => timer.delay === 180).fn();
    assert.match(wheel.className, /open/); assert.equal(wheel.querySelector('.centerTxt').textContent, '');
    assert.equal(f.emit('pointerup').prevented, true); assert.equal(f.calls.length, 0); // released in the centre
    assert.equal(f.emit('click').prevented, true);
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 340 }); assert.equal(wheel.querySelector('.centerTxt').textContent, 'danger'); // 60px is already a pick
    f.emit('pointerup', { clientY: 340 }); assert.equal(f.calls.at(-1).kind, 'danger');
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); f.emit('pointermove', { clientY: 250, buttons: 3 });
    assert.equal(f.emit('contextmenu').prevented, true);
    assert.equal(f.emit('pointerup', { clientY: 250 }).prevented, true); assert.equal(f.emit('click').prevented, true);
    f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); f.emit('keydown', { key: 'Escape' });
    assert.equal(f.emit('pointerup', { clientY: 250 }).prevented, true); assert.equal(f.emit('click').prevented, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.emit('pointerdown').prevented, undefined); f.emit('pointerup'); assert.equal(f.emit('click').prevented, undefined); // a plain modified click stays native
  } finally { f.controller.dispose(); }
});
test('a hold near an edge picks nothing until the pointer moves; a release the page missed still sends the last pick', () => {
  const f = fixture();
  try {
    const wheel = f.host.shadow.children.find(node => node.id === 'wheel');
    const aim = wheel.children.find(node => node.className.includes('aim'));
    f.emit('pointerdown', { clientX: 20, clientY: 400 }); [...f.timers.values()].find(timer => timer.delay === 180).fn();
    assert.equal(wheel.style.left, '68px'); assert.equal(aim.attrs.opacity, '0');
    f.emit('pointerup', { clientX: 22, clientY: 400 }); assert.equal(f.calls.length, 0); // off-centre but unmoved: cancel
    f.emit('pointerdown'); f.emit('pointermove', { clientX: 700, clientY: 400 });
    assert.equal(aim.attrs.opacity, '1'); assert.equal(aim.attrs.transform, 'rotate(90)');
    f.emit('pointermove', { clientX: 900, clientY: 400, buttons: 0 }); // released over the side panel
    assert.equal(f.calls.at(-1).kind, 'together'); assert.equal(aim.attrs.opacity, '0');
  } finally { f.controller.dispose(); }
});
test('escape, resize, blur and navigation cancel active drags', () => {
  const f = fixture();
  try {
    for (const [type, event, target] of [['keydown', { key: 'Escape' }], ['resize', {}, f.window], ['blur', {}, f.window], ['navigate', {}, f.window.navigation]]) {
      f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 }); f.emit(type, event, target); f.emit('pointerup', { clientY: 250 });
    }
    assert.equal(f.calls.length, 0);
  } finally { f.controller.dispose(); }
});
test('local playback precedes acknowledgement; failed result is localized and dispose cleans resources', async () => {
  const f = fixture();
  f.drag(); assert.equal(f.plays.length, 1); assert.equal(f.audio.length, 0);
  f.controller.result(f.calls[0].requestId, false, 'No recipients');
  const notice = f.host.shadow.children.find(node => node.className === 'notice'); assert.equal(notice.textContent, '!'); assert.equal(notice.title, 'No recipients'); assert.equal(notice.attrs['aria-label'], 'No recipients');
  f.configure({ sound: true }); f.drag(); await Promise.resolve();
  assert.deepEqual(f.audio.map(url => url.split('/').at(-1)), ['tick.m4a', 'danger.m4a']); // the hover tick never swallows the signal
  f.controller.dispose(); assert.equal(f.timers.size, 0); assert.equal(f.document.documentElement.children.length, 0);
  for (const events of f.handlers.values()) for (const callbacks of events.values()) assert.equal(callbacks.size, 0);
});
test('a found spot follows scroll, locates only on click, and drops to the edge when it detaches', async () => {
  const f = fixture();
  try {
    let scrolls = 0;
    const node = { isConnected: true, parentElement: { scrollIntoView() { scrolls++; } } };
    let rect = { left: 200, top: 900, right: 300, bottom: 920, width: 100, height: 20 };
    const spot = { box: { startContainer: node, endContainer: node, getBoundingClientRect: () => rect }, x: 0.5, y: 0.5, level: 0 };
    f.ctx.resolveSignalSpot = () => spot;
    f.receive({ target: { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] } });
    const root = f.host.shadow.children.find(el => el.id === 'pings').lastElementChild;
    assert.equal(scrolls, 0); const badge = root.lastElementChild; assert.equal(badge.textContent, '↗'); assert.equal(badge.title, 'locate');
    f.emit('click', {}, badge); assert.equal(scrolls, 1);
    rect = { ...rect, top: 200, bottom: 220 }; f.emit('scroll', {}, f.window);
    assert.equal(root.style.top, '210px'); assert.equal(badge.hidden, true);
    spot.alive = false; f.ctx.resolveSignalSpot = () => undefined; f.emit('resize', {}, f.window);
    assert.equal(badge.textContent, ''); assert.equal(badge.hidden, true); assert.ok(root.className.includes('page-signal'));
  } finally { f.controller.dispose(); }
});
test('local quote and emote playback stays at the press point without resolving or jumping', async () => {
  const f = fixture();
  try {
    let resolutions = 0;
    f.ctx.captureSignalTarget = () => ({ kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] });
    f.ctx.resolveSignalSpot = () => { resolutions++; };
    f.drag({ clientX: 320, clientY: 40 }, { clientX: 320, clientY: 180 });
    const root = f.host.shadow.children.find(el => el.id === 'pings').lastElementChild;
    assert.equal(root.style.left, '320px'); assert.equal(root.style.top, '180px');
    f.drag({ clientX: 320, clientY: 40 }, { clientX: 320, clientY: 180, shiftKey: true });
    assert.equal(f.plays.at(-1).x, 320); assert.equal(f.plays.at(-1).y, 180);
    await Promise.resolve(); f.emit('scroll', { target: {} }, f.window);
    assert.equal(f.host.shadow.children.find(el => el.id === 'pings').children.length, 1); // a list scrolling inside the page keeps it
    f.emit('scroll', { target: f.document }, f.window);
    assert.equal(resolutions, 0); assert.equal(root.style.top, '180px');
    assert.equal(f.host.shadow.children.find(el => el.id === 'pings').children.length, 0);
  } finally { f.controller.dispose(); }
});
test('a spot point is relative to its box, so it follows layout; a detached box becomes a compact edge icon', () => {
  const f = fixture();
  try {
    let rect = { left: 100, top: 100, width: 400, height: 200 };
    const spot = { box: { tagName: 'IMG', getBoundingClientRect: () => rect }, x: 0.25, y: 0.75, level: 1 };
    f.ctx.resolveSignalSpot = () => spot;
    f.receive({ target: { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] } });
    const root = f.host.shadow.children.find(el => el.id === 'pings').lastElementChild;
    assert.equal(root.style.left, '200px'); assert.equal(root.style.top, '250px');
    rect = { left: 200, top: 300, width: 200, height: 100 }; f.emit('scroll', {}, f.window);
    assert.equal(root.style.left, '250px'); assert.equal(root.style.top, '375px');
    spot.alive = false; f.ctx.resolveSignalSpot = () => undefined; f.emit('resize', {}, f.window);
    assert.ok(root.className.includes('page-signal')); assert.equal(root.style.left, '968px');
    assert.equal(root.lastElementChild.textContent, '');
  } finally { f.controller.dispose(); }
});
test('a spot not found yet is looked for again every 500ms while it shows, and a found one is never searched again', () => {
  const f = fixture();
  try {
    let resolutions = 0, found;
    f.ctx.resolveSignalSpot = () => { resolutions++; return found; };
    f.receive({ target: { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] } });
    const root = f.host.shadow.children.find(el => el.id === 'pings').lastElementChild;
    assert.equal(resolutions, 1); assert.ok(root.className.includes('page-signal'));
    found = { box: { tagName: 'DIV', getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }, x: 0.5, y: 0.5, level: 0 };
    const retry = () => { const [id, timer] = [...f.timers].find(([, timer]) => timer.delay === 500); f.timers.delete(id); timer.fn(); };
    retry(); assert.equal(resolutions, 2); assert.equal(root.style.left, '50px');
    retry(); assert.equal(resolutions, 2);
    f.controller.clear(); assert.equal([...f.timers.values()].some(timer => timer.delay === 500), false);
  } finally { f.controller.dispose(); }
});
test('emote stills play in the CSS envelope with a placeholder fallback and load-based lifetime with cleanup', () => {
  const f = fixture();
  try {
    f.ctx.TAG_COLORS = ['white'];
    vm.runInContext(script('../packages/shared/src/signal-art/emote-fx.ts'), f.ctx);
    const layer = f.document.createElement('div');
    const Stage = vm.runInContext('EmoteStage', f.ctx), stage = new Stage(layer);
    let ready = 0;
    const url = 'chrome-extension://test/signals/emotes/gm.webp';
    stage.spawn('one', url, 10, 20, { sizePx: 110, onReady: () => ready++ });
    const fx = layer.lastElementChild.children[0], first = fx.children[0];
    assert.equal(fx.className, 'fx'); assert.equal(first.src, url);
    assert.ok([...f.timers.values()].some(timer => timer.delay === 10_000));
    first.onload(); assert.equal(ready, 1); assert.equal(first.onload, null);
    assert.ok([...f.timers.values()].some(timer => timer.delay === 3150));
    stage.spawn('two', 'chrome-extension://test/signals/emotes/missing.webp', 30, 40, { sizePx: 110, onReady: () => ready++ });
    const second = layer.lastElementChild.children[0];
    second.children[0].onerror();
    assert.equal(second.children[0].className, 'bubble'); assert.equal(ready, 2);
    stage.spawn('two', url, 30, 40, { sizePx: 110 });
    assert.equal(layer.children.length, 2);
    stage.dispose(); assert.equal(layer.children.length, 0); assert.equal(first.attrs.src, undefined);
    assert.equal(f.timers.size, 0);
  } finally { f.controller.dispose(); }
});
test('receive checks visibility, focus, TTL and duplicates; caps effects and renders reduced-motion stills', () => {
  const f = fixture();
  try {
    f.receive({ at: Date.now() - 5001 }); // lifetime counts from arrival on this device
    f.document.visibilityState = 'hidden'; f.receive(); f.document.visibilityState = 'visible'; assert.equal(f.plays.length, 0);
    const id = crypto.randomUUID(); f.receive({ id }); f.receive({ id }); assert.equal(f.plays.length, 1);
    const staleRemoval = [...f.timers.values()].find(timer => timer.delay === 3000).fn;
    for (let i = 0; i < 8; i++) f.receive();
    staleRemoval(); // A queued expiration after eviction must not remove another effect.
    assert.equal(f.host.shadow.children.find(node => node.id === 'pings').children.length, 3);
    const styles = f.host.shadow.children[0].textContent;
    assert.match(styles, /\.ping \.art img \{ opacity: 1 !important/);
    f.motion.matches = true; f.receive({ emote: 'diamond-hands', target: { kind: 'spot', anchors: [{ kind: 'chart', x: 0.5, y: 0.5 }] } });
    const root = f.host.shadow.children.find(node => node.id === 'emotes').lastElementChild;
    assert.ok(root.children[0].src.endsWith('/emotes/diamond-hands.webp')); assert.equal(root.children[0].className, 'static-art');
    // The two signals still on the right edge keep their places; the emote stacks below them instead of over them.
    assert.equal(root.style.left, '921px'); assert.equal(root.style.top, `${90 + 2 * 76}px`);
    assert.equal(root.className.includes('page-signal'), false);
  } finally { f.controller.dispose(); }
});
test('signals with no place on the page stack down the right edge and close up when one leaves', () => {
  const f = fixture();
  try {
    f.receive(); f.receive(); f.receive();
    const pings = f.host.shadow.children.find(node => node.id === 'pings').children;
    assert.deepEqual(pings.map(root => root.style.top), ['48px', '124px', '200px']);
    [...f.timers.values()].find(timer => timer.delay === 3000).fn();
    assert.deepEqual(pings.map(root => root.style.top), ['48px', '124px']);
  } finally { f.controller.dispose(); }
});
test('synthetic cancellation cannot interrupt a trusted signal gesture', () => {
  const f = fixture();
  try {
    for (const [type, values] of [['keydown', { key: 'Escape' }], ['keyup', { altKey: false }], ['pointercancel', {}]]) {
      f.emit('pointerdown'); f.emit('pointermove', { clientY: 250 });
      f.emit(type, { ...values, isTrusted: false });
      f.emit('pointerup', { clientY: 250 });
    }
    assert.equal(f.calls.length, 3);
  } finally { f.controller.dispose(); }
});
