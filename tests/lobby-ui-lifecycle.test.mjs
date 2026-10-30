import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { productionModules } from './helpers/production-module.mjs';

const root = 'apps/extension/src/features/palside/teams/';
const require = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));

// Production hooks run with a deterministic React state/effect and timer host.
function panel() {
  const slots = [], effects = [], timers = new Map(), calls = [];
  let cursor = 0, nextTimer = 0;
  const ref = value => slots[cursor++] ??= { current: value };
  const load = productionModules({
    Error, message: key => key, errorMessage: error => error.message,
    useRef: ref,
    useState(value) { const cell = ref(typeof value === 'function' ? value() : value); return [cell.current, next => { cell.current = typeof next === 'function' ? next(cell.current) : next; }]; },
    useCallback(fn, deps) { const cell = ref(); if (!same(cell.current?.deps, deps)) cell.current = { fn, deps }; return cell.current.fn; },
    useEffect(fn, deps) { const cell = ref(); if (!same(cell.current?.deps, deps)) { const previous = cell.current; const effect = { deps }; cell.current = effect; effects.push(() => { previous?.cleanup?.(); effect.cleanup = fn(); }); } },
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  });
  const { useDiscovery } = load(root + 'use-discovery.ts');
  const { createLiveTeamActions } = load(root + 'live-actions.ts');
  const view = { live: { command: (name, payload) => { const request = deferred(); calls.push({ name, payload: plain(payload), ...request }); return request.promise; } }, lobbyLoading: false, lobbyError: '', data: { self: 'self' }, teams: [], requests: [] };
  const state = { view, setLobbyLoading: value => { view.lobbyLoading = value; }, setLobbyError: value => { view.lobbyError = value; } };
  let actions;
  function Render() { cursor = 0; actions = { ...useDiscovery(state), ...createLiveTeamActions(state, () => actions), run: async (...args) => { try { return await view.live.command(...args); } catch { return undefined; } } }; while (effects.length) effects.shift()(); return actions; }
  Render();
  return { view, calls, timers, Render, get actions() { return actions; }, tick() { const work = [...timers.values()]; timers.clear(); work.forEach(({ fn }) => fn()); }, unmount() { slots.forEach(cell => cell.current?.cleanup?.()); } };
}

const module = { exports: {} };
const source = ts.transpileModule(readFileSync(root + 'lobby.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const production = productionModules();
vm.runInNewContext(`(function(require, module, exports) { ${source}\n })`)(name => {
  if (name === 'react' || name === 'react/jsx-runtime' || name === '@palside/shared/contracts/limits' || name === '@palside/i18n') return require(name);
  if (name === 'use-intl') return { useTranslations: () => key => key };
  if (name === '../../../domain/teams/lobby-values') return production('apps/extension/src/domain/teams/lobby-values.ts');
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  return new Proxy({}, { get: (_, key) => key });
}, module, module.exports);
const { Lobby } = module.exports;
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function lobby(p) { return Lobby({ c: { ...p.view, ...p.actions, discoveryTeams: [], people: [], now: Date.now() } }); }

test('failed entry and the rendered Retry share one loading/error owner', async () => {
  const p = panel(); const entry = p.actions.refreshLobby();
  assert.equal(p.view.lobbyLoading, true);
  p.calls[0].reject(Error('offline')); await entry; p.Render();
  assert.equal(nodes(lobby(p), node => node.props?.role === 'alert')[0].props.children, 'offline');
  const retry = nodes(lobby(p), node => node.type === 'Button' && node.props.children === 'common.retry')[0];
  retry.props.onClick();
  assert.equal(p.view.lobbyError, ''); assert.equal(p.view.lobbyLoading, true);
  p.calls[1].resolve({}); await drain(); p.Render();
  assert.equal(p.view.lobbyLoading, false);
  assert.equal(nodes(lobby(p), node => node.props?.role === 'alert').length, 0);
  assert.equal(p.calls.length, 2);
  p.unmount();
});

for (const mutation of ['requestTeam', 'cancelApplication']) test(`${mutation} completion refreshes the active newer search and sort`, async () => {
  const p = panel();
  p.actions[mutation]('team', 'note');
  const input = nodes(lobby(p), node => node.type === 'Input')[0];
  input.props.onChange({ target: { value: 'new squad' } }); p.Render();
  const sort = nodes(lobby(p), node => node.type === 'select')[0];
  sort.props.onChange({ target: { value: 'latest' } }); p.Render(); p.tick();
  assert.deepEqual(p.calls[1].payload, { q: 'new squad', sort: 'latest' });
  p.calls[0].resolve({ done: true }); await drain();
  assert.deepEqual(p.calls[2].payload, { q: 'new squad', sort: 'latest' });
  p.calls[1].reject(Error('stale')); await drain();
  assert.equal(p.view.lobbyLoading, true); assert.equal(p.view.lobbyError, '');
  p.calls[2].resolve({}); await drain(); assert.equal(p.view.lobbyLoading, false);
  p.unmount();
});

test('mutation completion during debounce uses current filters and cancels the queued duplicate', async () => {
  const p = panel(); p.actions.requestTeam('team', 'note');
  p.actions.updateLobbyFilters({ query: 'pending' }); p.Render();
  assert.equal(p.timers.size, 1);
  p.calls[0].resolve({ done: true }); await drain();
  assert.equal(p.timers.size, 0); assert.deepEqual(p.calls[1].payload, { q: 'pending', sort: 'heat' });
  p.calls[1].resolve({}); await drain(); p.unmount();
});

test('failed mutation does not launch a lobby refresh', async () => {
  const p = panel(); p.actions.cancelApplication('team');
  p.calls[0].reject(Error('offline')); await drain();
  assert.equal(p.calls.length, 1); p.unmount();
});

test('applications refresh keeps sort, restores the recruiting query, and survives Lobby remount', async () => {
  const p = panel(); p.actions.updateLobbyFilters({ query: 'cats', sort: 'latest' }); p.Render();
  nodes(lobby(p), node => node.type === 'Tabs')[0].props.onChange('applications'); p.Render(); p.tick();
  assert.deepEqual(p.calls[0].payload, { q: '', sort: 'latest' });
  p.calls[0].resolve({}); await drain();
  nodes(lobby(p), node => node.type === 'Tabs')[0].props.onChange('recruiting'); p.Render(); p.tick();
  assert.equal(nodes(lobby(p), node => node.type === 'Input')[0].props.value, 'cats');
  assert.deepEqual(p.calls[1].payload, { q: 'cats', sort: 'latest' });
  p.calls[1].resolve({}); await drain(); p.unmount();
});

test('unmount cancels debounce and suppresses late errors and mutation refresh', async () => {
  const p = panel(); const pending = p.actions.refreshLobby(); p.actions.requestTeam('team', 'note');
  p.actions.updateLobbyFilters({ query: 'later' }); p.unmount();
  assert.equal(p.timers.size, 0);
  p.calls[0].reject(Error('late')); p.calls[1].resolve({ done: true }); await pending; await drain();
  assert.equal(p.view.lobbyError, ''); assert.equal(p.calls.length, 2);
});
