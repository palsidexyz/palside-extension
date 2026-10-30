import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = 'apps/extension/src/features/palside/';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = () => new Promise(resolve => setImmediate(resolve));
const nodes = (tree, check) => !tree || typeof tree !== 'object' ? [] : [...(check(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => nodes(child, check))];
const find = (tree, type) => nodes(tree, node => node.type === type || node.type?.name === type)[0];
const radio = (tree, label) => nodes(tree, node => node.props?.role === 'radio' && nodes(node, child => child.props?.children?.includes(label)).length)[0];

// Complete feature modules run against the hook and host boundaries used by the sidepanel tests.
function fixture() {
  let running;
  const react = {
    useState(initial) {
      const host = running, index = host.index++;
      if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [host.slots[index], value => { const next = typeof value === 'function' ? value(host.slots[index]) : value; if (!Object.is(next, host.slots[index])) { host.slots[index] = next; host.dirty = true; } }];
    },
    useRef(initial) { const host = running, index = host.index++; return host.slots[index] ??= { current: initial }; },
    useMemo(create, deps) {
      const host = running, index = host.index++, previous = host.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) host.slots[index] = { deps, value: create() };
      return host.slots[index].value;
    },
    useEffect(effect, deps) {
      const host = running, index = host.index++, previous = host.slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) host.effects.push(() => { previous?.cleanup?.(); host.slots[index] = { deps, cleanup: effect() }; });
    },
    useSyncExternalStore(subscribe, snapshot) { react.useEffect(() => subscribe(() => {}), [subscribe]); return snapshot(); },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props, key) => ({ type, key, props: { ...props, children: [props?.children].flat(Infinity).filter(child => child != null && child !== false) } });
  const events = new Set(), calls = [], notices = [], requests = [];
  const api = {
    useTranslations: () => key => key,
    useTextState: () => react.useState(''),
    message: key => key, errorMessage: error => error?.message ?? 'common.error',
    MessageError: class extends Error {},
    broadOrigin: value => value === '<all_urls>', grantedHost: value => /^https:\/\/([^/]+)\/\*$/.exec(value)?.[1],
    getHostPermissions: async () => [], notificationsGranted: async () => false, tabsGranted: async () => false,
    watchPermissions: listener => { events.add(listener); return () => events.delete(listener); },
    requestNotifications: () => { const job = deferred(); requests.push(job); return job.promise; },
    requestSitesAccess: hosts => { const job = deferred(); requests.push({ hosts, ...job }); return job.promise; },
    requestTabs: () => { const job = deferred(); requests.push(job); return job.promise; },
    requestAllSites: () => { const job = deferred(); requests.push(job); return job.promise; },
    revokeNotifications: async () => { calls.push(['revokeNotifications']); return true; },
    revokeTabs: async () => { calls.push(['revokeTabs']); return true; },
    revokeAllSites: async () => { calls.push(['revokeAllSites']); return ['example.com']; },
    revokeSiteAccess: async () => true, revokeAllSitesKeepingHosts: async () => true,
    permissionRemovalPending: () => false,
    normalizeSiteHost: host => host, siteCategories: [], siteCategory: () => undefined,
    siteTags: () => ({}), interactionFeatures: [],
  };
  const modules = new Map();
  const real = {
    './use-preferences': 'settings/use-preferences.ts', './use-grants': 'settings/use-grants.ts',
    './access': 'settings/access.ts', '../annotations/social-state': 'annotations/social-state.ts',
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const extra = file === 'settings/access-sheet.tsx' ? '\nexport { Picker };' : '';
    const source = ts.transpileModule(readFileSync(root + file, 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const exports = {}; modules.set(file, exports);
    const require = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (real[name]) return load(real[name]);
      return new Proxy({ __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }, { get: (target, key) => key in target ? target[key] : api[key] ?? key });
    };
    vm.runInNewContext(`(function(require, exports) { ${source}\n})`, { console, Map, Set, WeakMap, URL })(require, exports);
    return exports;
  }
  function mount(component) {
    const host = { slots: [], effects: [], dirty: true, index: 0 };
    return {
      render(props) {
        let tree, count = 0;
        do {
          assert.ok(count++ < 20, 'render settles'); host.dirty = false; host.index = 0; running = host;
          tree = component(props); running = undefined;
          for (const effect of host.effects.splice(0)) effect();
        } while (host.dirty);
        return tree;
      },
      unmount() { for (const slot of host.slots) slot?.cleanup?.(); },
    };
  }
  let owns = true;
  const c = {
    data: { self: 'alice' }, current: 'team', sites: [], localSites: [], ownsAccess: () => owns,
    setNotice: (...args) => notices.push(args), interaction: {},
    live: { state: { account: { id: 'alice' }, preferences: { notifications: 'off', web: { share: true, interact: true }, restoreSites: ['example.com'] } }, page: { tabId: 1, url: 'https://example.com' },
      command: async (name, patch) => { calls.push([name, plain(patch)]); Object.assign(c.live.state.preferences, patch); } },
  };
  const social = load('annotations/social-state.ts');
  social.beginSocialSession({ accountId: 'alice' });
  return { api, calls, notices, requests, events, load, mount, c, social, depart: () => { owns = false; } };
}
function pageActions(f) {
  const hook = f.mount(f.load('settings/use-preferences.ts').usePreferences);
  const preferences = hook.render(f.c.live);
  const actions = f.load('settings/live-actions.ts').createLivePageActions({ preferences, view: { live: f.c.live, setNotice: f.c.setNotice } }, () => ({ siteName: host => host, addedNotice: () => 'added' }));
  return { hook, preferences, actions };
}
function notification(f) {
  const hook = f.mount(f.load('settings/settings.tsx').NotificationSettings);
  const choose = mode => radio(hook.render({ c: f.c }), `extension.settings.notify${mode}`).props.onClick();
  return { hook, choose };
}

