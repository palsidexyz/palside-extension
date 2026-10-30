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

const require = createRequire(import.meta.url), h = React.createElement;
const compiled = new Map();
const cardFile = 'apps/extension/src/features/palside/account/person-card.tsx';
const dialogDir = 'packages/ui/src/components/dialog/';
function compile(file) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  return compiled.get(file);
}

// React runs the production components; the DOM host supplies native dialog and focus APIs.
async function fixture(t) {
  const { window, document } = parseHTML('<html><body><button id="trigger">Person</button><button id="fallback">Panel</button><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  const prototype = window.HTMLElement.prototype;
  const properties = ['focus', 'checkVisibility', 'showModal', 'close', 'getBoundingClientRect', 'tabIndex'];
  const descriptors = Object.fromEntries(properties.map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
  const active = { current: document.body };
  Object.defineProperty(document, 'activeElement', { get: () => active.current.isConnected ? active.current : document.body });
  const focusCalls = [], opens = [], nativeReturn = new WeakMap();
  prototype.focus = function (options) { focusCalls.push({ element: this, options }); if (this.isConnected && this.checkVisibility()) active.current = this; };
  prototype.checkVisibility = function () { return !this.hidden && this.style.display !== 'none'; };
  Object.defineProperty(prototype, 'tabIndex', { configurable: true, get() { return this.hasAttribute('tabindex') ? Number(this.getAttribute('tabindex')) : this.matches('button, input, select, textarea, a[href]') ? 0 : -1; } });
  prototype.showModal = function () {
    assert.equal(this.isConnected, true);
    nativeReturn.set(this, document.activeElement);
    this.open = true; opens.push(this);
    (this.querySelector('button, input, select, textarea, a[href]') ?? this).focus();
  };
  prototype.close = function () {
    this.open = false;
    const previous = nativeReturn.get(this);
    active.current = previous?.isConnected && previous.checkVisibility() ? previous : document.body;
  };
  prototype.getBoundingClientRect = () => ({ left: 100, right: 400, top: 100, bottom: 400 });
  const stylePrototype = Object.getPrototypeOf(document.body.style);
  const priorityDescriptor = Object.getOwnPropertyDescriptor(stylePrototype, 'getPropertyPriority');
  Object.defineProperty(stylePrototype, 'getPropertyPriority', { configurable: true, value: () => '' });
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), clsx: require('clsx'),
    'use-intl': { useTranslations: () => (key, values) => values?.name ? `${key}: ${values.name}` : key },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@palside/i18n': { message: key => key, errorMessage: error => error.message },
    '@palside/ui/tooltip': { Tooltip: ({ children }) => children },
    '../annotations/social-state': { useSocialUi: () => ({}), setSocialUi() {} },
    '../ui/primitives': { Action: ({ label, children, ...props }) => h('button', { ...props, 'aria-label': label }, children), PersonAvatar: () => null, Token: () => null },
    './account-label': { accountLabel: id => id },
    '../../../domain/account/profile-tags': { tagKey: tag => tag, tagLabel: tag => tag },
    '../wallet/payment-sheet': { openTransfer() {} },
    './alert-dialog': { AlertDialog: () => null },
  };
  const context = vm.createContext({
    console, document, window, HTMLElement: window.HTMLElement,
    getComputedStyle: element => ({ overflowY: element.style.overflowY || element.style.overflow || 'visible' }),
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const loaded = new Map();
  function load(file) {
    if (loaded.has(file)) return loaded.get(file);
    const exports = {}; loaded.set(file, exports);
    vm.runInContext(`(function(exports, require) { ${compile(file)}\n})`, context, { filename: file })(exports, name => {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name === '@palside/ui/dialog') return load(`${dialogDir}index.ts`);
      if (name === './dialog') return load(`${dialogDir}dialog.tsx`);
      if (name === '../../internal/backdrop-dismiss') return load('packages/ui/src/internal/backdrop-dismiss.ts');
      assert.fail(`Unmocked import: ${name}`);
    });
    return exports;
  }
  const { PersonCard } = load(cardFile);
  const { Dialog, useDialogBehavior } = load(`${dialogDir}index.ts`);
  const container = document.getElementById('root');
  const root = createRoot(container);
  let mounted = true, escapes = 0;
  const closes = [];
  const panel = content => h('main', { onKeyDown: event => { if (event.key === 'Escape') escapes++; } }, content);
  const render = content => act(async () => root.render(panel(content)));
  const c = {
    people: [{ id: 'friend', name: 'Friend' }], personId: 'friend', data: { self: 'self', views: [] },
    team: { memberIds: ['self', 'friend'], owner: 'self' }, current: 'team', requests: [], canWrite: true,
    setPersonId(id) { closes.push(id); c.personId = id; root.render(panel(id ? h(PersonCard, { c }) : null)); },
  };
  const renderCard = async (patch = {}) => { Object.assign(c, patch); await render(h(PersonCard, { c })); };
  const unmount = async () => { if (mounted) { await act(async () => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor); else delete prototype[key];
    }
    if (priorityDescriptor) Object.defineProperty(stylePrototype, 'getPropertyPriority', priorityDescriptor); else delete stylePrototype.getPropertyPriority;
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
    }
  });
  const dispatch = async (element, type, props = {}) => {
    const event = Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), props);
    await act(async () => element.dispatchEvent(event));
    return event;
  };
  const trigger = document.getElementById('trigger'), fallback = document.getElementById('fallback');
  trigger.focus();
  return { document, container, trigger, fallback, closes, focusCalls, opens, renderCard, render, unmount, dispatch, Dialog, useDialogBehavior,
    escapes: () => escapes, dialog: () => document.querySelector('dialog') };
}

