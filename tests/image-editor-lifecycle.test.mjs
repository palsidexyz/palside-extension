import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { errorMessage } from '../packages/i18n/src/core.ts';

const source = ts.createSourceFile('image-editor.tsx', readFileSync('apps/extension/src/features/palside/media/image-editor.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ImageEditor').getText(source).replace(/^export /, '');
const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const initialState = { ready: true, dirty: false, tool: 'pan', zoom: 1, undoReady: false, redoReady: false };
const session = { id: 'session', status: 'open', windowOpen: true, document: { ops: ['popup edit'] } };
const ended = () => Object.assign(new Error('session ended'), { code: 'IMAGE_SESSION_UNAVAILABLE', text: { key: 'extension.runtime.imageUnavailable' } });

// Execute the production component with deterministic hook, workspace and host boundaries.
function fixture() {
  const slots = [], effects = [], timers = new Map(), calls = [], restored = [];
  let cursor = 0, timerId = 0, dirty = true, view, closed = 0, saved = 0;
  const translate = key => key;
  const node = { focus() {}, closest() {}, addEventListener() {}, removeEventListener() {}, showModal() {}, close() {} };
  const React = { Fragment: 'fragment', createElement(type, props, ...children) {
    if (props?.ref) props.ref.current = node;
    return { type, props: props ?? {}, children };
  } };
  const context = {
    React, initialState, useTranslations: () => translate, useText: () => value => value.key,
    errorMessage,
    s: new Proxy({}, { get: (_, key) => key }),
    Button: 'Button', IconButton: 'IconButton', AlertDialog: 'AlertDialog', ArrowLeft: 'ArrowLeft', Maximize2: 'Maximize2', Minus: 'Minus', Plus: 'Plus', Scan: 'Scan',
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { if (!Object.is(slots[i], next)) { slots[i] = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || !deps || deps.some((dep, j) => dep !== previous.deps?.[j])) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
    createImageWorkspace: () => ({ getSnapshot: () => ({ ops: ['panel edit'] }), restoreState: value => restored.push(value), updateLabels() {}, stop() {}, complete() { saved++; } }),
    document: { activeElement: null }, HTMLElement: class {}, ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn, ms) { assert.equal(ms, 750); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const Editor = vm.runInNewContext(`${compiled}; ImageEditor`, context);
  const command = (name, payload) => new Promise((resolve, reject) => calls.push({ name, payload, resolve, reject }));
  function render() {
    while (dirty) { dirty = false; cursor = 0; view = Editor({ src: 'data:image/png;base64,AA==', teamId: 'team', command, onClose: () => closed++ }); while (effects.length) effects.shift()(); }
    return view;
  }
  async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } }
  function nodes(value = render()) { return value && typeof value === 'object' ? [value, ...value.children.flat(Infinity).flatMap(child => child === undefined ? [] : nodes(child))] : []; }
  function button(label) { return nodes().find(item => item.props.label === label || item.type === 'Button' && item.children.includes(label)); }
  async function click(label) { const target = button(label); assert.ok(target); assert.ok(!target.props.disabled); target.props.onClick(); await settle(); }
  async function poll() { assert.equal(timers.size, 1); const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await settle(); return calls.at(-1); }
  const locked = () => nodes().find(item => item.props.className === 'stage').props.inert;
  const alert = () => nodes().find(item => item.props.role === 'alert')?.children[0];
  render();
  return { calls, restored, timers, settle, click, poll, locked, alert, button, closed: () => closed, saved: () => saved,
    async open() { await click('extension.image.openWindow'); calls.at(-1).resolve(session); await settle(); assert.equal(locked(), true); },
    stop() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('transient read failures keep editing and saving locked and retry the same session', async t => {
  const f = fixture(); t.after(f.stop); await f.open();
  for (let i = 0; i < 2; i++) {
    const read = await f.poll(); assert.equal(read.name, 'image-session-read'); assert.equal(read.payload.id, session.id);
    read.reject(new Error('transport unavailable')); await f.settle();
    assert.equal(f.locked(), true); assert.equal(f.button('extension.copy.save').props.disabled, true);
    assert.equal(f.button('common.cancel').props.disabled, true); assert.equal(f.alert(), 'common.error');
  }
  (await f.poll()).resolve(session); await f.settle();
  assert.equal(f.locked(), true); assert.equal(f.alert(), undefined); assert.equal(f.saved(), 0);
});

test('explicit handback after a failed read restores the popup document and unlocks', async t => {
  const f = fixture(); t.after(f.stop); await f.open();
  (await f.poll()).reject(new Error('offline')); await f.settle();
  await f.click('extension.image.returnPanel');
  assert.equal(f.calls.at(-1).name, 'image-session-return'); assert.equal(f.locked(), true);
  f.calls.at(-1).resolve({ ...session, windowOpen: false }); await f.settle();
  assert.deepEqual(f.restored, [session.document]); assert.equal(f.locked(), false); assert.equal(f.timers.size, 0);
});

test('only a proven closed window unlocks polling recovery', async t => {
  const f = fixture(); t.after(f.stop); await f.open();
  (await f.poll()).resolve({ ...session, windowOpen: undefined }); await f.settle(); assert.equal(f.locked(), true);
  (await f.poll()).resolve({ ...session, windowOpen: false }); await f.settle();
  assert.equal(f.locked(), false); assert.deepEqual(f.restored, [session.document]);
});

test('saved status closes without restoring or saving the panel document', async t => {
  for (const via of ['poll', 'return']) {
    const f = fixture(); t.after(f.stop); await f.open();
    if (via === 'poll') await f.poll(); else await f.click('extension.image.returnPanel');
    f.calls.at(-1).resolve({ ...session, status: 'saved', windowOpen: false }); await f.settle();
    assert.equal(f.closed(), 1); assert.equal(f.saved(), 0); assert.deepEqual(f.restored, []); assert.equal(f.timers.size, 0);
  }
});

test('terminal session loss stops polling and uses existing ended feedback', async t => {
  const f = fixture(); t.after(f.stop); await f.open();
  (await f.poll()).reject(ended()); await f.settle();
  assert.equal(f.alert(), 'extension.runtime.imageUnavailable'); assert.equal(f.timers.size, 0);
  assert.equal(f.locked(), false); assert.deepEqual(f.restored, []); assert.equal(f.saved(), 0);
});

test('a read completed after handback cannot restore ownership or overwrite the document', async t => {
  const f = fixture(); t.after(f.stop); await f.open(); const read = await f.poll();
  await f.click('extension.image.returnPanel'); f.calls.at(-1).resolve({ ...session, windowOpen: false }); await f.settle();
  read.reject(new Error('late failure')); await f.settle();
  assert.equal(f.locked(), false); assert.equal(f.alert(), undefined); assert.equal(f.timers.size, 0); assert.deepEqual(f.restored, [session.document]);
});