test('notification prompts start in the click and only the newest intent saves to its captured account', async () => {
  const f = fixture(), view = notification(f);
  view.choose('All'); assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 0);
  view.choose('Mentions'); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(true); await drain();
  f.requests[0].resolve(true); await drain();
  assert.deepEqual(f.calls, [['preferences', { notifications: 'mentions', accountId: 'alice' }]]);
});

for (const departure of ['unmount', 'account']) test(`notification completion is inert after ${departure}`, async () => {
  const f = fixture(), view = notification(f); view.choose('All');
  if (departure === 'unmount') view.hook.unmount();
  else { f.c.live = { ...f.c.live, state: { ...f.c.live.state, account: { id: 'bob' } } }; view.hook.render({ c: f.c }); }
  f.requests[0].resolve(true); await drain();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.notices, []);
});

test('choosing Off cancels a pending notification choice and revokes after the prompt settles', async () => {
  const f = fixture(), view = notification(f); view.choose('All'); view.choose('Off'); await drain();
  assert.deepEqual(f.calls, [['preferences', { notifications: 'off', accountId: 'alice' }]]);
  f.requests[0].resolve(true); await drain();
  assert.deepEqual(f.calls.at(-1), ['revokeNotifications']);
  assert.equal(f.calls.filter(([name]) => name === 'preferences').length, 1);
});

test('rapid web edits merge pending flags even before a snapshot arrives', async () => {
  const f = fixture(), writes = [];
  f.c.live.command = (name, patch) => { const gate = deferred(); writes.push({ name, patch: plain(patch), ...gate }); return gate.promise; };
  const { actions } = pageActions(f);
  actions.setWeb('share', false); actions.setWeb('interact', false);
  assert.deepEqual(writes[1].patch.web, { share: false, interact: false });
  writes[0].resolve(); writes[1].resolve(); await drain();
  assert.deepEqual(f.calls.slice(0, 2), [['revokeTabs'], ['revokeAllSites']]);
  writes[2].resolve(); await drain();
});

