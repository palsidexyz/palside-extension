import { MINUTE_MS } from '@palside/shared/units';
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
import { tokenNamed } from '../apps/extension/src/runtime/viewing/token-profiles.ts';

const require = createRequire(import.meta.url);
const h = React.createElement;
const runtime = productionModules();
const domain = runtime('apps/extension/src/domain/annotations/social.ts');
const { tabView } = runtime('apps/extension/src/features/palside/rooms/rooms.ts');
const rootPath = 'apps/extension/src/features/palside/';
const passthrough = ({ children }) => children;
const icon = () => null;
const button = props => h('button', { ...Object.fromEntries(Object.entries(props).filter(([key]) => !['label', 'size', 'variant'].includes(key))), 'aria-label': props.label });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const social = productionModules()(rootPath + 'annotations/social-state.ts');
  const feedback = productionModules()(rootPath + 'annotations/locate-feedback.ts');
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => key => key, useLocale: () => 'en' },
    '@palside/i18n': { message: key => key, errorMessage: error => error.message, chatTime: () => '', localeOrEnglish: x => x },
    'lucide-react': new Proxy({}, { get: () => icon }),
    '@palside/ui/tooltip': { Tooltip: passthrough },
    '@palside/ui/button': { Button: button, IconButton: button },
    '@palside/ui/sheet': { Sheet: ({ open, children }) => open ? h('section', null, children) : null },
    '@palside/ui/menu': { Menu: passthrough, MenuTrigger: passthrough, MenuContent: passthrough, MenuItem: button },
    '@palside/ui/popover': {},
    '../../../domain/assets/model': {},
    '../../../domain/account/model': { personFor: (_, id) => ({ id, name: id }) },
    '../../../domain/chat/model': { characterLength: text => [...text].length },
    '../../../domain/annotations/social': domain,
    '../../../runtime/annotations/signals': {},
    '../../../runtime/viewing/token-profiles': { tokenNamed },
    '../assets/token-data': { liveView: (_c, view) => view },
    '../annotations/social-state': social, './social-state': social, './locate-feedback': feedback,
    '../annotations/sticky-list': { shownStickyCount: () => 0 },
    '../ui/motion-details': { Count: () => null, CountText: () => null },
    '../ui/primitives': { PersonAvatar: icon, Token: icon, Action: button },
    '../ui/text': { useText: () => x => x },
    '../ui/icons': {}, '../settings/signal-settings': {},
    '../assets/asset-discussion': { relativeTime: () => '' },
    '../assets/site-logo': { SiteLogo: icon },
    '../settings/site-catalog': { siteForUrl: () => undefined, siteAt: () => undefined },
    '../settings/access': { withTargetAccess: (_, __, action) => action() },
    '../rooms/rooms': { tabView, roomKeyFor: () => undefined, roomsOn: () => false },
    '../chat/composer-social': { composerStyles: {}, RefLine: icon },
  };
  function load(file) {
    const source = readFileSync(rootPath + file, 'utf8');
    const code = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, URL, crypto, console, setTimeout, clearTimeout, require(name) {
      if (name.endsWith('.css')) return { default: {} };
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    } }, { filename: file });
    return exports;
  }
  return { social, load, modules };
}
const page = (url, extra = {}) => ({ url, host: new URL(url).hostname, title: 'Unshared origin', windowId: 1, interactive: true, ...extra });
const a = 'https://example.com/a', b = 'https://example.com/b';
const snapshot = social => social.captureSocialUi().snapshot();

