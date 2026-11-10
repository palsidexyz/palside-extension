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
      if (importer?.endsWith('/hot.tsx') && !['react', 'react/jsx-runtime', './rooms', '../../../runtime/rooms/token-sites', '@palside/design/motion'].includes(source)) return `fixture:${source}.js`;
    },
    load(id) {
      if (id === 'fixture') return `export { Hot } from './apps/extension/src/features/palside/rooms/hot.tsx'; export { usePanelNavigation } from './apps/extension/src/features/palside/app/use-panel-navigation.ts'; export { RoomService } from './apps/extension/src/runtime/rooms/rooms.ts'; export { Api } from './apps/extension/src/runtime/transport/api.ts'; export { applyPatch } from './apps/extension/src/runtime/transport/state-patch.ts'; export { createPatchSliceCache, diffState } from './apps/extension/src/runtime/transport/state-diff.ts'; export { PalsideService } from './apps/extension/src/runtime/composition/core.ts';`;
      if (id === 'fixture:services.js') return 'export const API_URL = "https://service.test"; export class SessionRuntime {} export class LocalDataRuntime {} export class SharingRuntime {} export class TimelineRuntime {} export class SendingRuntime {} export class TeamInteractions {} export class RuntimeCommands {} export class SignalService {} export class ClientStorage {}';
      if (id === 'fixture:use-intl.js') return 'export const useTranslations = () => key => key;';
      if (id === 'fixture:motion/react.js') return 'export const AnimatePresence = ({children}) => children, motion = { div: "div" }, useReducedMotion = () => true;';
      if (id.startsWith('fixture:')) return 'export default {}; export const Check = null, ChevronDown = null, Flame = null, Layers = () => null, Menu = null, MenuContent = null, MenuItem = null, MenuTrigger = null, EmptyState = () => null, InlineFeedback = ({children}) => children, Tooltip = ({children}) => children, Count = null, CountText = null, Token = null, TokenName = ({view}) => view.name, tokenStats = () => undefined, ChainLogo = () => null, Faces = null, HotSearchField = () => null, HotSearchResults = () => null, openRoom = null, roomView = null, tabRoomKey = null;';
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
  let intervalId = 0; const calls = [];
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
    async (url, options) => { const body = JSON.parse(new TextDecoder().decode(options.body)); calls.push({ path: new URL(url).pathname, open: body.open }); return new Response(JSON.stringify({ subscribed: body.open })); },
  );
  const runtime = new PalsideService();
  runtime.state.data.self = 'one'; runtime.state.account = { id: 'one' };
  runtime.state.connection.networkOnline = true;
  runtime.auth = { session: { account: { id: 'one' }, token: 'token' }, scope() { const session = this.session; return { current: () => session === this.session, check: () => assert.equal(session, this.session) }; } };
  runtime.emissionCache = createPatchSliceCache(); runtime.sharing = { mayObserve: () => false }; runtime.countUnread = () => {}; runtime.listeners = new Set();
  runtime.api = new Api('https://service.test');
  runtime.rooms = new RoomService(runtime);
  const commands = Array.from({ length: panels }, (_, panel) => async (_name, payload) => runtime.rooms.watchHot({ ...payload, sourceId: String(panel) }));
  const cache = createPatchSliceCache(), setters = [];
  let sent, received;
  function Panel({ panel, chain = null }) {
    const [state, setState] = useState(received);
    useEffect(() => { setters.push(setState); return () => setters.splice(setters.indexOf(setState), 1); }, []);
    return React.createElement(Hot, { chain, c: { data: state.data, live: { state, command: commands[panel] } } });
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
  assert.deepEqual(calls, [{ path: '/rooms/hot/subscription', open: true }]);
  assert.deepEqual(runtime.state.rooms.hot, { rows: [], loaded: false });
  await act(() => runtime.rooms.consume({ type: 'hot', rooms: { rows: [] } }));
  assert.deepEqual(runtime.state.rooms.hot, { rows: [], loaded: true });
  const revision = runtime.state.revision;
  await act(() => runtime.rooms.consume({ type: 'hot', rooms: { rows: [] } }));
  assert.equal(runtime.state.revision, revision);
  assert.equal(calls.length, 1); assert.equal(intervals.size, 0);
  if (remount) await act(() => { for (const root of roots) root.render(null); });
  calls.length = 0;
  await act(async () => { runtime.rooms.reset(); });
  if (!remount) assert.deepEqual(calls, [{ path: '/rooms/hot/subscription', open: false }]);
  calls.length = 0;
  runtime.auth.session = { account: { id: 'two' }, token: 'two' };
  await act(() => {
    runtime.state.account = { id: 'two' }; runtime.state.data.self = 'two'; runtime.emit();
    if (remount) roots.forEach((root, panel) => root.render(React.createElement(Panel, { panel })));
  });
  assert.deepEqual(calls, [{ path: '/rooms/hot/subscription', open: true }]);
  await act(() => roots[0].render(React.createElement(Panel, { panel: 0, chain: 'Solana' })));
  assert.equal(calls.length, 1); // Chain filtering is local to each panel.
  await act(() => { for (const root of roots) root.unmount(); });
  roots.length = 0;
  assert.deepEqual(calls, [{ path: '/rooms/hot/subscription', open: true }, { path: '/rooms/hot/subscription', open: false }]);
  assert.equal(runtime.state.rooms.hot, undefined);
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

test('a signal replay reports that it opened the page when page tools fail after opening', async () => {
  const load = productionModules({ accessStatus: async () => ({ site: true }) });
  const { refs } = load('apps/extension/src/background/refs.ts');
  const { locator } = load('apps/extension/src/background/locate.ts');
  const { MessageError, message } = await import('@palside/i18n');
  const origin = 'https://example.test/a', destination = 'https://example.test/b';
  let active = { id: 1, url: origin, status: 'complete' }, opens = 0;
  const bg = {
    browser: {}, sessionVersion: 1, policyVersion: 1, teamAvailable: () => true, pagePerson: async () => ({ name: 'Mia' }),
    state: {
      authenticated: true, account: { id: 'self' }, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], data: { messages: [] },
      signalRecords: [{ id: '$record', teamId: 'team', personId: 'mia', url: destination, kind: 'danger', target: { kind: 'page' }, timestamp: 1, expiresAt: 2 }],
    },
    panelTab: async () => ({ tab: active }), activeTab: async () => active,
    openPage: async url => { opens++; active = { ...active, url }; },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    pages: { openPageTools: async () => { throw new MessageError(message('extension.runtime.pageActionFailed')); } },
  };
  bg.locator = locator(bg);
  const reply = await refs(bg).replaySignal({ windowId: 1, teamId: 'team', recordId: '$record' }, 'chrome-extension://panel');
  assert.equal(reply.value.opened, true);
  assert.equal(opens, 1); assert.equal(reply.value.result, 'blocked');
});