test('a newer enable intent cancels a queued revoke and preserves synchronous prompting', async () => {
  const f = fixture(), gate = deferred();
  f.c.live.command = async (name, patch) => { f.calls.push([name, plain(patch)]); if (f.calls.length === 1) await gate.promise; Object.assign(f.c.live.state.preferences, patch); };
  const { actions } = pageActions(f);
  actions.setWeb('interact', false); actions.setWeb('interact', true);
  assert.equal(f.requests.length, 1);
  gate.resolve(); f.requests[0].resolve(true); await drain();
  assert.equal(f.calls.some(([name]) => name === 'revokeAllSites'), false);
  assert.deepEqual(plain(f.c.live.state.preferences.restoreSites), []);
});

test('denied site restoration retains the remembered hosts and does not enable interaction', async () => {
  const f = fixture(); f.c.live.state.preferences.web.interact = false;
  const { actions } = pageActions(f); actions.setWeb('interact', true);
  assert.deepEqual(plain(f.requests[0].hosts), ['example.com']);
  f.requests[0].resolve(false); await drain();
  assert.equal(f.c.live.state.preferences.web.interact, false);
  assert.deepEqual(f.c.live.state.preferences.restoreSites, ['example.com']);
  assert.equal(f.notices[0][0], 'extension.sites.denied');
});

test('enabling during revocation fails visibly and retains hosts for the next click', async () => {
  const f = fixture(), gate = deferred(); let removing = false;
  f.api.permissionRemovalPending = () => removing;
  f.api.revokeAllSites = async () => { removing = true; await gate.promise; removing = false; return ['second.com']; };
  const { actions } = pageActions(f); actions.setWeb('interact', false); await drain(); actions.setWeb('interact', true);
  assert.equal(f.requests.length, 0); assert.equal(f.notices[0][0], 'common.error');
  gate.resolve(); await drain();
  assert.deepEqual(plain(f.c.live.state.preferences.restoreSites), ['example.com', 'second.com']);
  actions.setWeb('interact', true); f.requests[0].resolve(true); await drain();
  assert.equal(f.c.live.state.preferences.web.interact, true); assert.deepEqual(plain(f.c.live.state.preferences.restoreSites), []);
});

test('unmount invalidates queued preference writes and permission side effects', async () => {
  const f = fixture(), gate = deferred(); f.c.live.command = () => gate.promise;
  const { actions, hook, preferences } = pageActions(f); actions.setWeb('share', false); hook.unmount(); gate.resolve(); await drain();
  assert.deepEqual(f.calls, []); assert.equal(preferences.current(), false);
});

for (const result of ['false', 'reject', 'success']) test(`site removal ${result} only offers Undo after confirmed completion`, async () => {
  const f = fixture(), gate = deferred(); f.api.revokeSiteAccess = () => gate.promise;
  const { actions } = pageActions(f); const work = actions.removeSite('example.com');
  assert.deepEqual(f.notices, []);
  if (result === 'reject') gate.reject(new Error('failed')); else gate.resolve(result === 'success');
  await work;
  assert.equal(typeof f.notices[0][1], result === 'success' ? 'function' : 'undefined');
  if (result === 'success') { f.notices[0][1](); assert.equal(f.requests.length, 1); f.requests[0].resolve(true); await drain(); }
});

test('only the latest grants refresh can publish; read failure has a working retry', async () => {
  const f = fixture(), reads = [];
  f.api.getHostPermissions = () => { const gate = deferred(); reads.push(gate); return gate.promise; };
  const hook = f.mount(f.load('settings/use-grants.ts').useGrants); hook.render(f.c);
  for (const listener of f.events) listener();
  reads[1].resolve([]); await drain(); reads[0].resolve(['<all_urls>']); await drain();
  assert.equal(hook.render(f.c).broad, false);
  for (const listener of f.events) listener(); reads[2].reject(new Error('offline')); await drain();
  let grants = hook.render(f.c); assert.equal(grants.ready, false); assert.equal(grants.error, true);
  grants.retry(); hook.render(f.c); reads[3].resolve(['https://example.com/*']); await drain();
  grants = hook.render(f.c); assert.equal(grants.error, false); assert.equal(grants.ready, true); assert.equal(grants.site('example.com'), true);
  hook.unmount(); assert.equal(f.events.size, 0);
});

