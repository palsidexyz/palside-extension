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
import * as signalModel from '../apps/extension/src/runtime/annotations/signals.ts';

const require = createRequire(import.meta.url), h = React.createElement;
const sourceRoot = new URL('../apps/extension/src/features/palside/', import.meta.url);
const compiled = new Map();
function compile(file) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(file, sourceRoot), 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  return compiled.get(file);
}

// Production settings and tabs run with React effects, DOM events and deferred host commands.
async function fixture(t, { shared = false, read } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  const focus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function () { document.activeElement = this; };
  const passthrough = ({ children }) => children;
  const without = (props, names) => Object.fromEntries(Object.entries(props).filter(([key]) => !names.includes(key)));
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => key => key },
    '@palside/i18n': { errorMessage: error => error.message },
    '@palside/ui/button': { Button: props => h('button', without(props, ['size', 'variant'])) },
    '@palside/ui/tooltip': { Tooltip: passthrough },
    '@palside/ui/switch': { Switch: props => h('input', { ...without(props, ['label', 'hideLabel']), type: 'checkbox', 'aria-label': props.label }) },
    './motion-details': { Count: ({ value }) => value },
    './primitives': { useHeld: value => [value, (_next, run) => run(), false] },
    '../../../runtime/annotations/signals': signalModel,
    '../../../domain/assets/model': { assetView: () => undefined },
    '../../../domain/assets/shared-tokens': { sharedTokens: () => [] },
    '../media/message-image': { MessageImage: () => null },
    './asset-card': { AssetCard: () => null },
    '../chat/history-scope': { EmptyState: passthrough, HistoryMore: () => null },
    '@palside/shared/navigation': { publicShareUrl: value => value },
    'lucide-react': Object.fromEntries(['ArrowUpRight', 'Coins', 'Image', 'Link2'].map(name => [name, () => null])),
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const imported = name => {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
      if (name === '../ui/sub-rows') return load('ui/sub-rows.tsx');
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInContext(`(function(exports, require) { ${compile(file)}\n})`, context, { filename: file })(exports, imported);
    cache.set(file, exports);
    return exports;
  };
  const { SignalOptions } = load('settings/signal-settings.tsx');
  const { SharedContent } = load('assets/shared-content.tsx');
  const requests = [], reads = [], notices = [];
  let account = 'alice';
  const defaults = () => structuredClone(signalModel.defaultSignalSettings);
  const command = (name, payload) => {
    if (name === 'signal-settings-get') { reads.push(account); return read?.(account) ?? Promise.resolve(defaults()); }
    const gate = Promise.withResolvers();
    requests.push({ payload: structuredClone(payload), ...gate });
    return gate.promise;
  };
  let c = { data: { self: account }, live: { state: { account: { id: account } }, command }, setNotice: value => notices.push(value), currentMessages: [], people: [], now: 0 };
  function Shared() {
    const [sharedCategory, setSharedCategory] = React.useState('images');
    return h(SharedContent, { c: { ...c, sharedCategory, setSharedCategory }, onJump() {} });
  }
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  const render = async (id = account) => {
    account = id;
    c = { ...c, data: { self: id }, live: { ...c.live, state: { account: { id } } }, setNotice: value => notices.push(value) };
    await act(async () => { root.render(h(React.StrictMode, null, shared ? h(Shared) : h(SignalOptions, { c }))); });
  };
  const unmount = async () => { if (mounted) { await act(() => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    window.HTMLElement.prototype.focus = focus;
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
    }
  });
  const dispatch = async (target, type, props = {}) => {
    assert.ok(target);
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, props);
    await act(() => target.dispatchEvent(event));
    return event;
  };
  await render();
  return {
    document, requests, reads, notices, render, unmount, dispatch, defaults,
    click: target => dispatch(target, 'click'),
    button: text => [...document.querySelectorAll('button')].find(button => button.textContent === text),
    settle: async (request, value) => { await act(() => request.resolve({ ...defaults(), ...value })); },
  };
}

async function queueEdits(f) {
  await f.click(f.button('extension.signal.keyChange'));
  await f.click(f.button('Ctrl'));
  await f.click(f.button('Shift'));
  assert.equal(f.requests.length, 1, 'second edit waits for the first save');
  assert.equal(f.requests[0].payload.expectedAccountId, 'alice');
}

test('signal edits serialize and retain the expected account on every command', async t => {
  const f = await fixture(t);
  await queueEdits(f);
  const reads = f.reads.length;
  await f.render();
  assert.equal(f.reads.length, reads, 'parent rerenders do not reload settings or cancel valid edits');
  assert.equal(f.document.querySelector('.hubKeys').textContent, 'CtrlAltShift');
  await f.settle(f.requests[0], f.requests[0].payload.settings);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].payload.expectedAccountId, 'alice');
  assert.deepEqual(f.requests[1].payload.settings.key, ['Control', 'Alt', 'Shift']);
  await f.settle(f.requests[1], f.requests[1].payload.settings);
  assert.equal(f.document.querySelector('.root').hasAttribute('aria-busy'), false);
});

