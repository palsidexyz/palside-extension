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

const require = createRequire(import.meta.url);
const h = React.createElement;
const phrase = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
const compiled = new Map();
async function fixture(t) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLElement.prototype.checkVisibility = () => false;
  let now = 0, id = 0;
  const timers = new Map(), sent = [];
  const noop = () => null;
  const translate = (key, values) => values?.number ? String(values.number) : key;
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'use-intl': { useTranslations: () => translate },
    '@palside/i18n': { errorMessage: error => error.message, message: key => key },
    '@palside/shared/identity': { ENGLISH_WORDS: phrase, PIN_LENGTH: 6 },
    '@palside/shared/contracts/limits': { NICKNAME_LENGTH: 32 },
    '@palside/shared/person-avatars': { avatarPath: name => name },
    'motion/react': { useReducedMotion: () => true },
    'lucide-react': Object.fromEntries(['ArrowLeft', 'Check', 'Copy', 'Eye', 'ShieldAlert', 'Users'].map(name => [name, noop])),
    '@palside/ui/visually-hidden': { VisuallyHidden: ({ children }) => children },
    '@palside/ui/button': { Button: ({ children, onClick, disabled }) => h('button', { onClick, disabled }, children) },
    '@palside/ui/tooltip': { HelpTip: noop },
    '@palside/ui/field': { Input: noop, PinInput: noop, Field: noop },
    '../ui/primitives': { Action: ({ label, onClick }) => h('button', { onClick, 'aria-label': label }, label) },
    '../ui/brand': { Brand: noop },
    '../settings/language-setting': { LanguageSetting: noop },
    '../ui/motion-details': { Count: noop },
    '../../../domain/chat/model': { characterLength: text => text.length },
    '../ui/text': { useText: () => value => value, useTextState: () => React.useState('') },
  };
  const context = vm.createContext({ console, document, crypto, setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id) });
  function load(file) {
    if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`../apps/extension/src/features/palside/account/${file}`, import.meta.url), 'utf8'), {
      fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText);
    const exports = {};
    vm.runInContext(`(function(exports, require) { ${compiled.get(file)}\n})`, context)(exports, name => {
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
      assert.ok(Object.hasOwn(modules, name), name); return modules[name];
    });
    return exports;
  }
  const { Onboarding } = load('onboarding.tsx');
  const { useAccountFlow } = load('use-account-flow.ts');
  let c, actions, update, owner = {}, commandFailure;
  const live = { command: async name => {
    sent.push(name);
    if (commandFailure) throw commandFailure;
    if (name === 'account-create') update({ screen: 'password' });
    if (name === 'account-generate') return { words: [...phrase].reverse() };
  } };
  function Harness() {
    const [view, setView] = React.useState({ screen: 'confirm-phrase', phrase, flow: 'create', authBusy: false, working: false });
    const mounted = React.useRef(true);
    React.useLayoutEffect(() => () => { mounted.current = false; }, []);
    update = patch => { if ('screen' in patch) owner = {}; setView(old => ({ ...old, ...patch })); };
    const captured = owner;
    c = { ...view, live, data: {}, ownsScreen: () => mounted.current && captured === owner, setNotice: assert.fail };
    actions = useAccountFlow({ view: c, mounted,
      setAuthBusy: authBusy => update({ authBusy }), setFlow: flow => update({ flow }),
      setPhrase: phrase => update({ phrase }), setScreen: screen => update({ screen }), setWorking: working => update({ working }),
    }, () => actions);
    c = { ...c, ...actions, go: screen => update({ screen }) };
    return h(Onboarding, { c });
  }
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  const unmount = async () => { if (mounted) { await act(() => root.unmount()); mounted = false; } };
  t.after(async () => {
    await unmount();
    for (const name of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]); else delete globalThis[name];
    }
  });
  await act(() => root.render(h(Harness)));
  const click = async target => { assert.ok(target); await act(() => target.dispatchEvent(new window.Event('click', { bubbles: true }))); };
  const choose = async (correct = true) => {
    const position = Number(document.querySelector('.quizQuestion').textContent) - 1;
    const target = [...document.querySelectorAll('.choice')].find(button => (button.textContent === c.phrase[position]) === correct);
    await click(target);
  };
  const advance = async ms => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end);
      if (!next) break;
      const [id, timer] = next; now = timer.at; timers.delete(id); await act(() => timer.fn());
    }
    now = end;
  };
  return { sent, timers, document, choose, advance, unmount, click,
    actions: () => actions, patch: patch => act(() => update(patch)),
    fail: error => { commandFailure = error; },
    back: () => click(document.querySelector('[aria-label="common.back"]')),
  };
}

test('active verification keeps both delays and creates once after two correct answers', async t => {
  const f = await fixture(t);
  await f.choose(false); await f.advance(699);
  assert.ok(f.document.querySelector('[data-state="wrong"]'));
  await f.advance(1); assert.equal(f.document.querySelector('[data-state="wrong"]'), null);
  await f.choose(); await f.advance(419); assert.deepEqual(f.sent, []);
  await f.advance(1); await f.choose(); await f.advance(419); assert.deepEqual(f.sent, []);
  await f.advance(1); assert.deepEqual(f.sent, ['account-create']);
  await f.advance(1000); assert.deepEqual(f.sent, ['account-create']);
});

for (const delay of ['first', 'final', 'mismatch']) {
  for (const leave of ['back', 'unmount', 'phrase', 'flow']) {
    test(`${leave} during ${delay} delay cancels the abandoned verification`, async t => {
      const f = await fixture(t);
      if (delay === 'final') { await f.choose(); await f.advance(420); }
      await f.choose(delay !== 'mismatch');
      const late = [...f.timers.values()][0].fn;
      if (leave === 'unmount') await f.unmount();
      else if (leave === 'back') { await f.back(); await f.patch({ screen: 'confirm-phrase' }); }
      else if (leave === 'phrase') await f.patch({ phrase: [...phrase].reverse() });
      else await f.patch({ flow: 'restore' });
      assert.equal(f.timers.size, 0);
      await act(() => late()); await f.advance(1000);
      assert.deepEqual(f.sent, []);
      if (leave !== 'unmount' && leave !== 'flow') {
        await f.choose(); await f.advance(420); assert.deepEqual(f.sent, []);
        await f.choose(); await f.advance(420); assert.deepEqual(f.sent, ['account-create']);
      }
    });
  }
}

test('account action rejects stale screen, phrase and flow generations', async t => {
  const f = await fixture(t);
  for (const patch of [{ phrase: [...phrase].reverse() }, { flow: 'restore' }, { screen: 'new-account' }]) {
    const stale = f.actions().createAccount;
    await f.patch(patch); await act(() => stale());
    assert.deepEqual(f.sent, []);
  }
  await f.patch({ screen: 'confirm-phrase', flow: 'create' });
  const stale = f.actions().createAccount;
  await f.unmount(); await stale(); assert.deepEqual(f.sent, []);
});

test('failed creation retains the existing retry action', async t => {
  const f = await fixture(t);
  f.fail(new Error('failed'));
  await f.choose(); await f.advance(420); await f.choose(); await f.advance(420);
  assert.deepEqual(f.sent, ['account-create']);
  assert.ok(f.document.querySelector('[role="alert"]'));
  f.fail(undefined);
  await f.click([...f.document.querySelectorAll('button')].find(button => button.textContent === 'common.retry'));
  assert.deepEqual(f.sent, ['account-create', 'account-create']);
});