test('site settings render the existing retry feedback on grants read failure', async () => {
  const f = fixture(); f.api.getHostPermissions = async () => { throw new Error('offline'); };
  const hook = f.mount(f.load('settings/sites.tsx').SitesSettings); hook.render({ c: f.c }); await drain();
  const feedback = find(hook.render({ c: f.c }), 'InlineFeedback'); assert.equal(feedback.props.action.label, 'common.retry');
  f.api.getHostPermissions = async () => []; feedback.props.action.onClick(); hook.render({ c: f.c }); await drain();
  assert.equal(find(hook.render({ c: f.c }), 'InlineFeedback'), undefined);
});

for (const change of ['replace', 'unmount', 'account', 'tab']) test(`picker completion cannot close or continue after ${change}`, async () => {
  const f = fixture(), access = f.load('settings/access.ts'), { Picker } = f.load('settings/access-sheet.tsx'); let continued = 0;
  access.addSite(f.c, { select: ['example.com'], then: () => continued++ });
  const request = f.social.captureSocialUi().snapshot().site;
  const close = () => f.social.setSocialUi({ site: undefined });
  const hook = f.mount(Picker); const tree = hook.render({ c: f.c, request, onClose: close });
  nodes(tree, node => node.type === 'Button' && node.props.size === 'lg')[0].props.onClick(); assert.equal(f.requests.length, 1);
  if (change === 'replace') access.addSite(f.c, { select: ['second.com'] });
  if (change === 'unmount') hook.unmount();
  if (change === 'account') f.social.beginSocialSession({ accountId: 'bob' });
  if (change === 'tab') { f.c.live.page = { ...f.c.live.page, tabId: 2 }; hook.render({ c: f.c, request, onClose: close }); }
  const active = f.social.captureSocialUi().snapshot()?.site;
  f.requests[0].resolve(true); await drain();
  assert.equal(continued, 0); assert.equal(f.social.captureSocialUi().snapshot()?.site, active); assert.deepEqual(f.notices, []);
});

test('picker success closes its own request and continues once', async () => {
  const f = fixture(), access = f.load('settings/access.ts'); let continued = 0;
  access.addSite(f.c, { select: ['example.com'], then: () => continued++ });
  const request = f.social.captureSocialUi().snapshot().site;
  const hook = f.mount(f.load('settings/access-sheet.tsx').Picker);
  const tree = hook.render({ c: f.c, request, onClose: () => f.social.setSocialUi({ site: undefined }) });
  nodes(tree, node => node.type === 'Button' && node.props.size === 'lg')[0].props.onClick();
  f.requests[0].resolve(true); await drain(); assert.equal(continued, 1); assert.equal(f.social.captureSocialUi().snapshot().site, undefined);
});

for (const change of ['session', 'context', 'picker', 'newer']) test(`access prechecks ignore stale ${change} completions`, async () => {
  const f = fixture(), gate = deferred(), access = f.load('settings/access.ts'); let continued = 0;
  f.api.accessStatus = () => gate.promise; access.withTargetAccess(f.c, 'https://example.com', () => continued++);
  if (change === 'session') f.social.beginSocialSession({ accountId: 'alice' });
  if (change === 'context') f.depart();
  if (change === 'picker') access.addSite(f.c, { select: ['second.com'] });
  if (change === 'newer') { f.api.accessStatus = async () => ({ site: true }); access.withTargetAccess(f.c, 'https://second.com', () => {}); }
  gate.resolve({ site: true }); await drain(); assert.equal(continued, 0);
});

test('runtime preferences reject missing and mismatched account IDs before applying a patch', async () => {
  const f = fixture();
  const handler = f.load('../../runtime/viewing/command-handlers.ts').preferencesCommand;
  const preferences = { notifications: 'off' };
  const runtime = { auth: { session: { account: { id: 'alice' } }, scope: () => ({}) }, state: { preferences } };
  for (const payload of [{ notifications: 'all' }, { accountId: 'bob', notifications: 'all' }]) await assert.rejects(handler.call({ runtime }, { name: 'preferences', payload }), /retryAccountChanged/);
  assert.equal(runtime.state.preferences, preferences);
});

