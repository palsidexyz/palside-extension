import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { productionModules } from './helpers/production-module.mjs';

const require = createRequire(import.meta.url), h = React.createElement;
const filename = 'apps/extension/src/features/palside/viewing/watch-strip.tsx';
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const passthrough = ({ children }) => children;
const icon = () => null;
async function fixture(t) {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root'));
  let now = 0, sequence = 0, mounted = true;
  const timers = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const load = productionModules();
  const social = load('apps/extension/src/features/palside/annotations/social-state.ts');
  const end = social.beginSocialSession({ accountId: 'account' });
  const close = () => {};
  const motion = Object.fromEntries(['div', 'span'].map(tag => [tag, props => h(tag, Object.fromEntries(Object.entries(props).filter(([key]) => !['layout', 'initial', 'animate', 'exit', 'transition'].includes(key))))]));
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => key => key },
    '@palside/ui/spinner': { Spinner: icon },
    '@palside/ui/tooltip': { Tooltip: passthrough },
    '@palside/ui/popover': { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: () => null, usePopoverContext: () => ({ anchorRef: React.useRef(null), layerRef: React.useRef(null), close }) },
    '@palside/i18n': { message: key => key, errorMessage: error => error.message },
    'motion/react': { motion, AnimatePresence: passthrough, useIsPresent: () => true, useReducedMotion: () => false },
    'lucide-react': { ArrowUpRight: icon, ChevronDown: icon, Copy: icon },
    '@palside/design/motion': { motionPresets: {} },
    '@palside/shared/navigation': {},
    '../ui/primitives': { PersonAvatar: icon, Token: icon },
    '../annotations/social-state': social,
    '../annotations/reminders': { PokeRow: icon },
    '../assets/chain-identity': {}, '../assets/site-logo': {}, '../settings/site-catalog': {},
    '../ui/motion-details': { Count: icon, CountText: icon },
    './watch-groups': load('apps/extension/src/features/palside/viewing/watch-groups.ts'),
    './watch-strip.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, URL, document, window, console, ...clock, require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } }, { filename });
  const view = { id: 'page', kind: 'website', disclosure: 'page', url: 'https://example.com/destination', name: 'Page', source: 'example.com', color: '#fff', glyph: 'P' };
  const opened = [], notices = [];
  let c = { toggles: { share: true }, disconnected: false, team: { memberIds: ['self', 'mate'] }, data: { self: 'self', views: [view] }, people: [{ id: 'self', viewing: view.id }], live: { page: { url: 'https://example.com/origin', host: 'example.com', windowId: 1 }, openPage: async (...args) => { opened.push(args); } }, setNotice: value => notices.push(value), setMemberFilter() {}, go() {} };
  let top;
  const render = async patch => { c = { ...c, ...patch }; await act(() => root.render(h(exports.WatchStrip, { c, top }))); };
  const advance = async ms => {
    const until = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at; timers.delete(id); await act(() => timer.fn());
    }
    now = until;
  };
  const unmount = async () => { if (mounted) { await act(() => root.unmount()); mounted = false; } };
  t.after(async () => { await unmount(); end(); for (const key of ['document', 'window', 'IS_REACT_ACT_ENVIRONMENT']) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]; } });
  await render();
  return { render, advance, unmount, timers, document, opened, notices, social,
    join: () => render({ people: [{ id: 'self', viewing: view.id }, { id: 'mate', viewing: view.id }] }),
    hide: async () => { top = { key: 'top', card: h('span', null, 'top'), waiting: [] }; await render(); },
    show: async () => { top = undefined; await render(); },
    mergeCount: () => document.querySelectorAll('.merge').length,
  };
}

test('merge expiry is stable across parent renders and preserves its 1800ms lifetime', async t => {
  const f = await fixture(t); await f.join(); assert.equal(f.mergeCount(), 1);
  for (let i = 0; i < 5; i++) { await f.advance(300); await f.render({ now: i }); }
  assert.equal(f.mergeCount(), 1);
  await f.advance(299); assert.equal(f.mergeCount(), 1);
  await f.advance(1); assert.equal(f.mergeCount(), 0);
});

test('hidden and vanished chips expire independently and do not replay an expired merge', async t => {
  const f = await fixture(t); await f.join();
  await f.hide(); assert.equal(f.mergeCount(), 0);
  await f.advance(1800); await f.show(); assert.equal(f.mergeCount(), 0);
  await f.render({ people: [{ id: 'self', viewing: 'page' }] }); await f.join();
  await f.advance(100); await f.render({ people: [] });
  await f.advance(1800); await f.join();
  assert.equal(f.mergeCount(), 1, 'only the newly observed join animates');
  await f.advance(1800); assert.equal(f.mergeCount(), 0);
});

test('strip unmount releases sorting, hold-space and merge timers', async t => {
  const f = await fixture(t); await f.join(); await f.render({ people: [] });
  assert.ok(f.timers.size > 0); await f.unmount(); assert.equal(f.timers.size, 0);
});

test('viewing chip uses one opening with an origin snapshot', async t => {
  const f = await fixture(t);
  await act(() => f.document.querySelector('.target').click());
  assert.deepEqual(f.opened, [['https://example.com/destination', true]]);
  assert.equal(f.social.captureSocialUi().snapshot().returnTo.origin.url, 'https://example.com/origin');
  assert.deepEqual(f.notices, []);
});