async function dom(t) {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  const unmount = async () => { if (mounted) { await act(() => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    for (const key of ['document', 'window', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
    }
  });
  return { document, render: element => act(() => root.render(element)), unmount,
    click: label => act(() => { const target = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label); assert.ok(target, label); target.click(); }) };
}

test('session replacement clears every transient field and rejects earlier owner callbacks', () => {
  const { social } = fixture();
  const endA = social.beginSocialSession({ accountId: 'a' });
  const old = social.captureSocialUi();
  let calls = 0;
  social.setSocialUi({ follow: { teamId: 'team', personId: 'mate' }, stickies: { url: a }, site: { accountId: 'a', then: () => calls++ }, grant: 'interact', allSites: true, read: 'share', settingsTab: 'sticky', people: 'token', roomPerson: 'person', roomPersonMessage: 'message', roomLine: 'line', invite: 'invite' });
  const callback = snapshot(social).site.then;
  const endB = social.beginSocialSession({ accountId: 'b' });
  old.set({ invite: 'stale' }); callback(); endA();
  assert.deepEqual(Object.keys(snapshot(social)), []);
  assert.equal(old.current(), false); assert.equal(calls, 0);
  social.setSocialUi({ site: { accountId: 'a', then: () => calls++ } });
  assert.equal(snapshot(social).site, undefined);
  endB(); social.setSocialUi({ invite: 'late' });
  assert.equal(snapshot(social), undefined);
  social.beginSocialSession({ accountId: 'a' }); old.set({ invite: 'same-account-old-session' });
  assert.equal(snapshot(social).invite, undefined);
});

test('React session boundary starts before its consumers and releases on account replacement and unmount', async t => {
  const { social } = fixture(), d = await dom(t);
  let seen;
  function Consumer() { seen = social.useSocialUi(); return h('span', null, seen.invite ?? 'empty'); }
  const render = account => d.render(h(social.SocialSession, { key: account, accountId: account }, h(Consumer)));
  await render('a'); await act(() => social.setSocialUi({ invite: 'old' }));
  assert.equal(d.document.querySelector('span').textContent, 'old');
  const old = social.captureSocialUi();
  await render('b'); assert.equal(d.document.querySelector('span').textContent, 'empty');
  await act(() => old.set({ invite: 'late' })); assert.equal(seen.invite, undefined);
  await d.unmount(); assert.equal(snapshot(social), undefined);
});

test('current page borrows asset metadata without borrowing the URL or source', () => {
  const f = fixture(), { currentPage } = f.load('viewing/current-page.ts');
  const address = '0x' + 'a'.repeat(40), asset = 'Ethereum:' + address;
  const url = `https://gmgn.ai/eth/token/${address}`;
  const other = { ...tabView(page(url)), id: 'other', url: `https://dexscreener.com/ethereum/${address}`, name: 'Known token', logo: 'logo', source: 'Different site' };
  const exact = { ...other, id: 'exact', url };
  const controller = { live: { page: page(url, { asset }), state: {} }, data: { self: 'self', views: [other, exact] } };
  const current = currentPage(controller);
  assert.equal(current.url, url); assert.notEqual(current.source, other.source); assert.equal(current.name, 'Known token');
});

test('message references invoke only the background locate command and keep shared feedback', async t => {
  const f = fixture(), d = await dom(t); f.social.beginSocialSession({ accountId: 'account' });
  const { MessageRef } = f.load('annotations/message-ref.tsx');
  const calls = [], notices = [], pending = deferred();
  const controller = { current: 'team', ownsScreen: () => true, setNotice: value => notices.push(value), live: { page: page(a), openPage: assert.fail, command: (...args) => { calls.push(args); return pending.promise; } } };
  await d.render(h(MessageRef, { c: controller, message: { id: 'message', ref: { caption: 'quote', view: { url: b }, target: { kind: 'quote', exact: 'quote' } } } }));
  await d.click('extension.composer.findRef');
  assert.deepEqual(calls.map(call => call[0]), ['locate-ref']);
  await act(() => pending.resolve({ result: 'missing' }));
  assert.deepEqual(notices, ['extension.composer.refMissing']);
});

for (const change of ['new-sheet', 'screen', 'account', 'unmount', 'none']) test(`note quote completion respects ${change}`, async t => {
  const f = fixture(), d = await dom(t); f.social.beginSocialSession({ accountId: 'account' });
  const { NoteSheet } = f.load('annotations/sticky-list.tsx');
  const pending = deferred(), navigations = [];
  let owns = true;
  const sticky = { id: 'note', teamId: 'team', author: 'mate', timestamp: 1, expiresAt: Date.now() + MINUTE_MS, url: a, text: 'note', target: { kind: 'quote', exact: 'quote' } };
  const controller = { now: Date.now(), current: 'team', screen: 'chat', ownsScreen: () => owns, data: { self: 'account', views: [] }, people: [], sites: [], canWrite: true, go: value => navigations.push(value), live: { page: page(a), state: { items: { stickies: [sticky] }, preferences: {} }, command: () => pending.promise } };
  f.social.setSocialUi({ stickies: { url: a } });
  await d.render(h(NoteSheet, { c: controller }));
  await d.click('extension.sticky.quote');
  if (change === 'new-sheet') await act(() => f.social.setSocialUi({ stickies: { url: a, focus: 'note' } }));
  if (change === 'screen') owns = false;
  if (change === 'account') await act(() => f.social.beginSocialSession({ accountId: 'other' }));
  if (change === 'unmount') await d.unmount();
  const before = snapshot(f.social).stickies;
  await act(() => pending.resolve());
  assert.deepEqual(navigations, change === 'none' ? ['chat'] : []);
  assert.equal(snapshot(f.social).stickies, change === 'none' ? undefined : before);
});


test('app link interception respects an entry that already handled the click', async () => {
  const file = rootPath + 'app/palside-app.tsx';
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick' && node.initializer?.expression?.getText(source).includes("const link =")) handler = node.initializer.expression;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(handler);
  const calls = [];
  class Element { constructor(link) { this.link = link; } closest() { return this.link; } }
  const c = { live: { openPage: async url => calls.push(url) }, setNotice: assert.fail, setConfirmation: assert.fail };
  const code = ts.transpileModule(`(${handler.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const click = vm.runInNewContext(code, { Element, c, siteForUrl: () => true, captureSocialUi: () => ({ current: () => true }) });
  const event = { target: new Element({ href: b, hasAttribute: () => true }), defaultPrevented: true, preventDefault() { this.defaultPrevented = true; } };
  click(event); await Promise.resolve(); assert.deepEqual(calls, []);
  event.defaultPrevented = false; click(event); await Promise.resolve(); assert.deepEqual(calls, [b]);
});