/** A panel whose locate flow can be interrupted while the page it opened is loading. */
function locating() {
  const load = productionModules({ accessStatus: async () => ({ site: true }) });
  const { refs } = load('apps/extension/src/background/refs.ts');
  const { locator } = load('apps/extension/src/background/locate.ts');
  const destination = 'https://example.test/b', target = { kind: 'page' };
  const shown = [];
  let active = { id: 1, url: 'https://example.test/a', status: 'complete' }, loaded;
  const port = {}, info = { url: destination };
  const bg = {
    browser: {}, sessionVersion: 1, policyVersion: 1, teamAvailable: () => true, pagePerson: async () => ({ name: 'Mia' }),
    state: {
      authenticated: true, account: { id: 'self' }, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], data: { messages: [] },
      signalRecords: [{ id: '$record', teamId: 'team', personId: 'mia', url: destination, kind: 'danger', target, timestamp: 1, expiresAt: 2 }],
    },
    panelTab: async () => ({ tab: active }), activeTab: async () => active,
    openPage: async url => { active = { ...active, url, status: 'loading' }; loaded?.(); },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    pages: {
      pagePorts: new Map([[port, info]]),
      openPageTools: async () => ({ port, info, finish() {} }),
      locate: async (_, message) => { shown.push(message); return 'shown'; },
    },
  };
  bg.locator = locator(bg);
  const start = interrupt => {
    loaded = () => { interrupt(); setTimeout(() => { active = { ...active, status: 'complete' }; }, 100); };
    return refs(bg).replaySignal({ windowId: 1, teamId: 'team', recordId: '$record' }, 'chrome-extension://panel');
  };
  return { bg, shown, start };
}

test('a signal replays after its page opens, though opening a token page moved the room and so the page policy', async () => {
  const f = locating();
  const reply = await f.start(() => { f.bg.policyVersion++; });
  assert.equal(reply.value.result, 'shown');
  assert.equal(JSON.stringify(f.shown), JSON.stringify([{ type: 'signal-replay', kind: 'danger', target: { kind: 'page' }, author: { name: 'Mia' } }]));
});

test('a replay stops when the login or squad changed while its page was opening, and an unknown record shows nothing', async () => {
  for (const interrupt of [f => { f.bg.sessionVersion++; }, f => { f.bg.state.preferences.current = 'other'; }, f => { f.bg.state.account.id = 'other'; }]) {
    const f = locating();
    const reply = await f.start(() => interrupt(f));
    assert.equal(reply.value.result, 'unavailable');
    assert.equal(f.shown.length, 0);
  }
  const f = locating();
  f.bg.state.signalRecords = [];
  assert.equal((await f.start(() => {})).value.result, 'missing');
});