test('queued signal edits and late success/failure are invalidated on unmount and account replacement', async t => {
  for (const end of ['unmount', 'account', 'roundtrip']) for (const outcome of ['resolve', 'reject']) {
    await t.test(`${end}: ${outcome}`, async t => {
      const f = await fixture(t);
      await queueEdits(f);
      if (end === 'unmount') await f.unmount();
      else {
        await f.render('bob');
        if (end === 'roundtrip') await f.render('alice');
      }
      const reads = f.reads.length;
      await act(() => outcome === 'resolve' ? f.requests[0].resolve({ ...f.defaults(), key: ['Shift'] }) : f.requests[0].reject(new Error('save failed')));
      assert.equal(f.requests.length, 1);
      assert.equal(f.reads.length, reads, 'stale failure cannot start recovery');
      assert.deepEqual(f.notices, []);
      if (end !== 'unmount') {
        assert.equal(f.document.querySelector('.root').hasAttribute('aria-busy'), false);
        assert.equal(f.document.querySelector('.hubKeys').textContent, 'Alt');
        await f.click(f.button('extension.signal.keyChange'));
        await f.click(f.button('Shift'));
        assert.equal(f.requests[1].payload.expectedAccountId, end === 'account' ? 'bob' : 'alice');
        await f.settle(f.requests[1], f.requests[1].payload.settings);
      }
    });
  }
});

test('late initial reads cannot replace another account or publish an error after unmount', async t => {
  for (const end of ['account', 'unmount']) for (const outcome of ['resolve', 'reject']) await t.test(`${end}: ${outcome}`, async t => {
    const pending = Promise.withResolvers();
    const f = await fixture(t, { read: id => id === 'alice' ? pending.promise : undefined });
    if (end === 'account') await f.render('bob'); else await f.unmount();
    await act(() => outcome === 'resolve' ? pending.resolve({ ...f.defaults(), key: ['Shift'] }) : pending.reject(new Error('read failed')));
    if (end === 'account') assert.equal(f.document.querySelector('.hubKeys').textContent, 'Alt');
    assert.deepEqual(f.notices, []);
  });
});

test('recovery reads cannot overwrite a newer edit or a replacement account', async t => {
  for (const next of ['edit', 'account', 'unmount']) await t.test(next, async t => {
    let recovery;
    const f = await fixture(t, { read: () => recovery?.promise });
    await f.click(f.button('extension.signal.keyChange'));
    await f.click(f.button('Ctrl'));
    recovery = Promise.withResolvers();
    await act(() => f.requests[0].reject(new Error('save failed')));
    assert.deepEqual(f.notices, ['save failed']);
    if (next === 'edit') await f.click(f.button('Shift'));
    if (next === 'account') { const pending = recovery; recovery = undefined; await f.render('bob'); recovery = pending; }
    if (next === 'unmount') await f.unmount();
    await act(() => recovery.resolve({ ...f.defaults(), key: ['Shift'] }));
    if (next === 'edit') {
      assert.equal(f.document.querySelector('.hubKeys').textContent, 'CtrlAltShift');
      assert.equal(f.requests.length, 2);
      await f.settle(f.requests[1], f.requests[1].payload.settings);
    } else {
      assert.equal(f.requests.length, 1);
      if (next === 'account') assert.equal(f.document.querySelector('.hubKeys').textContent, 'Alt');
    }
  });
});

test('shared categories and signal palette reuse linked roving tabs without changing their containers', async t => {
  for (const shared of [false, true]) await t.test(shared ? 'shared categories' : 'signal palette', async t => {
    const f = await fixture(t, { shared });
    const list = f.document.querySelector('[role="tablist"]');
    assert.equal(list.tagName, shared ? 'DIV' : 'SPAN');
    assert.equal(list.className, shared ? 'sharedTabs' : 'tabs');
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const check = (index, focused = true) => {
      const panel = f.document.querySelector('[role="tabpanel"]');
      assert.equal(panel.className, shared ? 'sharedPanel' : 'palette');
      assert.equal(panel.getAttribute('aria-labelledby'), tabs[index].id);
      tabs.forEach((tab, at) => {
        assert.equal(tab.getAttribute('aria-selected'), String(at === index));
        assert.equal(tab.getAttribute('tabindex'), at === index ? '0' : '-1');
        assert.equal(tab.getAttribute('aria-controls'), panel.id);
      });
      if (focused) assert.equal(f.document.activeElement, tabs[index]);
    };
    check(0, false);
    const last = tabs.length - 1;
    let index = 0;
    for (const [key, next] of [['ArrowLeft', last], ['ArrowRight', 0], ['End', last], ['Home', 0], ['ArrowRight', 1]]) {
      const event = await f.dispatch(tabs[index], 'keydown', { key });
      assert.equal(event.defaultPrevented, true);
      check(next); index = next;
    }
    const ignored = await f.dispatch(tabs[index], 'keydown', { key: 'x' });
    assert.equal(ignored.defaultPrevented, false); check(index);
    await f.click(tabs[0]); check(0, false);
  });
});
