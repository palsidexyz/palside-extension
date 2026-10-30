import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const h = React.createElement;
const sourceRoot = new URL('../apps/extension/src/', import.meta.url);
const compiled = new Map();
function compile(file) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(file, sourceRoot), 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  return compiled.get(file);
}

// Real React effects and DOM events run against a local DOM and controlled host clock.
async function fixture(t, { stage = false, initial = [], strict = false } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root" data-palside-app></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  const rect = { left: 0, top: 200, width: 400, height: 40, right: 400, bottom: 240 };
  document.visibilityState = 'visible';
  const prototype = window.HTMLElement.prototype;
  const domProperties = Object.fromEntries(['matches', 'showPopover', 'getBoundingClientRect', 'offsetWidth', 'offsetHeight'].map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.matches = function (selector) { return selector === ':popover-open' ? Boolean(this.popoverOpen) : matches.call(this, selector); };
  window.HTMLElement.prototype.showPopover = function () { this.popoverOpen = true; };
  window.HTMLElement.prototype.getBoundingClientRect = () => rect;
  Object.defineProperties(prototype, { offsetWidth: { configurable: true, get: () => 200 }, offsetHeight: { configurable: true, get: () => 40 } });
  const listeners = new Map();
  for (const [owner, target] of [['document', document], ['window', window]]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, callback, ...args) => {
      const key = `${owner}:${type}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(callback); add(type, callback, ...args);
    };
    target.removeEventListener = (type, callback, ...args) => { listeners.get(`${owner}:${type}`)?.delete(callback); remove(type, callback, ...args); };
  }
  let now = 10_000, timerId = 0;
  const timers = new Map(), caches = [];
  const setTimer = (fn, delay, repeat = false) => { const id = ++timerId; timers.set(id, { fn, at: now + delay, repeat: repeat ? delay : 0 }); return id; };
  const clearTimer = id => timers.delete(id);
  const clock = { setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: clearTimer, setInterval: (fn, delay) => setTimer(fn, delay, true), clearInterval: clearTimer };
  const motionProps = new Set(['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'onAnimationComplete']);
  const motion = Object.fromEntries(['span', 'div'].map(tag => [tag, function Motion(props) {
    return h(tag, Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key))));
  }]));
  const translate = (key, values) => values ? `${values.name}: ${values.emoji} ×${values.count}` : key;
  const passthrough = ({ children }) => children;
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'motion/react': { motion, AnimatePresence: passthrough, useReducedMotion: () => false },
    'use-intl': { useTranslations: () => translate },
    'lucide-react': { SmilePlus: () => null, X: () => null },
    '@palside/i18n': { errorMessage: error => error.message },
    '@palside/design/motion': { motionPresets: { reduced: {} } },
    '@palside/ui/visually-hidden': { VisuallyHidden: passthrough },
    '@palside/ui/button': { IconButton: props => h('button', { ...Object.fromEntries(Object.entries(props).filter(([key]) => !['label', 'size', 'variant'].includes(key))), 'aria-label': props.label }) },
    '../ui/motion-details': { StateGlyph: passthrough },
  };
  const context = vm.createContext({
    console, document, window: { ...clock, addEventListener: window.addEventListener, removeEventListener: window.removeEventListener },
    Date: class extends Date { static now() { return now; } }, ...clock,
    Map: class extends Map { constructor(...args) { super(...args); caches.push(this); } },
  });
  const load = file => {
    const exports = {};
    const imported = name => {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
      if (name === './emoji-rain') return load('features/palside/annotations/emoji-rain.tsx');
      if (name === '../../../domain/annotations/reactions') return load('domain/annotations/reactions.ts');
      return require(name);
    };
    vm.runInContext(`(function(exports, require) { ${compile(file)}\n})`, context, { filename: file })(exports, imported);
    return exports;
  };
  const { ReactionPicker, ReactionStage } = load('features/palside/annotations/reaction-picker.tsx');
  const sent = [];
  let c = { data: { self: 'self' }, current: 'team', screen: 'chat', disconnected: false, people: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }], live: { state: { reactions: initial }, command: async (...args) => { sent.push(args); } }, setNotice: assert.fail };
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  const render = async (patch = {}) => {
    c = { ...c, ...patch };
    const content = stage ? h(ReactionStage, { c }, h(ReactionPicker, { c })) : h(ReactionPicker, { c });
    await act(() => root.render(strict ? h(React.StrictMode, null, content) : content));
  };
  const unmount = async () => { if (mounted) { await act(() => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    for (const [key, descriptor] of Object.entries(domProperties)) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor); else delete prototype[key];
    }
    for (const name of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]); else delete globalThis[name];
    }
  });
  const dispatch = async (target, type, props = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, clientX: 10, clientY: 10, ...props });
    await act(() => target.dispatchEvent(event));
  };
  const advance = async ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end);
      if (!next) break;
      const [id, timer] = next; now = timer.at; timers.delete(id);
      if (timer.repeat) timers.set(id, { ...timer, at: now + timer.repeat });
      await act(() => timer.fn());
    }
    now = end;
  };
  const trigger = () => document.querySelector('button[aria-haspopup="menu"]');
  const item = () => document.querySelector('[data-reaction-emoji]');
  const release = async (target = item(), props) => { document.elementFromPoint = () => target; await dispatch(document, 'pointerup', props); };
  await render();
  return {
    document, window, sent, timers, caches, render, unmount, dispatch, advance, trigger, item, release,
    open: () => dispatch(trigger(), 'pointerdown'),
    listeners: key => listeners.get(key)?.size ?? 0,
    callbacks: key => [...(listeners.get(key) ?? [])],
    receive: reactions => render({ live: { ...c.live, state: { reactions } } }),
    reaction: (id, personId = 'alice', patch = {}) => ({ id, teamId: 'team', personId, emoji: '🔥', count: 1, at: now, ...patch }),
    announcement: () => document.querySelector('[role="status"]')?.textContent,
    drops: () => document.querySelectorAll('.drop').length,
  };
}

test('picker stays closed after disconnect/reconnect and team, screen or account round trips', async t => {
  const f = await fixture(t, { strict: true });
  for (const [away, back] of [
    [{ disconnected: true }, { disconnected: false }],
    [{ current: 'other' }, { current: 'team' }],
    [{ screen: 'settings' }, { screen: 'chat' }],
    [{ data: { self: 'other' } }, { data: { self: 'self' } }],
  ]) {
    await f.open();
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'true');
    await f.render(away); await f.render(back);
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'false');
    assert.equal(f.listeners('document:pointerup'), 0);
    await f.dispatch(f.trigger(), 'click', { detail: 0 });
    assert.equal(f.trigger().getAttribute('aria-expanded'), 'true');
    await f.dispatch(f.document, 'keydown', { key: 'Escape' });
  }
  await f.advance(2_000); assert.deepEqual(f.sent, []);
});

test('slide release belongs to one pointer and the current picker, then sends once', async t => {
  const f = await fixture(t);
  await f.open();
  await f.release(f.item(), { pointerId: 2 });
  assert.equal(f.listeners('document:pointerup'), 1);
  await f.release();
  assert.equal(f.listeners('document:pointerup'), 0);
  assert.equal(f.listeners('document:pointercancel'), 0);
  await f.release(); await f.advance(650);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0])), ['react', { teamId: 'team', emoji: '🔥', count: 1 }]);
  await f.dispatch(f.document, 'keydown', { key: 'Escape' });
  await f.open();
  const foreign = f.document.createElement('button'); foreign.dataset.reactionEmoji = '🔥'; f.document.body.append(foreign);
  await f.release(foreign); await f.advance(650);
  assert.equal(f.sent.length, 1);
});

test('cancel, blur, close, context change and unmount detach the gesture and reject late release', async t => {
  for (const end of ['cancel', 'blur', 'escape', 'outside', 'context', 'unmount']) {
    await t.test(end, async t => {
      const f = await fixture(t);
      await f.open();
      const picked = f.item(), late = f.callbacks('document:pointerup')[0];
      if (end === 'cancel') await f.dispatch(f.document, 'pointercancel');
      if (end === 'blur') await f.dispatch(f.window, 'blur');
      if (end === 'escape') await f.dispatch(f.document, 'keydown', { key: 'Escape' });
      if (end === 'outside') await f.dispatch(f.document.body, 'pointerdown');
      if (end === 'context') await f.render({ current: 'other' });
      if (end === 'unmount') await f.unmount();
      assert.equal(f.listeners('document:pointerup'), 0);
      assert.equal(f.listeners('document:pointercancel'), 0);
      f.document.elementFromPoint = () => picked;
      await act(() => late({ pointerId: 1, clientX: 10, clientY: 10 }));
      await f.release(picked); await f.advance(2_000);
      assert.deepEqual(f.sent, []);
      await f.unmount();
      assert.equal(f.listeners('window:blur'), 0);
      assert.equal(f.timers.size, 0);
    });
  }
});

test('trigger tap keeps the menu open and held presses stop on context change', async t => {
  const f = await fixture(t);
  await f.open(); await f.release(f.trigger()); await f.dispatch(f.trigger(), 'click', { detail: 1 });
  assert.equal(f.trigger().getAttribute('aria-expanded'), 'true');
  await f.dispatch(f.item(), 'pointerdown'); await f.advance(550);
  await f.render({ current: 'other' }); await f.advance(2_000);
  assert.deepEqual(JSON.parse(JSON.stringify(f.sent)), [['react', { teamId: 'team', emoji: '🔥', count: 2 }]]);
});

test('announcements coalesce a burst into its latest trailing reaction every 1.5 seconds', async t => {
  const f = await fixture(t, { stage: true });
  await f.receive([f.reaction('a')]); assert.equal(f.announcement(), 'Alice: 🔥 ×1');
  await f.advance(200); await f.receive([f.reaction('b', 'bob', { emoji: '🚀', count: 2 })]);
  await f.advance(200); await f.receive([f.reaction('c', 'bob', { emoji: '👀', count: 3 })]);
  assert.equal(f.announcement(), 'Alice: 🔥 ×1');
  await f.advance(1_099); assert.equal(f.announcement(), 'Alice: 🔥 ×1');
  await f.advance(1); assert.equal(f.announcement(), 'Bob: 👀 ×3');
  await f.receive([f.reaction('d', 'alice', { emoji: '👍', count: 4 })]);
  await f.advance(1_499); assert.equal(f.announcement(), 'Bob: 👀 ×3');
  await f.advance(1); assert.equal(f.announcement(), 'Alice: 👍 ×4');
});

test('pending announcements end on team/screen change, disconnect, document hiding or unmount', async t => {
  for (const end of ['team', 'screen', 'disconnect', 'hidden', 'unmount']) {
    await t.test(end, async t => {
      const f = await fixture(t, { stage: true });
      await f.receive([f.reaction('a')]); await f.advance(200);
      await f.receive([f.reaction('b', 'bob')]);
      if (end === 'team') await f.render({ current: 'other' });
      if (end === 'screen') await f.render({ screen: 'settings' });
      if (end === 'disconnect') await f.render({ disconnected: true });
      if (end === 'hidden') { f.document.visibilityState = 'hidden'; await f.dispatch(f.document, 'visibilitychange'); }
      if (end === 'unmount') await f.unmount();
      await f.advance(1_500);
      assert.ok(!f.announcement());
      await f.unmount(); assert.equal(f.timers.size, 0);
    });
  }
});

test('received IDs expire with live events and fresh duplicates or expired snapshots never replay', async t => {
  const f = await fixture(t, { stage: true });
  const first = f.reaction('a');
  await f.receive([first]); const drops = f.drops(); assert.ok(drops > 0);
  await f.receive([]); await f.receive([first]); assert.equal(f.drops(), drops);
  await f.advance(6_000);
  assert.equal(f.caches.at(-1).size, 0);
  await f.receive([first]); assert.equal(f.drops(), drops);
  assert.equal(f.caches.at(-1).size, 0);
  for (let i = 0; i < 50; i++) {
    await f.receive([f.reaction(`live-${i}`)]); await f.advance(1_000);
    assert.ok(f.caches.at(-1).size <= 6);
  }
  await f.advance(6_000); assert.equal(f.caches.at(-1).size, 0);
});

test('mounts, team switches and reactions received while hidden do not replay', async t => {
  const initial = { id: 'initial', teamId: 'team', personId: 'alice', emoji: '🔥', count: 1, at: 10_000 };
  const f = await fixture(t, { stage: true, initial: [initial], strict: true });
  assert.equal(f.drops(), 0); assert.equal(f.announcement(), '');
  await f.render({ current: 'other' }); await f.render({ current: 'team' });
  assert.equal(f.drops(), 0);
  await f.render({ screen: 'settings' }); await f.receive([f.reaction('offscreen')]); await f.render({ screen: 'chat' });
  assert.equal(f.drops(), 0);
  f.document.visibilityState = 'hidden'; await f.dispatch(f.document, 'visibilitychange');
  await f.receive([f.reaction('hidden')]);
  f.document.visibilityState = 'visible'; await f.dispatch(f.document, 'visibilitychange'); await f.render();
  assert.equal(f.drops(), 0);
  await f.receive([f.reaction('fresh')]); assert.ok(f.drops() > 0);
});
