import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import * as limits from '../packages/shared/src/contracts/limits.ts';
import { characterLength } from '../apps/extension/src/domain/chat/model.ts';
import { defaultTeamAvatarOptions } from '../apps/extension/src/features/palside/teams/default-team-avatar.ts';

const require = createRequire(import.meta.url);
const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
window.HTMLElement.prototype.showModal = function () { this.open = true; };
window.HTMLElement.prototype.close = function () { this.open = false; };
window.HTMLElement.prototype.checkVisibility = () => true;
const { createRoot } = await import('react-dom/client');
const h = React.createElement;
const message = key => key;
const translate = key => key;
const css = new Proxy({}, { get: (_, key) => key });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const failure = code => Object.assign(new Error(code), { code });
const team = { id: 'team', name: 'Squad', description: 'Hello', memberCount: 3 };
const invitation = 'a'.repeat(32);
const inviteUrl = `https://palside.test/invite/${invitation}`;
const previewResult = patch => ({ invite: invitation, team, passwordRequired: false, lockedUntil: null, alreadyMember: false, ...patch });

// Real React and the production sheet run against a DOM host; image and command boundaries are deferred fixtures.
function production(overrides = {}) {
  const frames = [];
  const omit = (props, keys) => Object.fromEntries(Object.entries(props).filter(([key]) => !keys.includes(key)));
  const Button = ({ children, loading, ...props }) => h('button', { ...omit(props, ['loadingLabel', 'leadingIcon', 'variant', 'size']), disabled: props.disabled || loading }, children);
  const IconButton = ({ label, ...props }) => h(Button, { ...props, 'aria-label': label });
  const Input = ({ onChange, ...props }) => h('input', { ...omit(props, ['leadingIcon']), onInput: onChange });
  const Textarea = ({ onChange, ...props }) => h('textarea', { ...props, onInput: onChange });
  const PinInput = ({ onValueChange, ...props }) => h('input', { ...omit(props, ['length', 'normalize', 'reveal']), 'data-pin': true, onInput: event => onValueChange(event.target.value) });
  const Field = ({ children, error }) => h('label', {}, children({}), error && h('span', { role: 'alert' }, error));
  const motionElement = tag => props => h(tag, omit(props, ['initial', 'animate', 'exit', 'transition']));
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => translate, useLocale: () => 'en' },
    '@palside/shared/contracts/limits': limits,
    '@palside/shared/contracts/rules': { normalizeInvitePassword: value => value },
    '@palside/i18n': { message, errorMessage: error => error.message, localeOrEnglish: value => value, deadlineTime: String },
    '@palside/ui/button': { Button, IconButton },
    '@palside/ui/field': { Field, Input, Textarea, PinInput, CharacterCount: () => null },
    '@palside/ui/inline-feedback': { InlineFeedback: ({ children }) => h('p', { role: 'alert' }, children) },
    '@palside/ui/visually-hidden': { VisuallyHidden: ({ children }) => children },
    '@palside/ui/menu': Object.fromEntries(['Menu', 'MenuContent', 'MenuItem', 'MenuTrigger'].map(key => [key, ({ children }) => children])),
    '@palside/ui/lib/image': { prepareImage: overrides.prepareImage ?? (async file => ({ blob: file })) },
    '../account/read-image': { readImage: overrides.readImage ?? (async blob => blob.src) },
    '../ui/brand': { Brand: () => null }, '../ui/primitives': { Action: IconButton },
    '../ui/motion-details': { Count: ({ value }) => value, CountText: ({ text }) => text },
    '../../../domain/chat/model': { characterLength }, './default-team-avatar': { defaultTeamAvatarOptions },
    './team-avatar': { TeamAvatar: ({ team: value }) => h('img', { 'data-avatar': true, src: value.avatar, alt: '' }) },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    'motion/react': { motion: { dialog: motionElement('dialog'), div: motionElement('div') }, AnimatePresence: ({ children }) => children, useIsPresent: () => true, useReducedMotion: () => false },
    clsx: { clsx: (...values) => values.filter(Boolean).join(' ') },
    '@palside/design/motion': { motionPresets: { feedback: {}, reduced: {} } },
  };
  const context = vm.createContext({ console, Error, URL, crypto, window, document, HTMLElement: window.HTMLElement, innerWidth: 400, innerHeight: 800, setTimeout, clearTimeout, requestAnimationFrame: callback => frames.push(callback), ResizeObserver: class { observe() {} disconnect() {} }, navigator: { clipboard: { readText: overrides.clipboard ?? (async () => inviteUrl) } } });
  function load(file) {
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    vm.runInContext(`(function(require, module, exports) { ${code}\n})`, context)(specifier => {
      if (specifier.endsWith('.css')) return { __esModule: true, default: css };
      assert.ok(Object.hasOwn(modules, specifier), `Unmapped import ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    return module.exports;
  }
  modules['../../internal/backdrop-dismiss'] = load('packages/ui/src/internal/backdrop-dismiss.ts');
  modules['@palside/ui/sheet'] = load('packages/ui/src/components/sheet/sheet.tsx');
  modules['../ui/text'] = load('apps/extension/src/features/palside/ui/text.ts');
  return { ...load('apps/extension/src/features/palside/teams/team-start.tsx'), frames };
}

async function fixture(t, { page = false, form = false, pending = false, prompt, command, preview, ...overrides } = {}) {
  const components = production(overrides), calls = [], container = document.createElement('div');
  container.setAttribute('data-palside-app', ''); document.body.append(container);
  const root = createRoot(container);
  const initialPrompt = prompt ?? { invite: invitation, team, passwordRequired: false };
  const c = {
    data: { self: 'self', pendingInvite: pending ? inviteUrl : undefined }, teams: [], screen: 'join',
    live: { state: { config: { websiteUrl: 'https://palside.test' }, rooms: { invites: [] } }, command: async (name, payload) => { calls.push([name, payload]); return command ? command(name, payload) : { teamId: team.id }; } },
    previewInvite: async url => { calls.push(['preview', url]); return preview ? preview(url) : previewResult(); },
    chooseTeam: id => calls.push(['choose', id]), setNotice: value => calls.push(['notice', value]),
    run: async (name, payload) => { calls.push([name, payload]); if (name === 'dismiss-invite' && c.data.pendingInvite === payload.url) c.data.pendingInvite = undefined; },
    createTeam: async (...args) => calls.push(['create', ...args]), go: screen => { c.screen = screen; },
  };
  let showPage = page;
  function App() {
    const [joinPrompt, setJoinPrompt] = React.useState(page || form ? undefined : initialPrompt);
    c.joinPrompt = joinPrompt; c.setJoinPrompt = value => { calls.push(['prompt', value]); setJoinPrompt(value); };
    return h(React.Fragment, {}, form ? h(components.TeamStartForm, { c }) : showPage && h(components.JoinPage, { c }), !form && h(components.JoinSheet, { c }));
  }
  await act(async () => root.render(h(App)));
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  const dispatch = async (node, type, props = {}) => {
    assert.ok(node, `Missing target for ${type}`);
    await act(async () => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, props); node.dispatchEvent(event); });
  };
  return {
    c, calls, container, components, dispatch,
    submit: () => dispatch(container.querySelector('form'), 'submit'),
    input: async (selector, value) => { const node = container.querySelector(selector); node.value = value; await dispatch(node, 'input'); },
    upload: async value => { const node = container.querySelector('input[type=file]'); Object.defineProperty(node, 'files', { configurable: true, value: [value] }); await dispatch(node, 'change'); },
    leave: async () => { showPage = false; c.screen = 'settings'; await act(async () => root.render(h(App))); },
    returnToJoin: async () => { showPage = true; c.screen = 'join'; await act(async () => root.render(h(App))); },
    render: async () => { await act(async () => root.render(h(App))); },
  };
}
const submitButton = f => f.container.querySelector('button[type=submit]');
const resolve = async (work, value) => { await act(async () => work.resolve(value)); };
const reject = async (work, error) => { await act(async () => work.reject(error)); };

for (const code of ['NETWORK_ERROR', 'CONNECTION_UNAVAILABLE', 'MATRIX_UNAVAILABLE', 'MATRIX_ERROR', 'RATE_LIMITED', 'INTERNAL_ERROR', 'OPERATION_ENDED', 'INVITE_INVALID', 'TEAM_FULL', 'JOIN_BLOCKED']) {
  test(`join classifies ${code} and retains its feedback`, async t => {
    let attempt = 0;
    const f = await fixture(t, { command: async () => { if (!attempt++) throw failure(code); return { teamId: team.id }; } });
    await f.submit();
    const terminal = ['OPERATION_ENDED', 'INVITE_INVALID', 'TEAM_FULL', 'JOIN_BLOCKED'].includes(code);
    assert.equal(submitButton(f).disabled, terminal);
    assert.match(f.container.textContent, new RegExp(code));
    await f.submit();
    assert.equal(attempt, terminal ? 1 : 2);
    assert.equal(f.calls.filter(([name]) => name === 'choose').length, terminal ? 0 : 1);
  });
}

test('password introduced after preview refreshes details and submits the entered password', async t => {
  let attempt = 0;
  const f = await fixture(t, { command: async () => { if (!attempt++) throw failure('INVITE_PASSWORD_REQUIRED'); return { teamId: team.id }; }, preview: async () => previewResult({ passwordRequired: true, team: { ...team, memberCount: 7 } }) });
  await f.submit();
  assert.ok(f.container.querySelector('[data-pin]'));
  assert.match(f.container.textContent, /7 \/ 30/);
  assert.equal(submitButton(f).disabled, true);
  assert.deepEqual(f.calls.find(([name]) => name === 'preview'), ['preview', inviteUrl]);
  await f.input('[data-pin]', 'ABCD'); await f.submit();
  assert.equal(f.calls.filter(([name]) => name === 'join')[1][1].password, 'ABCD');
});

test('a failed password preview leaves password entry retryable', async t => {
  const f = await fixture(t, { command: async () => { throw failure('INVITE_PASSWORD_REQUIRED'); }, preview: async () => { throw failure('MATRIX_UNAVAILABLE'); } });
  await f.submit(); await f.input('[data-pin]', 'ABCD');
  assert.equal(submitButton(f).disabled, false);
});

for (const path of ['button', 'backdrop', 'escape', 'cancel']) {
  test(`${path} abandons a pending invitation and ignores accepted join UI effects`, async t => {
    const joined = deferred();
    const f = await fixture(t, { page: true, pending: true, command: () => joined.promise });
    const joinForm = f.container.querySelector('dialog form');
    await f.dispatch(joinForm, 'submit');
    const dialog = f.container.querySelector('dialog');
    if (path === 'button') await f.dispatch(dialog.querySelector('[aria-label="common.close"]'), 'click');
    if (path === 'backdrop') { await f.dispatch(dialog, 'pointerdown'); await f.dispatch(dialog, 'click'); }
    if (path === 'escape') await f.dispatch(dialog, 'keydown', { key: 'Escape' });
    if (path === 'cancel') await f.dispatch(dialog, 'cancel');
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.c.data.pendingInvite, undefined);
    assert.equal(f.calls.filter(([name]) => name === 'dismiss-invite').length, 1);
    await resolve(joined, { teamId: team.id });
    assert.equal(f.calls.filter(([name]) => name === 'join').length, 1);
    assert.equal(f.calls.some(([name]) => name === 'choose' || name === 'notice'), false);
    await f.leave(); await f.returnToJoin();
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.calls.filter(([name]) => name === 'preview').length, 1);
  });
}

for (const outcome of ['preview', 'blocked', 'member']) {
  test(`departure ignores delayed ${outcome} completion`, async t => {
    const work = deferred(), joined = deferred();
    const f = await fixture(t, { page: true, pending: true, preview: () => work.promise, command: () => joined.promise });
    if (outcome === 'member') await resolve(work, previewResult({ alreadyMember: true }));
    await f.leave();
    if (outcome === 'preview') await resolve(work, previewResult());
    if (outcome === 'blocked') await reject(work, failure('JOIN_BLOCKED'));
    if (outcome === 'member') await resolve(joined, { teamId: team.id });
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.calls.some(([name]) => name === 'prompt' || name === 'choose'), false);
  });
}

test('manual invitation dismissal leaves an unrelated pending invitation intact', async t => {
  const f = await fixture(t, { pending: true });
  await f.dispatch(f.container.querySelector('[aria-label="common.close"]'), 'click');
  assert.equal(f.c.data.pendingInvite, inviteUrl);
  assert.equal(f.calls.some(([name]) => name === 'dismiss-invite'), false);
});

test('shared capacity disables joining and labels the same limit', async t => {
  const f = await fixture(t, { prompt: { invite: invitation, team: { ...team, memberCount: limits.TEAM_MEMBER_LIMIT } } });
  assert.equal(submitButton(f).disabled, true);
  assert.match(f.container.textContent, new RegExp(`${limits.TEAM_MEMBER_LIMIT} / ${limits.TEAM_MEMBER_LIMIT}`));
  await f.submit(); assert.equal(f.calls.some(([name]) => name === 'join'), false);
});

test('creation shares description validation with the button and blocks pending avatar processing', async t => {
  const image = deferred();
  const f = await fixture(t, { form: true, prepareImage: () => image.promise });
  await f.input('input[aria-label="extension.copy.teamName"]', 'A squad');
  await f.input('textarea', 'x'.repeat(limits.TEAM_DESCRIPTION_LENGTH + 1));
  assert.equal(submitButton(f).disabled, true); await f.submit();
  assert.equal(f.calls.some(([name]) => name === 'create'), false);
  await f.input('textarea', 'x'.repeat(limits.TEAM_DESCRIPTION_LENGTH));
  assert.equal(submitButton(f).disabled, false);
  await f.upload({ name: 'avatar' });
  assert.equal(submitButton(f).disabled, true); await f.submit();
  assert.equal(f.calls.some(([name]) => name === 'create'), false);
  await resolve(image, { blob: { src: 'data:latest' } });
  assert.equal(submitButton(f).disabled, false); await f.submit();
  assert.equal(f.calls.find(([name]) => name === 'create')[3], 'data:latest');
});

for (const choice of ['preset', 'shuffle', 'upload']) {
  test(`new ${choice} wins over an earlier image read`, async t => {
    const reads = [];
    const f = await fixture(t, { form: true, readImage: () => { const read = deferred(); reads.push(read); return read.promise; } });
    await f.input('input[aria-label="extension.copy.teamName"]', 'A squad');
    await f.upload({ name: 'first' });
    if (choice === 'preset') await f.dispatch(f.container.querySelector('button[aria-pressed="false"]'), 'click');
    if (choice === 'shuffle') await f.dispatch(f.container.querySelector('[aria-label="extension.start.shuffle"]'), 'click');
    if (choice === 'upload') { await f.upload({ name: 'second' }); await resolve(reads[1], 'data:second'); }
    const selected = f.container.querySelector('[data-avatar]').getAttribute('src');
    await resolve(reads[0], 'data:first');
    assert.equal(f.container.querySelector('[data-avatar]').getAttribute('src'), selected);
    assert.equal(submitButton(f).disabled, false);
    await f.submit(); assert.equal(f.calls.find(([name]) => name === 'create')[3], selected);
  });
}

test('closing during a password refresh ignores its result and queued focus', async t => {
  const refresh = deferred();
  const f = await fixture(t, { command: async () => { throw failure('INVITE_PASSWORD_REQUIRED'); }, preview: () => refresh.promise });
  await f.submit();
  await f.dispatch(f.container.querySelector('[aria-label="common.close"]'), 'click');
  await resolve(refresh, previewResult({ passwordRequired: true }));
  await act(async () => f.components.frames.forEach(frame => frame()));
  assert.equal(f.container.querySelector('dialog'), null);
  assert.equal(f.calls.some(([name]) => name === 'choose' || name === 'notice'), false);
});

test('the blocked invitation acknowledgment dismisses its originating pending link', async t => {
  const f = await fixture(t, { page: true, pending: true, preview: async () => { throw failure('JOIN_BLOCKED'); } });
  const acknowledgment = [...f.container.querySelectorAll('dialog button')].find(button => button.textContent === 'extension.start.gotIt');
  await f.dispatch(acknowledgment, 'click');
  assert.equal(f.container.querySelector('dialog'), null);
  assert.equal(f.c.data.pendingInvite, undefined);
});

test('clipboard completion after departure cannot start a preview', async t => {
  const clipboard = deferred();
  const f = await fixture(t, { page: true, clipboard: () => clipboard.promise });
  await f.dispatch(f.container.querySelector('[aria-label="extension.start.pasteLink"]'), 'click');
  await f.leave(); await resolve(clipboard, inviteUrl);
  assert.equal(f.calls.some(([name]) => name === 'preview'), false);
});

test('superseded preparation cannot clear the latest pending state or report its failure', async t => {
  const images = [];
  const f = await fixture(t, { form: true, prepareImage: () => { const image = deferred(); images.push(image); return image.promise; } });
  await f.input('input[aria-label="extension.copy.teamName"]', 'A squad');
  await f.upload({ name: 'first' }); await f.upload({ name: 'second' });
  await reject(images[0], new Error('Old failure'));
  assert.equal(submitButton(f).disabled, true);
  assert.doesNotMatch(f.container.textContent, /Old failure/);
  await resolve(images[1], { blob: { src: 'data:second' } });
  assert.equal(submitButton(f).disabled, false);
  assert.equal(f.container.querySelector('[data-avatar]').getAttribute('src'), 'data:second');
});
