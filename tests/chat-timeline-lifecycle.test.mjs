import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { productionModules } from './helpers/production-module.mjs';

const base = 'apps/extension/src/features/palside/chat/';
const plain = value => JSON.parse(JSON.stringify(value));
function declarations(file, names) {
  const source = ts.createSourceFile(file, readFileSync(`${base}${file}`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.filter(node => names.includes(node.name?.text) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(source)))))
    .map(node => node.getText(source).replace(/^export /, '')).join('\n');
}
function execute(source, name, context) {
  return vm.runInNewContext(ts.transpileModule(`${source}\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment' } }).outputText, context);
}
function clock() {
  let now = 0, serial = 0;
  const jobs = new Map();
  return {
    performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++serial; jobs.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].fn();
      }
      now = end;
    },
    get size() { return jobs.size; },
  };
}
const message = (id, timestamp, patch = {}) => ({ id, timestamp, teamId: 'team', author: 'friend', text: 'text', time: '', status: 'sent', ...patch });
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(item => item != null && item !== false) });
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}
function chat(messages, payments = [], overrides = {}) {
  const timers = clock();
  const { SendFlights } = productionModules(timers)(`${base}send-flight.ts`);
  const flights = new SendFlights();
  const input = { closest: () => ({}), checkVisibility: () => false };
  let refs = 0;
  const context = {
    h, Fragment: 'Fragment', useTranslations: () => key => key, useLocale: () => 'en', useReducedMotion: () => false,
    useTeamPayments: () => payments, useRef: value => ({ current: ++refs === 4 ? input : value }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: fn => fn(), useCallback: fn => fn, useLayoutEffect() {}, useEffect() {},
    useChatTimeline: () => ({ sendIntent: () => () => false }), unreadMentions: () => [],
    useTopCard: () => undefined, useAway: () => ({}), showsNewTeam: () => false, NewTeam: 'NewTeam', SendFlights: function () { return flights; },
    captureComposer: () => ({}),
    s: new Proxy({}, { get: (_, key) => key }), navigation: {},
    ...Object.fromEntries(['MessageItem', 'TeamPaymentCard', 'SendFlightContext', 'ReactionStage', 'ChatHeader', 'WatchStrip', 'MoreTeamPayments', 'AnimatePresence', 'FloatingDate', 'Composer', 'ReadonlyDraft'].map(name => [name, name])),
    ...overrides,
  };
  const Chat = execute(declarations('chat.tsx', ['groupWindow', 'continues', 'dayKey', 'dayLabel', 'Chat']), 'Chat', context);
  const c = { currentMessages: messages, data: { self: 'self' }, current: 'team', screen: 'chat', canWrite: true, ...overrides.c };
  const tree = Chat({ c, clearJump() {} });
  return { tree, flights, send: nodes(tree, n => n.type === 'Composer')[0].props.onSend };
}

test('merged entries own date boundaries, row keys, and adjacency including recall notices', () => {
  const day1 = new Date(2026, 9, 28, 23, 59).getTime(), day2 = new Date(2026, 9, 29, 0, 1).getTime();
  const { tree } = chat([
    message('previous', day1), message('same-id', day2 + 1000),
    message('notice', day2 + 2000, { recalled: true, author: 'other' }),
    message('next', day2 + 3000), message('after-payment', day2 + 5000),
  ], [{ id: 'same-id', timestamp: day2 }, { id: 'second', timestamp: day2 + 4000 }]);
  const days = nodes(tree, n => n.props.className === 'day');
  assert.equal(days.length, 2);
  assert.equal(new Set(days.map(n => n.props.key)).size, 2);
  const rows = nodes(tree, n => ['MessageItem', 'TeamPaymentCard'].includes(n.type));
  assert.deepEqual(rows.map(n => n.props.message?.id ?? n.props.item.id), ['previous', 'same-id', 'same-id', 'notice', 'next', 'second', 'after-payment']);
  assert.equal(new Set(rows.map(n => n.props.key)).size, rows.length);
  assert.deepEqual(rows.filter(n => n.type === 'MessageItem').map(n => n.props.grouped), [false, false, false, true, false]);
  const dissolving = chat([message('first', day2), message('recall', day2 + 1, { recalled: true, author: 'other' }), message('last', day2 + 2)], [], {
    useState: initial => [typeof initial === 'function' ? (initial().constructor.name === 'Set' ? new Set(['recall']) : initial()) : initial, () => {}],
  });
  assert.equal(nodes(dissolving.tree, n => n.props.message?.id === 'last')[0].props.grouped, false);
});

test('send completion removes only its abandoned flight on false results and rejection', async () => {
  for (const result of [false, true, new Error('send failed')]) {
    let finish;
    const pending = new Promise((resolve, reject) => { finish = () => result instanceof Error ? reject(result) : resolve(result); });
    const view = chat([], [], { c: { send: prepare => { prepare(message('armed', 1)); return pending; } } });
    view.flights.arm('other', {}, () => false);
    const sending = view.send();
    assert.ok(view.flights.peek('armed'));
    finish();
    if (result instanceof Error) await assert.rejects(sending, /send failed/); else await sending;
    assert.equal(Boolean(view.flights.peek('armed')), result === true);
    assert.ok(view.flights.peek('other'));
  }
});

test('send flights prune expired IDs on insertion and cleanup while preserving fresh remounts', () => {
  const timers = clock();
  const { SendFlights } = productionModules(timers)(`${base}send-flight.ts`);
  const flights = new SendFlights();
  flights.arm('expired', {}, () => true);
  timers.tick(4001);
  flights.arm('fresh', {}, () => true);
  assert.deepEqual([...flights.armed.keys()], ['fresh']);
  const entry = flights.peek('fresh'), list = { scrollTop: 20 };
  assert.equal(flights.follow(entry, list), 0);
  list.scrollTop = 40;
  assert.equal(flights.follow(entry, list), 0);
  timers.tick(4001); flights.finishAll();
  assert.equal(flights.armed.size, 0);
  flights.arm('remount', {}, () => true); flights.finishAll();
  assert.ok(flights.peek('remount'));
  flights.done('remount');
  assert.equal(flights.armed.size, 0);
});

function timelineHost(initialModal = false) {
  const { document, window } = parseHTML('<html><body><div id="list"><div id="content"></div></div></body></html>');
  // Linkedom supplies DOM mutations; the native top layer and layout are host boundaries.
  const query = document.querySelector.bind(document), topLayer = new Set();
  document.querySelector = selector => selector === 'dialog:modal' ? [...topLayer].find(node => node.isConnected && node.hasAttribute('open')) ?? null : query(selector);
  document.hasFocus = () => true;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
  const root = query('#list'), content = query('#content');
  Object.assign(root, { clientHeight: 300, scrollHeight: 300, scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 300, left: 0, right: 300 }) });
  content.offsetTop = 0;
  const timers = clock();
  const load = productionModules({ ...timers, document, window, MutationObserver: window.MutationObserver,
    ResizeObserver: class { observe() {} disconnect() {} }, sessionStorage: { getItem: () => null, setItem() {} }, innerHeight: 600, innerWidth: 400 });
  const { ChatTimeline } = load(`${base}chat-timeline.ts`);
  const timeline = new ChatTimeline('test', 'self'), reports = [];
  const initial = initialModal ? dialog() : undefined;
  initial?.showModal();
  const disconnect = timeline.connect(root, content);
  timeline.setReporter(async ids => { reports.push(plain(ids)); });
  const render = messages => {
    content.replaceChildren(...messages.map((message, index) => {
      const row = document.createElement('article'); row.dataset.messageId = message.id;
      Object.assign(row, { offsetTop: index * 50, offsetHeight: 50, getBoundingClientRect: () => ({ top: index * 50, bottom: index * 50 + 50, left: 0, right: 300 }) });
      return row;
    }));
    timeline.update(messages, true);
  };
  function dialog() {
    const node = document.createElement('dialog'); document.body.append(node);
    node.showModal = () => { topLayer.add(node); node.setAttribute('open', ''); };
    node.close = () => { topLayer.delete(node); node.removeAttribute('open'); };
    return node;
  }
  return { timers, timeline, reports, render, dialog, disconnect, window, initial };
}
const mutations = async () => { await Promise.resolve(); await Promise.resolve(); };

test('DOM modal open clears pending visibility, nested dialogs suspend arrivals, and close remeasures', async () => {
  const host = timelineHost();
  const { timers, timeline, reports, render, dialog, disconnect } = host;
  render([message('first', 1)]);
  timers.tick(300);
  assert.deepEqual(reports.at(-1), ['first']);
  render([message('first', 1), message('second', 2, { liveArrival: true })]);
  timers.tick(200);
  const workspace = dialog(); workspace.showModal(); await mutations();
  assert.deepEqual(reports.at(-1), []);
  assert.equal(timers.size, 0);
  const nested = dialog(); nested.showModal(); await mutations();
  render([message('first', 1), message('second', 2), message('covered', 3, { liveArrival: true })]);
  timers.tick(1000);
  assert.equal(timeline.getSnapshot().newCount, 1);
  assert.deepEqual(reports.at(-1), []);
  workspace.close(); await mutations(); timers.tick(1000);
  assert.equal(timers.size, 0);
  assert.equal(timeline.getSnapshot().newCount, 1);
  nested.close(); await mutations();
  timers.tick(299); assert.deepEqual(reports.at(-1), []);
  timers.tick(1); assert.deepEqual(reports.at(-1), ['first', 'second', 'covered']);
  assert.equal(timeline.getSnapshot().newCount, 0);
  workspace.showModal(); await mutations(); workspace.remove(); await mutations();
  timers.tick(300); assert.deepEqual(reports.at(-1), ['first', 'second', 'covered']);
  disconnect();
  workspace.showModal(); await mutations();
  assert.equal(timers.size, 0);
  assert.deepEqual(reports.at(-1), []);
});

test('a modal already open at connect prevents first reports and hidden chats do not resume', async () => {
  const host = timelineHost(true), modal = host.initial;
  host.render([message('first', 1)]);
  host.timers.tick(300);
  assert.deepEqual(host.reports.at(-1), []);
  host.timeline.update([message('first', 1)], false);
  modal.close(); await mutations(); host.timers.tick(300);
  assert.deepEqual(host.reports.at(-1), []);
  host.disconnect();
});

test('React long-text measurement follows content and revision without a resize of the folded box', async () => {
  const { document, window } = parseHTML('<html><body><div id="app"></div></body></html>');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = window; globalThis.document = document;
  let measured = 0, extraLines = 0, observerCount = 0;
  const hook = execute(declarations('message-item.tsx', ['FOLD_LINES', 'runsLong', 'useLongText']), 'useLongText', {
    useState: React.useState, useLayoutEffect: React.useLayoutEffect,
    getComputedStyle: () => ({ lineHeight: '22px' }),
    ResizeObserver: class { constructor() { observerCount++; } observe() {} disconnect() { observerCount--; } },
  });
  function Probe({ text, revision = 0, width = 300, enabled = true }) {
    const ref = React.useRef(null);
    const long = hook(ref, enabled, text, revision);
    return React.createElement('p', { 'data-long': String(long), ref: node => {
      if (!node) return;
      ref.current = node;
      Object.defineProperties(node, {
        clientWidth: { configurable: true, get: () => width },
        clientHeight: { configurable: true, get: () => 5 * 22 },
        scrollHeight: { configurable: true, get: () => { measured++; return (node.textContent.split('\n').length + extraLines) * 22; } },
      });
    } }, text);
  }
  const root = createRoot(document.getElementById('app'));
  const render = props => flushSync(() => root.render(React.createElement(Probe, props)));
  const isLong = () => document.querySelector('p').dataset.long;
  try {
    render({ text: 'line\n'.repeat(7) + 'line' }); assert.equal(isLong(), 'true');
    render({ text: 'line\n'.repeat(5) + 'line' }); assert.equal(isLong(), 'false');
    const before = measured;
    extraLines = 2;
    render({ text: 'line\n'.repeat(5) + 'line', revision: 1 });
    assert.ok(measured > before); assert.equal(isLong(), 'true');
    render({ text: 'short', revision: 2, width: 0 }); assert.equal(isLong(), 'true');
    render({ text: 'short', revision: 3 }); assert.equal(isLong(), 'false');
    extraLines = 0;
    render({ text: 'line\n'.repeat(6) + 'line' }); assert.equal(isLong(), 'false');
    render({ text: 'line\n'.repeat(7) + 'line' }); assert.equal(isLong(), 'true');
    render({ text: '', enabled: false }); assert.equal(isLong(), 'false');
  } finally {
    flushSync(() => root.unmount());
    // React's scheduler yields every few milliseconds on a busy machine and continues on later immediates.
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    globalThis.window = oldWindow; globalThis.document = oldDocument;
  }
  assert.equal(observerCount, 0);
});
