/* global document -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPicker } from '../apps/extension/src/page-layer/picker.ts';
import { createStickyHighlight, mergePins, pinPoint } from '../apps/extension/src/page-layer/pins.ts';
import { createMediaClock, pruneDanmaku, removeDanmaku } from '../apps/extension/src/page-layer/danmaku-helpers.ts';

function rangeFactory() {
  return { setStart(node, offset) { this.start = { node, offset }; }, setEnd(node, offset) { this.end = { node, offset }; } };
}

test('highlights adopt only their own page rule and dispose without removing site styles', () => {
  const previous = globalThis.CSSStyleSheet;
  globalThis.CSSStyleSheet = class { replaceSync(rule) { this.rule = rule; } };
  const ownSheet = {};
  const doc = { adoptedStyleSheets: [ownSheet] };
  const registry = new Map();
  class HighlightStub { constructor(...ranges) { this.ranges = ranges; } }
  try {
    const highlighter = createStickyHighlight(doc, registry, HighlightStub);
    assert.equal(doc.adoptedStyleSheets[0], ownSheet);
    assert.match(doc.adoptedStyleSheets[1].rule, /^::highlight\(palside-sticky-[\da-f-]+\)\{background-color:#FFE27A66;color:inherit\}$/);
    const range = rangeFactory();
    highlighter.update([range]);
    assert.deepEqual([...registry.values()][0].ranges, [range]);
    highlighter.update([]);
    assert.equal(registry.size, 0);
    highlighter.update([range]);
    highlighter.dispose();
    assert.equal(registry.size, 0);
    assert.deepEqual(doc.adoptedStyleSheets, [ownSheet]);
  } finally { globalThis.CSSStyleSheet = previous; }
});

test('pruning drops only expired consumed comments and preserves the playback cursor', () => {
  const running = { time: 9 };
  const engine = { comments: [{ time: 1 }, { time: 4 }, running, { time: 12 }], _: { position: 3 } };
  pruneDanmaku(engine, 8);
  assert.deepEqual(engine.comments, [running, { time: 12 }]);
  assert.equal(engine._.position, 1);
  pruneDanmaku(engine, 99);
  assert.deepEqual(engine.comments, [{ time: 12 }]);
  assert.equal(engine._.position, 0);
});

test('media clock cancels its outstanding frame on pause and can restart', () => {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = frame => frames.delete(frame);
  try {
    const clock = createMediaClock();
    clock.play();
    assert.equal(frames.size, 1);
    clock.pause();
    assert.equal(frames.size, 0);
    clock.play();
    assert.equal(frames.size, 1);
    clock.pause();
  } finally { globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
});

test('pin geometry uses target corners and merges only nearby targets', () => {
  assert.deepEqual(pinPoint({ left: 10, top: 20, width: 100, height: 20 }), { x: 104, y: 26 });
  assert.deepEqual(mergePins([{ item: 'a', x: 10, y: 10 }, { item: 'b', x: 20, y: 20 }, { item: 'c', x: 100, y: 100 }]).map(group => group.items), [['a', 'b'], ['c']]);
});

function pickerFixture() {
  const original = new Map();
  const set = (key, value) => { original.set(key, globalThis[key]); globalThis[key] = value; };
  const sent = [];
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      fire(type, fields = {}) {
        const event = { type, button: 0, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...fields };
        for (const listener of listeners.get(type) ?? []) listener(event);
        return event;
      },
      get count() { return [...listeners.values()].reduce((n, group) => n + group.size, 0); },
    };
  };
  const root = eventTarget(), doc = eventTarget();
  const p = { nodeType: 1, tagName: 'P', closest: () => null, getAttribute: () => null, querySelector: () => null, matches: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, width: 100, height: 20 }) };
  const text = { nodeType: 3, parentElement: p, data: 'hello world', length: 11 };
  let selected;
  const selection = {
    get isCollapsed() { return !selected || selected.startOffset === selected.endOffset; },
    get rangeCount() { return selected ? 1 : 0; },
    getRangeAt() { return selected; },
    removeAllRanges() { selected = undefined; },
  };
  const select = (value = 'hello world') => {
    text.data = value; text.length = value.length;
    selected = { startContainer: text, startOffset: 0, endContainer: text, endOffset: text.length, commonAncestorContainer: p, cloneRange() { return { ...this }; }, intersectsNode: () => true, getClientRects: () => [], getBoundingClientRect: p.getBoundingClientRect };
  };
  const host = { contains: item => item === host };
  const overlay = {
    host,
    setPicking(on) { this.picking = on; }, isControl: event => Boolean(event.own),
    hideSelection() { this.actions = undefined; }, setSelectionPending(pending, error) { this.pending = pending; this.error = error; },
    showSelection(at, actions) { this.actions = actions; this.menuCount = (this.menuCount ?? 0) + 1; },
    repositionSelection(at) { this.position = at; }, showSavedMark(id) { this.saved = id; },
  };
  set('MutationObserver', class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} });
  set('window', root); set('location', { hostname: 'example.com' }); set('getSelection', () => selection);
  set('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  set('Node', { TEXT_NODE: 3 }); set('NodeFilter', { SHOW_TEXT: 4, SHOW_ELEMENT: 1 });
  set('document', {
    ...doc, querySelectorAll: () => [], elementsFromPoint: () => [host, p],
    caretPositionFromPoint: () => { throw new Error('native selection must not be replaced by caret synthesis'); },
    createTreeWalker() { let done = false; return { nextNode: () => { if (done) return null; done = true; return text; } }; },
  });
  const picker = createPicker(overlay, message => sent.push(message));
  return { root, doc, overlay, picker, sent, select, selection, restore() { picker.dispose(); for (const [key, value] of original) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 120));
const activate = (env, id = 'context-a') => { env.picker.enable(true); env.picker.set(true, true, id); };

test('native selection starts only with a host context and does not intercept website gestures', async () => {
  const env = pickerFixture();
  try {
    env.select(); env.picker.enable(true);
    assert.equal(env.overlay.actions, undefined, 'configuration alone cannot author a selection');
    env.picker.set(true, true, 'context-a');
    assert.equal(env.overlay.picking, true);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'wheel']) {
      const event = env.root.fire(type); assert.equal(event.prevented, undefined); assert.equal(event.stopped, undefined);
    }
    env.doc.fire('pointerdown'); env.select(); env.doc.fire('selectionchange');
    await settle(); assert.equal(env.overlay.actions, undefined, 'dragging does not steal focus');
    env.doc.fire('mouseup'); await settle();
    assert.equal(typeof env.overlay.actions.quote, 'function'); assert.equal(typeof env.overlay.actions.sticky, 'function'); assert.equal(env.overlay.actions.mark, undefined);
    env.overlay.actions.quote(); assert.equal(env.sent[0].type, 'picked'); assert.equal(env.sent[0].target.exact, 'hello world'); assert.equal(env.sent[0].contextId, 'context-a');
    env.picker.result({ requestId: env.sent[0].requestId, ok: true });
    assert.equal(env.overlay.picking, false); assert.equal(env.selection.rangeCount, 0);
    env.select('another selection'); env.doc.fire('mouseup'); await settle();
    assert.equal(typeof env.overlay.actions.quote, 'function', 'successful quote leaves daily observer enabled');
  } finally { env.restore(); }
});

test('empty-body mark persists once acknowledged and selection stays available', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env);
    env.overlay.actions.sticky(); const first = env.sent.at(-1);
    assert.equal(first.action, 'sticky'); assert.equal(first.text, ''); assert.equal(first.contextId, 'context-a');
    env.picker.result({ requestId: first.requestId, ok: true, stickyId: 'saved-id', revision: '$revision' });
    assert.equal(env.overlay.saved, 'saved-id'); assert.equal(env.overlay.picking, false);
    env.select('next mark'); env.doc.fire('mouseup'); await settle();
    assert.equal(typeof env.overlay.actions.sticky, 'function');
  } finally { env.restore(); }
});

test('the same selection repositions its menu without recreating it', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); const actions = env.overlay.actions;
    env.doc.fire('selectionchange'); await settle(); env.doc.fire('scroll'); await settle();
    assert.equal(env.overlay.actions, actions); assert.equal(env.overlay.menuCount, 1);
    assert.deepEqual(env.overlay.position, { x: 0, y: 20 });
  } finally { env.restore(); }
});

test('focusing an action retains its captured range but refuses changed text before submit', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); const actions = env.overlay.actions;
    document.activeElement = env.overlay.host;
    env.selection.removeAllRanges(); env.doc.fire('selectionchange'); await settle();
    assert.equal(env.overlay.actions, actions);
    actions.quote(); assert.equal(env.sent.at(-1).target.exact, 'hello world');
    env.picker.result({ requestId: env.sent.at(-1).requestId, ok: false });
    env.select('price changed'); actions.quote();
    assert.equal(env.sent.at(-1).type, 'pick-error'); assert.equal(env.overlay.actions, undefined);
  } finally { env.restore(); }
});

test('unchanged retries reuse an operation while changed context discards old acknowledgments', () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); env.overlay.actions.sticky(); const first = env.sent.at(-1);
    env.picker.result({ requestId: first.requestId, ok: false, error: 'Try again' });
    assert.equal(env.overlay.pending, false); assert.equal(env.overlay.error, 'Try again');
    env.overlay.actions.sticky(); const retry = env.sent.at(-1); assert.equal(retry.requestId, first.requestId);
    env.picker.set(true, true, 'context-b');
    assert.equal(env.selection.rangeCount, 0); assert.equal(env.overlay.actions, undefined);
    env.picker.result({ requestId: first.requestId, ok: true, stickyId: 'old' }); assert.equal(env.overlay.saved, undefined);
    env.select(); env.picker.set(true, true, 'context-b'); env.overlay.actions.sticky();
    assert.notEqual(env.sent.at(-1).requestId, first.requestId); assert.equal(env.sent.at(-1).contextId, 'context-b');
  } finally { env.restore(); }
});

test('danmaku input can suspend menus without destroying the observer or host context', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); env.picker.setSelectionEnabled(false);
    assert.equal(env.overlay.actions, undefined); assert.equal(env.overlay.picking, false);
    env.doc.fire('selectionchange'); await settle(); assert.equal(env.overlay.actions, undefined);
    env.picker.setSelectionEnabled(true); assert.equal(typeof env.overlay.actions.quote, 'function');
    env.overlay.actions.quote(); assert.equal(env.sent.at(-1).contextId, 'context-a');
  } finally { env.restore(); }
});

test('turning the sticky switch off revokes its context until explicitly enabled again', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); env.picker.set(false);
    env.select('selection while disabled'); env.doc.fire('mouseup'); await settle();
    assert.equal(env.overlay.actions, undefined);
    env.picker.setSelectionEnabled(false); env.picker.setSelectionEnabled(true);
    env.doc.fire('selectionchange'); await settle();
    assert.equal(env.overlay.actions, undefined, 'leaving danmaku cannot restore the revoked sticky context');
    env.picker.set(true, true, 'context-new');
    assert.equal(typeof env.overlay.actions.sticky, 'function');
    env.overlay.actions.sticky(); assert.equal(env.sent.at(-1).contextId, 'context-new');
  } finally { env.restore(); }
});

test('scroll revalidates old ranges and refuses mutated or detached content', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env); env.select('different'); env.doc.fire('scroll'); await settle();
    assert.equal(env.overlay.actions, undefined); assert.equal(env.sent.at(-1).reason, 'unavailable');
    env.select(); env.doc.fire('mouseup'); await settle();
    env.selection.getRangeAt().startContainer.isConnected = false;
    env.doc.fire('scroll'); await settle(); assert.equal(env.overlay.actions, undefined);
  } finally { env.restore(); }
});

test('overlong selections report once and Escape clears only the current selection', async () => {
  const env = pickerFixture();
  try {
    env.select('x'.repeat(201)); activate(env);
    assert.deepEqual(env.sent, [{ type: 'pick-error', contextId: 'context-a', reason: 'too-long' }]); assert.equal(env.overlay.actions, undefined);
    env.doc.fire('selectionchange'); await settle(); assert.equal(env.sent.length, 1);
    env.select('valid text'); env.doc.fire('keyup'); await settle(); assert.equal(typeof env.overlay.actions.quote, 'function');
    const event = env.doc.fire('keydown', { key: 'Escape' }); assert.equal(event.prevented, true); assert.equal(env.overlay.picking, false);
    assert.equal(env.sent.length, 1, 'Escape only clears the selection');
    env.select('after escape'); env.doc.fire('mouseup'); await settle(); assert.equal(typeof env.overlay.actions.sticky, 'function');
    env.picker.dispose(); assert.equal(env.root.count, 0); assert.equal(env.doc.count, 0);
  } finally { env.restore(); }
});

test('retraction removes a rendered flight and its retained comment without moving unrelated playback', () => {
  let removed = 0;
  const render = () => {}, other = { render: () => {} };
  const flight = { render, node: { remove() { removed++; } } };
  const engine = { comments: [flight, other], _: { position: 1, runningList: [flight] } };
  removeDanmaku(engine, item => item.render === render);
  assert.equal(removed, 1); assert.deepEqual(engine._.runningList, []);
  assert.deepEqual(engine.comments, [other]); assert.equal(engine._.position, 0);
});

test('synthetic selection events cannot start, finish or cancel native picking', async () => {
  const env = pickerFixture();
  try {
    env.select(); activate(env);
    const actions = env.overlay.actions;
    env.doc.fire('pointerdown', { isTrusted: false });
    env.doc.fire('keydown', { isTrusted: false, key: 'Escape' });
    assert.equal(env.overlay.actions, actions);
    env.doc.fire('pointerdown', { isTrusted: true });
    env.select();
    for (const type of ['mouseup', 'pointerup', 'keyup', 'selectionchange']) env.doc.fire(type, { isTrusted: false });
    await settle(); assert.equal(env.overlay.actions, undefined);
    env.doc.fire('pointerup', { isTrusted: true });
    await settle(); assert.equal(typeof env.overlay.actions.quote, 'function');
  } finally { env.restore(); }
});