test('PersonCard requires an outside press and release; drag-out, drag-in and cancelled presses stay open', async t => {
  const f = await fixture(t); await f.renderCard();
  const dialog = f.dialog(), inside = dialog.querySelector('h2');
  const outsidePoint = { clientX: 20, clientY: 20 }, insidePoint = { clientX: 150, clientY: 150 };
  await f.dispatch(inside, 'pointerdown', insidePoint);
  await f.dispatch(dialog, 'click', outsidePoint);
  await f.dispatch(dialog, 'pointerdown', outsidePoint);
  await f.dispatch(inside, 'click', insidePoint);
  await f.dispatch(dialog, 'pointerdown', outsidePoint);
  await f.dispatch(dialog, 'pointercancel');
  await f.dispatch(dialog, 'click', outsidePoint);
  await f.dispatch(dialog, 'pointerdown', insidePoint);
  await f.dispatch(dialog, 'click', insidePoint);
  assert.deepEqual(f.closes, []);
  assert.equal(dialog.open, true);
  await f.dispatch(dialog, 'pointerdown', outsidePoint);
  await f.dispatch(dialog, 'click', outsidePoint);
  assert.deepEqual(f.closes, [undefined]);
  assert.equal(f.dialog(), null);
  assert.equal(f.document.activeElement, f.trigger);
});

for (const event of ['keydown', 'cancel']) test(`PersonCard ${event} dismisses without reaching the panel and restores focus`, async t => {
  const f = await fixture(t); await f.renderCard();
  const dismissed = await f.dispatch(f.dialog(), event, { key: 'Escape' });
  assert.equal(dismissed.defaultPrevented, true);
  assert.equal(f.escapes(), 0);
  assert.deepEqual(f.closes, [undefined]);
  assert.equal(f.document.activeElement, f.trigger);
  assert.equal(f.focusCalls.at(-1).options.preventScroll, true);
});

test('PersonCard ignores an Escape already handled by its content', async t => {
  const f = await fixture(t); await f.renderCard();
  const content = f.dialog().querySelector('h2');
  content.addEventListener('keydown', event => event.preventDefault());
  await f.dispatch(content, 'keydown', { key: 'Escape' });
  assert.deepEqual(f.closes, []);
  assert.equal(f.dialog().open, true);
});

for (const state of ['removed', 'hidden']) test(`PersonCard leaves native focus fallback intact when the trigger is ${state}`, async t => {
  const f = await fixture(t); await f.renderCard();
  if (state === 'removed') f.trigger.remove(); else f.trigger.hidden = true;
  const calls = f.focusCalls.length;
  await f.unmount();
  assert.equal(f.document.activeElement, f.document.body);
  assert.equal(f.focusCalls.slice(calls).some(call => call.element === f.trigger), false);
});

test('PersonCard locks scrolling for its lifetime, restores offsets and opens when person data becomes available', async t => {
  const f = await fixture(t);
  f.container.style.overflow = 'auto'; f.container.scrollTop = 42; f.container.scrollLeft = 7;
  await f.renderCard({ people: [] }); assert.equal(f.dialog(), null);
  assert.equal(f.container.style.overflow, 'auto');
  await f.renderCard({ people: [{ id: 'friend', name: 'Friend' }] });
  assert.equal(f.dialog().open, true);
  assert.equal(f.container.style.overflow, 'hidden');
  const focused = f.document.activeElement;
  await f.renderCard();
  assert.equal(f.opens.length, 1);
  assert.equal(f.document.activeElement, focused);
  f.container.scrollTop = 0; f.container.scrollLeft = 0;
  await f.renderCard({ people: [] });
  assert.equal(f.container.style.overflow, 'auto');
  assert.equal(f.container.scrollTop, 42); assert.equal(f.container.scrollLeft, 7);
  assert.equal(f.document.activeElement, f.trigger);
});