for (const kind of ['GrantSheet', 'AllSitesSheet']) test(`${kind} preserves click-time closure and ignores a replacement sheet`, async () => {
  const f = fixture(), api = f.load('settings/access-sheet.tsx');
  f.c.pageHost = 'example.com';
  const field = kind === 'GrantSheet' ? 'grant' : 'allSites';
  const value = kind === 'GrantSheet' ? 'interact' : true;
  f.social.setSocialUi({ [field]: value });
  const hook = f.mount(api[kind]); let tree = hook.render({ c: f.c });
  nodes(tree, node => node.type === 'Button' && node.props.variant === 'surface')[0].props.onClick();
  assert.equal(f.requests.length, 1); assert.equal(f.social.captureSocialUi().snapshot()[field], undefined);
  f.social.setSocialUi({ [field]: value }); tree = hook.render({ c: f.c });
  f.requests[0].resolve(false); await drain();
  assert.equal(f.social.captureSocialUi().snapshot()[field], value); assert.deepEqual(f.notices, []);
  nodes(tree, node => node.type === 'Button' && node.props.variant === 'surface')[0].props.onClick();
  f.requests[1].resolve(false); await drain(); assert.equal(f.notices[0][0], 'extension.sites.denied');
});

test('web permission completion from a replaced account cannot save or show notices', async () => {
  const f = fixture(), { hook, actions } = pageActions(f);
  actions.setWeb('interact', true);
  f.c.live = { ...f.c.live, state: { ...f.c.live.state, account: { id: 'bob' } } };
  hook.render(f.c.live); f.requests[0].resolve(true); await drain();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.notices, []);
});

async function privacy(f) {
  f.api.notificationsGranted = async () => true;
  f.c.favorites = { sites: [], pages: [] };
  f.c.setConfirmation = value => { f.confirmation = value; };
  const hook = f.mount(f.load('settings/privacy.tsx').Privacy);
  hook.render({ c: f.c }); await drain();
  const revoke = () => {
    const tree = hook.render({ c: f.c });
    const card = nodes(tree, node => node.type === 'section' && node.props['aria-label'] === 'extension.privacy.perm_notifications')[0];
    find(card, 'Button').props.onClick();
    return f.confirmation.confirm;
  };
  return { hook, revoke };
}

test('privacy notification revocation persists the captured account before removing permission', async () => {
  const f = fixture(), gate = deferred(), view = await privacy(f);
  f.c.live.command = async (name, patch) => { f.calls.push([name, plain(patch)]); await gate.promise; };
  const work = view.revoke()();
  assert.deepEqual(f.calls, [['preferences', { notifications: 'off', accountId: 'alice' }]]);
  gate.resolve(); await work;
  assert.deepEqual(f.calls.at(-1), ['revokeNotifications']);
});

for (const departure of ['unmount', 'account', 'intent']) test(`privacy notification confirmation is inert after ${departure}`, async () => {
  const f = fixture(), view = await privacy(f), confirm = view.revoke();
  if (departure === 'unmount') view.hook.unmount();
  if (departure === 'account') { f.c.live = { ...f.c.live, state: { ...f.c.live.state, account: { id: 'bob' } } }; view.hook.render({ c: f.c }); }
  if (departure === 'intent') view.revoke();
  await confirm();
  assert.deepEqual(f.calls, []);
});

for (const outcome of ['resolve', 'reject']) test(`privacy pending revocation ${outcome} cannot affect a replacement account`, async () => {
  const f = fixture(), gate = deferred(), view = await privacy(f);
  f.c.live.command = async (name, patch) => { f.calls.push([name, plain(patch)]); return gate.promise; };
  const work = view.revoke()();
  f.c.live = { ...f.c.live, state: { ...f.c.live.state, account: { id: 'bob' } } }; view.hook.render({ c: f.c });
  if (outcome === 'resolve') gate.resolve(); else gate.reject(new Error('offline'));
  await work;
  assert.equal(f.calls.length, 1); assert.deepEqual(f.notices, []);
});
