import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const file = 'apps/extension/src/features/palside/viewing/page-toggles.tsx';
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Run the complete component with a deterministic hook/element host; no browser or network is required.
function fixture() {
  const hooks = [];
  let cursor = 0;
  const effects = [];
  const requests = [];
  const calls = [];
  const notices = [];
  let clicking = false;
  let tabs = false;
  const modules = {
    react: {
      useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
      useLayoutEffect(effect, deps) {
        const index = cursor++;
        const previous = hooks[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          effects.push(() => {
            previous?.cleanup?.();
            hooks[index] = { deps, cleanup: effect() };
          });
        }
      },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@palside/i18n': { message: key => key },
    'use-intl': { useTranslations: () => key => key },
    'lucide-react': {},
    '@palside/ui/tooltip': { Tooltip: 'tooltip' },
    '../../../runtime/browser/permissions': {
      requestTabs() {
        assert.equal(clicking, true, 'permission request starts inside the click');
        return new Promise((resolve, reject) => requests.push({ resolve, reject }));
      },
    },
    '../settings/access': {},
    '../ui/icons': { ShareIcon: 'share-icon' },
    '../annotations/social-state': {},
    '../settings/use-grants': { useGrants: () => ({ tabs }) },
    './page-toggles.module.css': { default: {} },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
    return modules[name];
  } }, { filename: file });
  let c = {
    data: { self: 'account-a' }, current: 'squad-a', web: { share: true }, canWrite: true,
    live: { state: { account: { id: 'account-a' } } }, toggles: { share: false }, now: 0,
    toggle: (...args) => { calls.push(args); return Promise.resolve(); },
    setNotice: notice => notices.push(notice),
  };
  let tree;
  function render(patch = {}) {
    c = { ...c, ...patch };
    cursor = 0;
    tree = exports.ShareToggle({ c });
    for (const effect of effects.splice(0)) effect();
  }
  render();
  return {
    requests, calls, notices, render,
    grantTabs() { tabs = true; render(); },
    click() {
      clicking = true;
      try { tree.props.children.props.onClick(); } finally { clicking = false; }
    },
    unmount() { for (const hook of hooks) hook.cleanup?.(); },
    async settle(index, allowed = true) { requests[index].resolve(allowed); await Promise.resolve(); },
  };
}

for (const [name, patch] of [
  ['squad change', { current: 'squad-b' }],
  ['account change', { data: { self: 'account-b' }, live: { state: { account: { id: 'account-b' } } } }],
  ['account termination', { live: { state: {} } }],
  ['loss of write access', { canWrite: false }],
  ['sharing disabled in settings', { web: { share: false } }],
]) test(`approval after ${name} cannot enable sharing`, async () => {
  const f = fixture();
  f.click();
  f.render(patch);
  await f.settle(0);
  assert.deepEqual(f.calls, []);
});

test('returning to the original squad does not revive its request', async () => {
  const f = fixture();
  f.click();
  f.render({ current: 'squad-b' });
  f.render({ current: 'squad-a' });
  await f.settle(0);
  assert.deepEqual(f.calls, []);
});

test('approval after unmount cannot enable sharing', async () => {
  const f = fixture();
  f.click();
  f.unmount();
  await f.settle(0);
  assert.deepEqual(f.calls, []);
});

test('a newer permission request supersedes the older click', async () => {
  const f = fixture();
  f.click();
  f.click();
  await f.settle(0);
  assert.deepEqual(f.calls, []);
  await f.settle(1);
  assert.deepEqual(f.calls, [['share', true]]);
});

test('an off toggle supersedes pending approval', async () => {
  const f = fixture();
  f.click();
  f.render({ toggles: { share: true } });
  f.click();
  await f.settle(0);
  assert.deepEqual(f.calls, [['share', false]]);
});

test('normal approval survives unrelated rendering and permission refresh', async () => {
  const f = fixture();
  f.click();
  assert.equal(f.requests.length, 1);
  f.render({ now: 100 });
  f.grantTabs();
  await f.settle(0);
  assert.deepEqual(f.calls, [['share', true]]);
});

test('denial leaves sharing off', async () => {
  const f = fixture();
  f.click();
  await f.settle(0, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.notices, []);
});

test('permission errors report only to their initiating context', async () => {
  for (const stale of [false, true]) {
    const f = fixture();
    f.click();
    if (stale) f.unmount();
    f.requests[0].reject(new Error('permission failed'));
    await Promise.resolve();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.notices, stale ? [] : ['extension.share.blockedByChrome']);
  }
});

test('existing permission enables immediately without another request', () => {
  const f = fixture();
  f.grantTabs();
  f.click();
  assert.deepEqual(f.calls, [['share', true]]);
  assert.equal(f.requests.length, 0);
});