test('PersonCard keeps its presentation and wraps keyboard focus between its existing actions', async t => {
  const f = await fixture(t); await f.renderCard();
  const dialog = f.dialog();
  assert.equal(dialog.className, 'personCard person');
  assert.equal(dialog.getAttribute('aria-label'), 'extension.dynamic.profileTitle: Friend');
  assert.deepEqual([...dialog.children].map(child => child.className), ['head', 'actions']);
  assert.equal(dialog.querySelector('h2').textContent, 'Friend');
  assert.equal(dialog.style.cssText, '');
  const buttons = dialog.querySelectorAll('button'), first = buttons[0], last = buttons[buttons.length - 1];
  last.focus(); await f.dispatch(last, 'keydown', { key: 'Tab' });
  assert.equal(f.document.activeElement, first);
  await f.dispatch(first, 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(f.document.activeElement, last);
  await f.dispatch(first, 'click');
  assert.equal(f.document.activeElement, f.trigger);
});

test('shared hook uses the supplied return-focus fallback for a removed trigger', async t => {
  const f = await fixture(t), returnFocusRef = { current: f.fallback };
  function CustomDialog() {
    const { dialogRef, dialogProps } = f.useDialogBehavior({ open: true, onOpenChange() {}, returnFocusRef });
    return h('dialog', { ref: dialogRef, ...dialogProps }, h('button', null, 'Close'));
  }
  await f.render(h(CustomDialog)); f.trigger.remove(); await f.unmount();
  assert.equal(f.document.activeElement, f.fallback);
  assert.equal(f.focusCalls.at(-1).options.preventScroll, true);
});

test('Dialog retains its markup, title focus, pending guard and controlled lifetime', async t => {
  const f = await fixture(t), changes = [];
  const props = { open: true, onOpenChange: value => changes.push(value), title: 'Title', description: 'Description', pending: true,
    headerAction: h('button', null, 'Back'), footer: h('button', null, 'Confirm'), children: h('button', null, 'Content') };
  await f.render(h(f.Dialog, props));
  const dialog = f.dialog(), title = dialog.querySelector('h2');
  assert.equal(dialog.className, 'dialog');
  assert.equal(dialog.dataset.slot, 'dialog');
  assert.equal(dialog.dataset.placement, 'center');
  assert.equal(dialog.dataset.size, 'sm');
  assert.equal(dialog.getAttribute('aria-labelledby'), title.id);
  assert.equal(dialog.getAttribute('aria-describedby'), dialog.querySelector('p').id);
  assert.deepEqual([...dialog.firstElementChild.children].map(child => child.className), ['dialogHeader', 'dialogBody', 'dialogFooter']);
  assert.equal(f.document.activeElement, title);
  await f.dispatch(dialog, 'keydown', { key: 'Escape' }); await f.dispatch(dialog, 'cancel');
  await f.dispatch(dialog, 'pointerdown', { clientX: 20, clientY: 20 }); await f.dispatch(dialog, 'click', { clientX: 20, clientY: 20 });
  assert.deepEqual(changes, []);
  assert.equal(f.escapes(), 0);
  await f.render(h(f.Dialog, { ...props, pending: false }));
  assert.equal(f.opens.length, 1);
  await f.dispatch(dialog, 'keydown', { key: 'Escape' });
  assert.deepEqual(changes, [false]);
  await f.render(h(f.Dialog, { ...props, open: false }));
  assert.equal(dialog.open, false); assert.equal(f.document.activeElement, f.trigger);
  await f.dispatch(dialog, 'close');
  assert.deepEqual(changes, [false]);
});

test('Dialog respects initial focus, wraps Tab and uses title focus when there are no enabled visible controls', async t => {
  const f = await fixture(t), initialFocusRef = React.createRef();
  const props = { open: true, onOpenChange() {}, title: 'Title', initialFocusRef };
  await f.render(h(f.Dialog, props, h('button', null, 'First'), h('button', { ref: initialFocusRef }, 'Last')));
  assert.equal(f.document.activeElement, initialFocusRef.current);
  await f.dispatch(f.dialog(), 'keydown', { key: 'Tab' });
  assert.equal(f.document.activeElement.textContent, 'First');
  await f.dispatch(f.dialog(), 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(f.document.activeElement, initialFocusRef.current);
  await f.render(h(f.Dialog, props, h('button', { disabled: true }, 'Disabled'), h('button', { hidden: true }, 'Hidden')));
  await f.dispatch(f.dialog(), 'keydown', { key: 'Tab' });
  assert.equal(f.document.activeElement, f.dialog().querySelector('h2'));
});
