import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import * as walletModel from '../apps/extension/src/domain/wallet/model.ts';
import { CHAIN_RULES } from '../packages/shared/src/chain/rules.ts';

const require = createRequire(import.meta.url), h = React.createElement;
const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
window.HTMLElement.prototype.showModal = function () { this.open = true; };
const { createRoot } = await import('react-dom/client');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const css = new Proxy({}, { get: (_, key) => key });
const translate = (key, values = {}) => key + (Object.keys(values).length ? ':' + JSON.stringify(values) : '');
const pass = ({ children }) => children;

// Production React components with deferred commands and inert presentation primitives.
function production() {
  const omit = (props, keys) => Object.fromEntries(Object.entries(props).filter(([key]) => !keys.includes(key)));
  const Button = ({ children, loading, ...props }) => h('button', { ...omit(props, ['variant', 'size']), disabled: props.disabled || loading }, children);
  const IconButton = ({ label, ...props }) => h(Button, { ...props, 'aria-label': label });
  const motionTags = new Map();
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => translate, useLocale: () => 'en' },
    '@palside/i18n': { errorMessage: error => error.message, clockTime: String, localeOrEnglish: value => value },
    '@palside/shared/navigation': { shortAddress: value => value },
    '@palside/shared/chain/rules': { CHAIN_RULES },
    '@palside/design/motion': { motionPresets: { feedback: {} } },
    '@palside/ui/button': { Button, IconButton },
    '@palside/ui/field': { PinInput: ({ onValueChange, ...props }) => h('input', { ...omit(props, ['outlined']), onInput: event => onValueChange(event.target.value) }) },
    '@palside/ui/sheet': { Sheet: ({ open, children, onOpenChange, ...props }) => open ? h('section', { 'data-sheet': true, 'aria-labelledby': props['aria-labelledby'] }, children, h('button', { 'data-dismiss': true, onClick: () => onOpenChange(false) }, 'Dismiss')) : null },
    '@palside/ui/visually-hidden': { VisuallyHidden: pass },
    '@palside/ui/inline-feedback': { InlineFeedback: ({ children, action }) => h('div', { role: 'alert' }, children, h('button', { onClick: action.onClick }, action.label)) },
    '../../../domain/wallet/model': walletModel,
    '../../../domain/account/model': { personFor: (people, id) => people.find(person => person.id === id) ?? { id, name: id } },
    '../rooms/rooms': { roomPerson: (_c, author) => author },
    '../ui/primitives': { PersonAvatar: () => null, Token: () => null },
    '../ui/text': { useText: () => value => value },
    '../ui/motion-details': { Count: ({ value }) => value, CountText: ({ text }) => text, Dots: () => 'pending', DrawnCheck: () => 'confirmed', Fit: pass, Rise: pass, Step: pass, Swap: pass },
    './amount': { PalsAmount: ({ value }) => value, formatPals: value => String(Number(value) / 1e18) },
    './recovery-state': { recordLabels: { transfer: 'transfer', tip: 'tip', packet: 'packet' }, recoveryLabel: () => 'review' },
    '@number-flow/react': { __esModule: true, default: ({ value }) => value },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    'motion/react': { AnimatePresence: pass, useReducedMotion: () => true, motion: new Proxy({}, { get: (_, tag) => {
      if (!motionTags.has(tag)) motionTags.set(tag, props => h(tag, omit(props, ['initial', 'animate', 'exit', 'transition', 'whileTap', 'onAnimationComplete'])));
      return motionTags.get(tag);
    } }) },
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout, Date });
  function load(name) {
    const file = `apps/extension/src/features/palside/wallet/${name}.tsx`;
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    vm.runInContext(`(function(require, module, exports) { ${code}\n})`, context)(specifier => {
      if (specifier.endsWith('.css')) return { __esModule: true, default: css };
      assert.ok(Object.hasOwn(modules, specifier), `Unmapped import ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    return module.exports;
  }
  const payment = modules['./payment-sheet'] = load('payment-sheet');
  const packet = modules['./packet'] = load('packet');
  return { ...payment, ...packet, ...load('room-payments'), ...load('recovery') };
}
const quoted = (id, accountId = 'self', phase = 'review') => ({ id, phase, passwordRequired: false, total: '1000000000000000000', input: { kind: 'transfer', recipient: '0x123', amount: '1000000000000000000' }, order: { id, accountId, kind: 'transfer', amount: '1000000000000000000', recipient: '0x123' } });

async function fixture(t, handler = async () => undefined) {
  const components = production(), calls = [], container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let view, sessionKey = 0;
  const c = { data: { self: 'self' }, screen: 'chat', current: 'team', now: Date.now(), people: [{ id: 'self', name: 'Self' }, { id: 'peer', name: 'Peer' }], team: { name: 'Squad', owner: 'self', memberIds: ['self', 'peer'] }, back: () => calls.push(['back']) };
  const command = async (name, payload) => { calls.push([name, structuredClone(payload)]); return handler(name, payload); };
  c.live = { command, state: { account: { id: 'self' }, authenticated: true, rooms: { current: { key: 'room', messages: [{ id: 'message', author: { id: 'peer', name: 'Peer' }, text: 'hello' }] } }, wallet: { availability: 'ready', config: { enabled: true, deployment: { decimals: 18 } }, balance: { balance: '1000000000000000000000' } } } };
  c.run = (...args) => command(...args).catch(() => undefined);
  function Session() {
    components.usePaymentSession(c.live.state.authenticated ? c.live.state.account.id : undefined);
    return h(React.Fragment, {}, view?.(), h(components.PaymentSheet, { c }));
  }
  const render = async () => { await act(async () => root.render(h(Session, { key: sessionKey }))); };
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  await render();
  const click = async node => { assert.ok(node, 'click target exists'); await act(async () => node.dispatchEvent(new window.Event('click', { bubbles: true }))); };
  const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.startsWith(label));
  const input = async (selector, value) => { const node = container.querySelector(selector); assert.ok(node); const props = node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]; await act(async () => props.onChange({ target: { value } })); };
  return { c, calls, container, components, render, click, button, input,
    view: async next => { view = next; await render(); },
    remount: async (accountId = 'self') => { sessionKey++; c.live.state.account = { id: accountId }; c.data.self = accountId; await render(); },
    openTransfer: async () => { await act(async () => components.openTransfer('peer')); },
    show: async payment => { c.live.state.wallet.payment = payment; await act(async () => { root.render(h(Session, { key: sessionKey })); components.openPayment(payment.id); }); },
  };
}
const settle = async (work, value) => { await act(async () => { work.resolve(value); await work.promise; }); };

for (const action of ['reopen', 'logout', 'remount', 'switch-account']) {
  test(`late transfer quote cannot enter another opening after ${action}`, async t => {
    const quote = deferred(), f = await fixture(t, name => name === 'wallet-review' ? quote.promise : undefined);
    await f.openTransfer(); await f.input('input[placeholder="0"]', '1'); await f.click(f.button('extension.wallet.next'));
    assert.equal(f.calls.filter(([name]) => name === 'wallet-review').length, 1);
    if (action === 'reopen') { await f.click(f.container.querySelector('[aria-label="common.close"]')); await f.openTransfer(); }
    if (action === 'logout') { f.c.live.state.authenticated = false; await f.render(); }
    if (action === 'remount') await f.remount();
    if (action === 'switch-account') await f.remount('other');
    f.c.live.state.wallet.payment = quoted('old');
    await settle(quote, quoted('old')); await f.render();
    assert.equal(f.container.textContent.includes('extension.wallet.confirmTransfer'), false);
    assert.deepEqual(f.calls.find(([name]) => name === 'wallet-dismiss'), ['wallet-dismiss', { accountId: 'self', paymentId: 'old' }]);
    if (action !== 'reopen') assert.equal(f.container.querySelector('[aria-labelledby="payment-title"]'), null);
  });
}

test('active transfer review owns its quote and sends scoped confirm and dismiss', async t => {
  const quote = deferred(), f = await fixture(t, name => name === 'wallet-review' ? quote.promise : undefined);
  await f.openTransfer(); await f.input('input[placeholder="0"]', '1'); await f.click(f.button('extension.wallet.next'));
  const payment = quoted('active'); f.c.live.state.wallet.payment = payment;
  await settle(quote, payment); await f.render();
  await f.click(f.button('extension.wallet.pay'));
  assert.deepEqual(f.calls.find(([name]) => name === 'wallet-confirm'), ['wallet-confirm', { accountId: 'self', paymentId: 'active', password: undefined }]);
  await f.click(f.container.querySelector('[aria-label="common.close"]'));
  assert.deepEqual(f.calls.find(([name]) => name === 'wallet-dismiss'), ['wallet-dismiss', { accountId: 'self', paymentId: 'active' }]);
});

test('pending runtime payment survives presentation closure and account-session teardown', async t => {
  const f = await fixture(t), payment = quoted('pending', 'self', 'pending');
  await f.show(payment); await f.click(f.container.querySelector('[aria-label="common.close"]'));
  await f.show(payment); await f.remount();
  assert.equal(f.container.querySelector('[aria-labelledby="payment-title"]'), null);
  assert.equal(f.calls.some(([name]) => name === 'wallet-dismiss'), false);
  assert.equal(f.c.live.state.wallet.payment, payment);
  await f.openTransfer(); assert.equal(f.container.querySelector('input[placeholder="0"]').value, '');
});

for (const kind of ['tip', 'packet']) {
  for (const departure of ['unmount', 'context', 'opening', 'account']) {
    test(`late ${kind} completion is ignored after ${departure}`, async t => {
      const quote = deferred(), f = await fixture(t, name => name === 'wallet-review' || name === 'wallet-packet-review' ? quote.promise : undefined);
      await f.view(() => kind === 'tip' ? h(f.components.TipPayment, { c: f.c, messageId: 'message', onClose: () => f.calls.push(['tip-close']) }) : h(f.components.PacketPage, { c: f.c }));
      if (kind === 'packet') await f.input('input[placeholder="0"]', '10');
      await f.click(f.button(kind === 'tip' ? 'extension.wallet.tipAmount' : 'extension.wallet.createPacket'));
      if (departure === 'unmount') await f.view(undefined);
      if (departure === 'context') { f.c.current = 'other-team'; await f.render(); }
      if (departure === 'opening') await f.openTransfer();
      if (departure === 'account') await f.remount('other');
      f.c.live.state.wallet.payment = quoted('late');
      await settle(quote, quoted('late')); await f.render();
      assert.equal(f.container.textContent.includes('extension.wallet.confirmTransfer'), false);
      assert.equal(f.calls.some(([name]) => name === 'tip-close' || name === 'back'), false);
      assert.deepEqual(f.calls.find(([name]) => name === 'wallet-dismiss'), ['wallet-dismiss', { accountId: 'self', paymentId: 'late' }]);
    });
  }
}

test('packet command rejection returned as undefined marks the existing form invalid', async t => {
  const f = await fixture(t, async name => { if (name === 'wallet-packet-review') throw new Error('OFFLINE'); });
  await f.view(() => h(f.components.PacketPage, { c: f.c })); await f.input('input[placeholder="0"]', '10');
  await f.click(f.button('extension.wallet.createPacket'));
  assert.match(f.container.textContent, /extension.wallet.invalidAmount/);
  assert.equal(f.container.querySelector('[aria-labelledby="payment-title"]'), null);
});

for (const status of ['issued', 'envelope']) {
  test(`cached packet ${status} survives refresh failure and retries without a claim`, async t => {
    const refreshes = [], f = await fixture(t, name => { if (name === 'wallet-packet') { const work = deferred(); refreshes.push(work); return work.promise; } });
    const claim = { accountId: 'self', status: 'issued', amount: '1000000000000000000', claimedAt: 1 };
    const initial = { packet: { id: 'packet', accountId: 'peer', status: 'active', expiresAt: Date.now() + 100000, count: 2, claimedCount: 1, claimedAmount: claim.amount, amount: '2000000000000000000' }, blessing: 'cached wish', eligibility: 'eligible', myClaim: status === 'issued' ? claim : null, claims: [claim] };
    await f.view(() => h(f.components.PacketDetail, { c: f.c, id: 'packet', initial, onClose() {} }));
    const originalEnvelope = f.container.querySelector('[data-packet-envelope]');
    await act(async () => { refreshes[0].reject(new Error('OFFLINE')); });
    assert.match(f.container.textContent, /cached wish/);
    assert.match(f.container.textContent, /extension.wallet.unavailable/);
    if (status === 'issued') { assert.match(f.container.textContent, /extension.wallet.settling/); assert.doesNotMatch(f.container.textContent, /extension.wallet.saved/); }
    else assert.equal(f.container.querySelector('[data-packet-envelope]'), originalEnvelope);
    await f.click(f.button('common.retry')); assert.equal(refreshes.length, 2);
    await settle(refreshes[1], { ...initial, blessing: 'fresh wish' });
    assert.match(f.container.textContent, /fresh wish/); assert.equal(f.container.querySelector('[role="alert"]'), null);
    assert.equal(f.calls.some(([name]) => name === 'wallet-claim' || name === 'wallet-confirm'), false);
  });
}

for (const kind of ['tip', 'packet']) {
  test(`active ${kind} completion opens its quote`, async t => {
    const quote = deferred(), f = await fixture(t, name => name === 'wallet-review' || name === 'wallet-packet-review' ? quote.promise : undefined);
    await f.view(() => kind === 'tip' ? h(f.components.TipPayment, { c: f.c, messageId: 'message', onClose: () => f.calls.push(['tip-close']) }) : h(f.components.PacketPage, { c: f.c }));
    if (kind === 'packet') await f.input('input[placeholder="0"]', '10');
    await f.click(f.button(kind === 'tip' ? 'extension.wallet.tipAmount' : 'extension.wallet.createPacket'));
    const payment = quoted('active'); f.c.live.state.wallet.payment = payment;
    await settle(quote, payment); await f.render();
    assert.match(f.container.textContent, /extension.wallet.confirmTransfer/);
    assert.equal(f.calls.some(([name]) => name === 'wallet-dismiss'), false);
    if (kind === 'tip') assert.equal(f.calls.filter(([name]) => name === 'tip-close').length, 1);
    else {
      await f.view(undefined);
      f.c.live.state.wallet.payment = { ...payment, phase: 'confirmed' }; await f.render();
      await f.click(f.container.querySelector('[aria-label="common.close"]'));
      assert.equal(f.calls.some(([name]) => name === 'back'), false);
    }
  });
}

test('tip dismissal invalidates a quote even while the closing component remains mounted', async t => {
  const quote = deferred(), f = await fixture(t, name => name === 'wallet-review' ? quote.promise : undefined);
  await f.view(() => h(f.components.TipPayment, { c: f.c, messageId: 'message', onClose: () => f.calls.push(['tip-close']) }));
  await f.click(f.button('extension.wallet.tipAmount'));
  await f.click(f.container.querySelector('[aria-labelledby="tip-title"] [data-dismiss]'));
  f.c.live.state.wallet.payment = quoted('late'); await settle(quote, quoted('late')); await f.render();
  assert.equal(f.container.querySelector('[aria-labelledby="payment-title"]'), null);
  assert.equal(f.calls.filter(([name]) => name === 'tip-close').length, 1);
  assert.deepEqual(f.calls.find(([name]) => name === 'wallet-dismiss'), ['wallet-dismiss', { accountId: 'self', paymentId: 'late' }]);
});

test('a stale refresh cannot overwrite newer packet detail or clear its retry feedback', async t => {
  const refreshes = [], f = await fixture(t, name => { if (name === 'wallet-packet') { const work = deferred(); refreshes.push(work); return work.promise; } });
  const initial = { packet: { id: 'packet', accountId: 'self', status: 'exhausted', expiresAt: 1, count: 2, claimedCount: 2, claimedAmount: '2', amount: '2' }, blessing: 'cached', eligibility: 'eligible', myClaim: null, claims: [] };
  await f.view(() => h(f.components.PacketDetail, { c: f.c, id: 'packet', initial, onClose() {} }));
  f.c.live.state.chainRevision = 1; await f.render();
  await act(async () => refreshes[1].reject(new Error('OFFLINE')));
  await settle(refreshes[0], { ...initial, blessing: 'stale' });
  assert.match(f.container.textContent, /cached/); assert.doesNotMatch(f.container.textContent, /stale/);
  assert.ok(f.button('common.retry'));
});

async function recoveryView(f) {
  f.c.live.state.wallet.preferences = { hideAmounts: false, smallPayments: false };
  f.c.live.state.wallet.recovery = { items: [{ order: quoted('original').order, canResume: true }], nextCursor: null };
  await f.view(() => h(f.components.WalletRecoveryList, { c: f.c }));
}

for (const departure of ['unmount', 'screen', 'opening', 'account']) test(`late recovery resume discards only its original quote after ${departure}`, async t => {
  const resume = deferred(), f = await fixture(t, name => name === 'wallet-recovery-resume' ? resume.promise : undefined);
  await recoveryView(f);
  await f.click(f.button('extension.wallet.recoveryReview'));
  if (departure === 'unmount') await f.view(undefined);
  if (departure === 'screen') { f.c.screen = 'wallet-records'; await f.render(); }
  if (departure === 'opening') await f.openTransfer();
  if (departure === 'account') await f.remount('other');
  await settle(resume, quoted('resumed'));
  assert.equal(f.container.textContent.includes('extension.wallet.confirmTransfer'), false);
  assert.deepEqual(f.calls.find(([name]) => name === 'wallet-dismiss'), ['wallet-dismiss', { accountId: 'self', paymentId: 'resumed' }]);
});

test('current recovery resume opens the original quote and releases list controls', async t => {
  const resume = deferred(), f = await fixture(t, name => name === 'wallet-recovery-resume' ? resume.promise : undefined);
  await recoveryView(f);
  await f.click(f.button('extension.wallet.recoveryReview'));
  const payment = quoted('original'); f.c.live.state.wallet.payment = payment;
  await settle(resume, payment); await f.render();
  assert.match(f.container.textContent, /extension.wallet.confirmTransfer/);
  const check = [...f.container.querySelectorAll('article button')].find(node => node.textContent === 'extension.wallet.checkStatus');
  assert.equal(check.disabled, false);
  assert.equal(f.calls.some(([name]) => name === 'wallet-dismiss'), false);
});

for (const outcome of ['resolve', 'reject']) test(`old recovery check ${outcome} cannot clear a new account operation`, async t => {
  const checks = [], f = await fixture(t, name => { if (name === 'wallet-recovery-check') { const work = deferred(); checks.push(work); return work.promise; } });
  await recoveryView(f);
  const check = () => [...f.container.querySelectorAll('article button')].find(node => node.textContent === 'extension.wallet.checkStatus');
  await f.click(check());
  f.c.live.state.account = { id: 'other' }; await f.render();
  await f.click(check());
  assert.equal(checks.length, 2);
  await act(async () => { if (outcome === 'reject') checks[0].reject(new Error('offline')); else checks[0].resolve(); });
  assert.equal(check().disabled, true);
  assert.equal(f.container.querySelector('[role="alert"]'), null);
  await settle(checks[1]);
  assert.equal(check().disabled, false);
});
