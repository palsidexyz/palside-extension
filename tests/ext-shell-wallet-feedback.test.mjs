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
const sources = new Map();
function compiled(file) {
  if (!sources.has(file)) sources.set(file, ts.transpileModule(readFileSync(new URL(`../apps/extension/src/features/palside/${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  return sources.get(file);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(t) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  const timers = new Map(); let now = 0, timerId = 0;
  const passthrough = ({ children }) => children;
  const Button = ({ children, onClick, disabled, leadingIcon, ...props }) => h('button', { onClick, disabled, 'aria-label': props['aria-label'] }, leadingIcon, children);
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => key => key },
    '@palside/i18n': { message: key => key, errorMessage: error => error.message },
    'motion/react': { useReducedMotion: () => false, motion: { div: ({ children, className }) => h('div', { className }, children) } },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@palside/ui/button': { Button, IconButton: Button },
    '@palside/ui/field': { Input: props => h('input', props), PinInput: () => null },
    '@palside/ui/inline-feedback': { InlineFeedback: ({ children, action }) => h('div', null, h('div', { role: 'alert' }, children), h(Button, { onClick: action.onClick }, action.label)) },
    '@palside/ui/sheet': { Sheet: passthrough },
    'qrcode.react': { QRCodeSVG: ({ value }) => h('output', null, value) },
    '../settings/setting-rows': { SettingGroup: passthrough, SettingItem: () => null },
    '../ui/primitives': { Token: () => null },
    '../ui/motion-details': { Swap: passthrough, Dots: () => null },
    './amount': { PalsAmount: () => null },
    '@palside/shared/navigation': { shortAddress: value => value.slice(0, 8) },
    './payment-sheet': { PALS: {} }, './packet': { PacketDetail: () => null },
    './recovery': { WalletRecoveryList: () => null }, './recovery-state': { recordLabels: {} },
    '../chat/history-scope': { EmptyState: () => null },
  };
  let write = async () => {};
  const context = vm.createContext({ console, navigator: { clipboard: { writeText: value => write(value) } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  function load(file) {
    const exports = {};
    vm.runInContext(`(function(exports, require) { ${compiled(file)}\n})`, context)(exports, name => {
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }), __esModule: true };
      assert.ok(Object.hasOwn(modules, name), `unmocked import ${name}`); return modules[name];
    });
    return exports;
  }
  const { WalletHome, WalletReceive } = load('wallet/wallet.tsx');
  const { usePanelCommands } = load('app/use-panel-commands.ts');
  const notices = [], copied = [];
  let actions;
  function Commands() {
    actions = usePanelCommands({ view: { setNotice: value => notices.push(value), setCopied: value => copied.push(value) } });
    return null;
  }
  const root = createRoot(document.getElementById('root')); let mounted = true;
  const unmount = async () => { if (mounted) { await act(async () => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
    }
  });
  await act(async () => root.render(h(Commands)));
  return { document, timers, notices, copied, actions, WalletHome, WalletReceive, unmount,
    clipboard: fn => { write = fn; },
    render: (Component, c) => act(async () => root.render(h(Component, { c: { ...actions, ...c } }))),
    click: target => act(async () => target.click()),
    advance: async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); await act(async () => timer.fn()); } },
  };
}

test('copy returns verified success and retains shared notices for callers that ignore the result', async t => {
  const f = await fixture(t);
  f.clipboard(async value => { assert.equal(value, 'address'); });
  assert.equal(await f.actions.copy('address'), true);
  f.clipboard(async () => { throw Error('denied'); });
  assert.equal(await f.actions.copy('address'), false);
  assert.deepEqual(f.copied, [true]);
  assert.deepEqual(f.notices, ['extension.copy.copied', 'extension.copy.copyManual']);
});

for (const page of ['WalletHome', 'WalletReceive']) test(`${page} waits for clipboard success and exposes selectable text on failure`, async t => {
  const f = await fixture(t), address = '0x1234567890abcdef';
  const c = { live: { command: async () => ({ uri: 'ethereum:address' }), state: { wallet: { address, availability: 'ready', preferences: {} } } } };
  await f.render(f[page], c);
  const trigger = () => page === 'WalletHome' ? f.document.querySelector('.addressChip') : [...f.document.querySelectorAll('button')].find(button => button.textContent === 'extension.wallet.copyAddress');
  const pending = deferred(); f.clipboard(() => pending.promise);
  await f.click(trigger());
  assert.equal(f.document.querySelector('[data-copied="true"]'), null);
  assert.ok(!f.document.body.textContent.includes('extension.copy.copied'));
  await act(async () => pending.reject(Error('denied')));
  const input = f.document.querySelector('input');
  assert.equal(input.value, address); assert.ok(input.hasAttribute('readOnly'));
  let selected = false; input.select = () => { selected = true; };
  await act(async () => input.dispatchEvent(new f.document.defaultView.Event('focusin', { bubbles: true })));
  assert.equal(selected, true);
  f.clipboard(async () => {}); await f.click(trigger());
  assert.equal(f.document.querySelector('input'), null);
  if (page === 'WalletHome') assert.ok(f.document.querySelector('[data-copied="true"]'));
  else assert.ok(f.document.body.textContent.includes('extension.copy.copied'));
  await f.advance(1400);
  assert.equal(f.document.querySelector('[data-copied="true"]'), null);
  assert.ok(!f.document.body.textContent.includes('extension.copy.copied'));
});

test('every stalled-wallet retry gets a fresh six-second deadline', async t => {
  const f = await fixture(t); let requests = 0;
  const request = () => { requests++; return new Promise(() => {}); };
  const c = { live: { command: request, state: { wallet: { availability: 'loading' } } }, run: request };
  await f.render(f.WalletHome, c);
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.advance(5999); assert.equal(f.document.querySelector('button'), null);
    await f.advance(1); assert.equal(f.document.querySelector('button').textContent, 'common.retry');
    await f.click(f.document.querySelector('button'));
    assert.equal(f.document.querySelector('button'), null);
  }
  assert.equal(requests, 4);
  await f.unmount(); assert.equal(f.timers.size, 0);
});

test('receive retry clears its error immediately and can recover after repeated failures', async t => {
  const f = await fixture(t), requests = [];
  const c = { live: { command: () => { const next = deferred(); requests.push(next); return next.promise; }, state: { wallet: { address: 'address' } } } };
  await f.render(f.WalletReceive, c);
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => requests[attempt].reject(Error('offline')));
    assert.ok(f.document.querySelector('[role="alert"]'));
    await f.click([...f.document.querySelectorAll('button')].find(button => button.textContent === 'common.retry'));
    assert.equal(f.document.querySelector('[role="alert"]'), null);
    assert.equal(requests.length, attempt + 2);
  }
  await act(async () => requests[2].resolve({ uri: 'ethereum:address' }));
  assert.equal(f.document.querySelector('output').textContent, 'ethereum:address');
  assert.equal(f.document.querySelector('[role="alert"]'), null);
});
