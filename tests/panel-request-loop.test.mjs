import { rolldown } from 'rolldown';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as React from 'react';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { productionModules } from './helpers/production-module.mjs';
const require = createRequire(import.meta.url);
const bundle = await rolldown({
  input: 'fixture', platform: 'browser', external: ['react'],
  plugins: [{
    name: 'panel-fixture',
    resolveId(source, importer) {
      if (source === 'fixture') return source;
      if (importer?.endsWith('/core.ts') && ['../account/session-lifecycle', '../media/cache', '../viewing/sharing', '../chat/timeline', '../chat/sending', '../annotations/interactions', './dispatch', '../annotations/signal-service', '../storage/storage', './config'].includes(source)) return 'fixture:services.js';
      if (importer?.endsWith('/hot.tsx') && !['react', 'react/jsx-runtime', './rooms'].includes(source)) return `fixture:${source}.js`;
    },
    load(id) {
      if (id === 'fixture') return `export { Hot } from './apps/extension/src/features/palside/rooms/hot.tsx'; export { usePanelNavigation } from './apps/extension/src/features/palside/app/use-panel-navigation.ts'; export { RoomService } from './apps/extension/src/runtime/rooms/rooms.ts'; export { Api } from './apps/extension/src/runtime/transport/api.ts'; export { applyPatch } from './apps/extension/src/runtime/transport/state-patch.ts'; export { createPatchSliceCache, diffState } from './apps/extension/src/runtime/transport/state-diff.ts'; export { PalsideService } from './apps/extension/src/runtime/composition/core.ts';`;
      if (id === 'fixture:services.js') return 'export const API_URL = "https://service.test"; export class SessionRuntime {} export class LocalDataRuntime {} export class SharingRuntime {} export class TimelineRuntime {} export class SendingRuntime {} export class TeamInteractions {} export class RuntimeCommands {} export class SignalService {} export class ClientStorage {}';
      if (id === 'fixture:use-intl.js') return 'export const useTranslations = () => key => key;';
      if (id.startsWith('fixture:')) return 'export default {}; export const InlineFeedback = ({children}) => children, Tooltip = ({children}) => children, Count = null, CountText = null, Token = null, Faces = null, StanceMini = null, stanceShares = null, openRoom = null, roomView = null, tabRoomKey = null;';
    },
  }],
});
const production = (await bundle.generate({ format: 'iife', name: 'Production', globals: { react: 'React' } })).output[0].code;
await bundle.close();
for (const panels of [1, 2]) for (const remount of [false, true]) test(`React Hot with ${panels} panel(s): ten unrelated patch pushes make one HTTP request${remount ? " after remount" : ""}`, async t => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  const roots = [], errors = [], intervals = new Map();
  let intervalId = 0, calls = 0;
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  t.mock.method(Date, 'now', () => 100000);
  t.after(async () => {
    try { await act(() => { for (const root of roots) root.unmount(); }); }
    finally {
      for (const key of ['document', 'window', 'IS_REACT_ACT_ENVIRONMENT']) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
      }
    }
  });
  const { Api, RoomService, PalsideService, Hot, createPatchSliceCache, diffState, applyPatch } = new Function('React', 'require', 'setInterval', 'clearInterval', 'fetch', `${production}; return Production;`)(
    React, require,
    fn => { intervals.set(++intervalId, fn); return intervalId; },
    id => intervals.delete(id),
    async () => { calls++; return new Response(JSON.stringify({ top: [], rising: [], at: Date.now() })); },
  );
  const runtime = new PalsideService();
  runtime.state.data.self = 'one'; runtime.state.account = { id: 'one' };
  runtime.state.connection.networkOnline = true;
  runtime.auth = { session: { account: { id: 'one' }, token: 'token' }, scope() { const session = this.session; return { current: () => session === this.session }; } };
  runtime.emissionCache = createPatchSliceCache(); runtime.sharing = { mayObserve: () => false }; runtime.countUnread = () => {}; runtime.listeners = new Set();
  runtime.api = new Api('https://service.test');
  runtime.rooms = new RoomService(runtime);
  const commands = Array.from({ length: panels }, (_, panel) => async (_name, payload) => runtime.rooms.watchHot({ ...payload, sourceId: String(panel) }));
  const cache = createPatchSliceCache(), setters = [];
  let sent, received;
  function Panel({ panel }) {
    const [state, setState] = useState(received);
    useEffect(() => { setters.push(setState); return () => setters.splice(setters.indexOf(setState), 1); }, []);
    return React.createElement(Hot, { c: { data: state.data, live: { state, command: commands[panel] } } });
  }
  function push(state) {
    const patch = JSON.parse(JSON.stringify(diffState(sent, state, cache))); sent = state;
    if (patch.base !== undefined && received.revision !== patch.base) throw Error('patch revision gap');
    received = applyPatch(received, patch); for (const set of setters) set(received);
  }
  push(runtime.state); runtime.listeners.add(push);
  for (let i = 0; i < panels; i++) { const node = document.createElement('div'); document.body.append(node); roots.push(createRoot(node)); }
  await act(() => { roots.forEach((root, panel) => root.render(React.createElement(Panel, { panel }))); });
  for (let i = 0; i < 10; i++) await act(() => { runtime.state.notice = { key: 'test', values: { i } }; runtime.emit(); });
  assert.equal(calls, 1);
  const revision = runtime.state.revision;
  await act(() => runtime.rooms.hot());
  assert.equal(calls, 2); assert.equal(runtime.state.revision, revision);
  await act(() => { for (const refresh of intervals.values()) refresh(); });
  assert.equal(calls, 3);
  if (remount) await act(() => { for (const root of roots) root.render(null); });
  runtime.rooms.reset();
  runtime.auth.session = { account: { id: 'two' }, token: 'two' };
  await act(() => {
    runtime.state.account = { id: 'two' }; runtime.state.data.self = 'two'; runtime.emit();
    if (remount) roots.forEach((root, panel) => root.render(React.createElement(Panel, { panel })));
  });
  assert.equal(calls, 4);
  await act(() => document.querySelectorAll('button')[1].click());
  assert.equal(calls, 5);
  await act(() => { for (const root of roots) root.unmount(); });
  roots.length = 0;
  assert.deepEqual(errors, []);
  assert.equal(intervals.size, 0);
});

for (const change of ['none', 'navigation', 'account', 'team', 'unmount']) test(`queued panel focus respects ${change}`, async t => {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { document, window, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const frames = new Map(); let frameId = 0, focused = 0, actions;
  const { usePanelNavigation } = new Function('React', 'require', 'requestAnimationFrame', 'cancelAnimationFrame', `${production}; return Production;`)(React, require,
    callback => { frames.set(++frameId, callback); return frameId; }, id => frames.delete(id));
  const state = {
    view: { screen: 'settings', data: { self: 'one' }, current: 'team', ownsScreen: () => true, setSelectingOwner() {}, setNotice() {} },
    returnFocus: { current: { checkVisibility: () => true, focus: () => { focused++; } } }, origins: { current: {} },
    setScreen: screen => { state.view.screen = screen; },
  };
  function Panel() { actions = usePanelNavigation(state, () => ({})); return null; }
  const root = createRoot(document.getElementById('root')); let mounted = true;
  t.after(async () => {
    try { if (mounted) await act(() => root.unmount()); }
    finally {
      for (const key of ['document', 'window', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key];
      }
    }
  });
  await act(() => root.render(React.createElement(Panel)));
  await act(() => { actions.go('chat'); root.render(React.createElement(Panel)); });
  assert.equal(frames.size, 1);
  if (change === 'navigation') actions.go('settings');
  if (change === 'account') state.view.data.self = 'two';
  if (change === 'team') state.view.current = 'other';
  if (change === 'unmount') { await act(() => root.unmount()); mounted = false; }
  else if (change !== 'none') await act(() => root.render(React.createElement(Panel)));
  for (const callback of frames.values()) callback();
  assert.equal(focused, change === 'none' ? 1 : 0);
});

for (const command of ['locateRef', 'locateSticky']) test(`${command} retains arrival when page tools fail after opening`, async () => {
  const load = productionModules({ accessStatus: async () => ({ site: true }), visibleStickies: items => items.stickies });
  const { stickies } = load('apps/extension/src/background/stickies.ts');
  const social = load('apps/extension/src/features/palside/annotations/social-state.ts');
  const origin = 'https://example.test/a', destination = 'https://example.test/b';
  const target = { kind: 'quote', exact: 'quote', prefix: '', suffix: '' };
  let active = { id: 1, url: origin, status: 'complete' }, opens = 0;
  const bg = {
    browser: {}, sessionVersion: 1, policyVersion: 1, teamAvailable: () => true,
    state: {
      authenticated: true, account: { id: 'self' }, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }],
      items: { stickies: [{ id: 'sticky', teamId: 'team', url: destination, target }] },
      data: { messages: [{ id: 'message', teamId: 'team', ref: { view: { kind: 'website', url: destination }, target } }] },
    },
    panelTab: async () => ({ tab: active }), activeTab: async () => active,
    openPage: async url => { opens++; active = { ...active, url }; },
    pages: { openPageTools: async () => { throw Error('page tools unavailable'); } },
  };
  const end = social.beginSocialSession({ accountId: 'self' });
  try {
    const outcome = await social.navigateWithReturn({ page: { url: origin } }, destination, async () => {
      const reply = await stickies(bg)[command]({ windowId: 1, teamId: 'team', messageId: 'message', stickyId: 'sticky' }, 'chrome-extension://panel');
      assert.equal(reply.value.opened, true);
      return reply.value;
    });
    assert.equal(opens, 1); assert.equal(outcome, 'unavailable');
    assert.equal(social.captureSocialUi().snapshot().returnTo.arrived, true);
    assert.equal(social.captureSocialUi().snapshot().returnTo.origin.url, origin);
  } finally { end(); }
});

test('locate metadata cannot mark a superseding navigation as arrived', async () => {
  const social = productionModules()('apps/extension/src/features/palside/annotations/social-state.ts');
  const end = social.beginSocialSession({ accountId: 'self' });
  let resolve;
  try {
    const opening = social.navigateWithReturn({ page: { url: 'https://example.test/a' } }, 'https://example.test/b', () => new Promise(done => { resolve = done; }));
    await social.navigateWithReturn({ page: { url: 'https://example.test/a' } }, 'https://example.test/c', async () => {});
    resolve({ result: 'unavailable', opened: true }); await opening;
    assert.equal(social.captureSocialUi().snapshot().returnTo.target, 'https://example.test/c');
    assert.equal(social.captureSocialUi().snapshot().returnTo.arrived, false);
  } finally { end(); }
});
