import { productionModules } from './helpers/production-module.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { languageGlobals } from './helpers/language-host.mjs';
import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import { imageSource } from '../apps/extension/src/runtime/media/image-sessions.ts';

const original = 'data:image/png;base64,AA==';
const edited = 'data:image/png;base64,AQ==';
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map(fn => fn(...args)); } }; }
function fixture() {
  const calls = [], windows = [], removed = [], revoked = [];
  let save = async () => ({ ok: true });
  let flush = async () => ({ ok: true });
  let state = { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false }, account: { id: 'alice' }, preferences: { current: 'one', web: { share: true, interact: true }, notifications: 'off' }, toggles: { share: false, interact: false }, remoteTeams: [{ id: 'one', joined: true }, { id: 'two', joined: true }], items: { danmaku: [], stickies: [] }, data: { views: [], messages: [], people: [] }, drafts: { one: { revision: 4, value: { text: 'keep my text', attachment: { kind: 'image', src: original, name: 'original.png' } } } } };
  const browser = {
    runtime: { id: 'qa', getURL: value => `chrome-extension://qa${value}`, getContexts: async () => [{}], sendMessage: async ({ command, type, id }) => { if (type === 'palside/image-revoke') { revoked.push(id); return { ok: true }; } if (type === 'palside/image-flush') return flush(id); calls.push(command); return command.name === 'snapshot' ? { ok: true, value: state } : command.name === 'image-draft-save' ? save(command) : { ok: true }; }, onMessage: event(), onMessageExternal: event(), onConnect: event(), onInstalled: event() },
    tabs: { query: async () => [], onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { create: async options => { const window = { id: 100 + windows.length }; windows.push({ ...options, ...window }); return window; }, remove: async id => { removed.push(id); browser.windows.onRemoved.emit(id); }, get: async id => ({ id }), onRemoved: event(), onFocusChanged: event() },
    sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => [] },
    action: { onClicked: event() }, permissions: { contains: async () => false, onAdded: event(), onRemoved: event() },
    idle: { queryState: async () => 'active', onStateChanged: event() },
  };
  addBackgroundHost(browser);
  startWorker(browser);
  const panel = { id: 'qa', url: 'chrome-extension://qa/sidepanel.html' };
  const sendState = stateSender(browser);
  const broadcast = () => sendState(state);
  broadcast();
  const command = (name, payload = {}, sender = panel) => new Promise(resolve => { const handled = browser.runtime.onMessage.emit({ type: 'palside/command', command: { name, payload } }, sender, resolve); if (!handled.includes(true)) resolve(undefined); });
  const open = (patch = {}) => command('image-session-open', { teamId: 'one', mode: 'edit', source: { src: original, name: 'original.png' }, ...patch });
  const image = (id, windowId = 100) => ({ id: 'qa', url: `chrome-extension://qa/image.html?session=${id}`, tab: { id: 20, windowId } });
  return { browser, calls, windows, removed, revoked, command, open, image, panel, state: () => state, update: patch => { state = { ...state, ...patch }; broadcast(); }, setSave: fn => { save = fn; }, setFlush: fn => { flush = fn; } };
}

test('image open proves source ownership and creates a popup with initial document', async () => {
  const f = fixture();
  for (const patch of [{ teamId: 'unknown' }, { source: { src: edited, name: 'unowned' } }, { mode: 'other' }]) assert.equal((await f.open(patch)).ok, false);
  const opened = await f.open({ document: { ops: [{ kind: 'pen' }] } });
  assert.equal(opened.ok, true); assert.equal(opened.value.revision, 1); assert.equal(opened.value.draftRevision, 4);
  assert.equal(opened.value.windowOpen, true); assert.equal(opened.value.document.ops[0].kind, 'pen');
  assert.equal(f.windows[0].url, `chrome-extension://qa/image.html?session=${opened.value.id}`);
  assert.equal(f.windows[0].type, 'popup'); assert.equal(f.windows[0].width, 1100); assert.equal(f.windows[0].height, 800);
});

test('exact sender path and popup binding prevent image windows from forwarding business commands', async () => {
  const f = fixture(); const id = (await f.open()).value.id;
  assert.equal(await f.command('logout', {}, { ...f.panel, url: `${f.panel.url}.evil` }), undefined);
  assert.equal(await f.command('image-session-open', {}, { ...f.panel, url: 'https://qa/sidepanel.html' }), undefined);
  assert.equal((await f.command('logout', {}, f.image(id))).ok, false);
  assert.equal((await f.command('image-session-open', {}, f.image(id))).ok, false);
  assert.equal((await f.command('image-session-read', { id }, f.image(id, 999))).ok, false);
  assert.equal((await f.command('image-session-read', { id }, f.image('different'))).ok, false);
  assert.equal((await f.command('image-session-update', { id, expectedRevision: 0, document: {} })).ok, false);
  assert.equal(f.calls.some(command => command.name === 'logout'), false);
});

test('view sessions accept only readable drafts or messages and cannot save', async () => {
  const f = fixture(); f.update({ drafts: {}, data: { ...f.state().data, messages: [{ id: 'm', teamId: 'one', attachment: { kind: 'image', src: original } }] } });
  const id = (await f.open({ mode: 'view' })).value.id;
  assert.equal((await f.command('image-session-save', { id, expectedRevision: 0, src: edited }, f.image(id))).code, 'IMAGE_SESSION_READ_ONLY');
  f.update({ data: { ...f.state().data, messages: [{ id: 'm', teamId: 'one', recalled: true, attachment: { kind: 'image', src: original } }] } });
  assert.equal((await f.open({ mode: 'view' })).ok, false);
});

test('save forwards strict original draft CAS, preserves open session on refusal and closes it once saved', async () => {
  const f = fixture(); const id = (await f.open()).value.id; const sender = f.image(id);
  f.setSave(async () => ({ ok: false, message: 'changed', text: { key: 'extension.runtime.draftChanged' } }));
  assert.equal((await f.command('image-session-save', { id, expectedRevision: 0, src: edited }, sender)).ok, false);
  assert.equal((await f.command('image-session-read', { id })).value.status, 'open');
  f.setSave(async () => ({ ok: true }));
  assert.equal((await f.command('image-session-save', { id, expectedRevision: 0, src: edited }, sender)).value.status, 'saved');
  const payload = f.calls.filter(command => command.name === 'image-draft-save').at(-1).payload;
  assert.equal(payload.accountId, 'alice'); assert.equal(payload.teamId, 'one'); assert.equal(payload.source, original); assert.equal(payload.draftRevision, 4); assert.equal(payload.src, edited);
  assert.equal((await f.command('image-session-update', { id, expectedRevision: 1, document: {} }, sender)).code, 'IMAGE_SESSION_CLOSED');
  assert.equal((await f.command('image-session-save', { id, expectedRevision: 1, src: edited }, sender)).code, 'IMAGE_SESSION_CLOSED');
});

test('save is serialized with update and rejects malformed output before any draft write', async () => {
  const f = fixture(); const id = (await f.open()).value.id; const sender = f.image(id);
  assert.equal((await f.command('image-session-save', { id, expectedRevision: 0, src: 'data:text/html;base64,AA==' }, sender)).code, 'IMAGE_SESSION_INVALID');
  assert.equal(f.calls.some(command => command.name === 'image-draft-save'), false);
  let finish; f.setSave(() => new Promise(resolve => { finish = resolve; }));
  const saving = f.command('image-session-save', { id, expectedRevision: 0, src: edited }, sender);
  await new Promise(resolve => setImmediate(resolve));
  const updating = f.command('image-session-update', { id, expectedRevision: 0, document: {} }, sender);
  finish({ ok: true });
  assert.equal((await saving).ok, true); assert.equal((await updating).code, 'IMAGE_SESSION_CLOSED');
});

test('return flushes renderer pending edits without holding the session queue', async () => {
  const f = fixture(); const id = (await f.open()).value.id;
  f.setFlush(async sessionId => {
    assert.equal(sessionId, id);
    const updated = await f.command('image-session-update', { id, expectedRevision: 0, document: { lastStroke: true } }, f.image(id));
    assert.equal(updated.ok, true);
    return { ok: true };
  });
  const result = await f.command('image-session-return', { id });
  assert.equal(result.value.document.lastStroke, true); assert.equal(result.value.windowOpen, false);
});

test('failed flush preserves live popup; a manually closed popup may return saved document', async () => {
  const f = fixture(); const id = (await f.open()).value.id;
  f.setFlush(async () => { throw new Error('lost response'); });
  assert.equal((await f.command('image-session-return', { id })).ok, false);
  assert.equal((await f.command('image-session-read', { id })).value.windowOpen, true); assert.equal(f.removed.length, 0);
  f.setFlush(async () => { f.browser.windows.onRemoved.emit(100); throw new Error('closed while flushing'); });
  const returned = await f.command('image-session-return', { id });
  assert.equal(returned.ok, true); assert.equal(returned.value.windowOpen, false);
});

test('return and read wait for an in-flight save before restoring the side panel', async () => {
  for (const action of ['image-session-return', 'image-session-read']) {
    const f = fixture(); const id = (await f.open()).value.id;
    let finish; f.setSave(() => new Promise(resolve => { finish = resolve; }));
    const saving = f.command('image-session-save', { id, expectedRevision: 0, src: edited }, f.image(id));
    await new Promise(resolve => setImmediate(resolve));
    if (action === 'image-session-read') f.browser.windows.onRemoved.emit(100);
    let settled = false;
    const handingBack = f.command(action, { id }).then(result => { settled = true; return result; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    finish({ ok: true }); await saving;
    const result = await handingBack;
    assert.equal(result.value.status, 'saved'); assert.equal(result.value.windowOpen, false);
  }
});

test('manual close and explicit return retain latest document while revoking popup writes', async () => {
  for (const close of ['manual', 'return']) {
    const f = fixture(); const id = (await f.open()).value.id; const sender = f.image(id);
    await f.command('image-session-update', { id, expectedRevision: 0, document: { ops: ['latest'] } }, sender);
    if (close === 'manual') f.browser.windows.onRemoved.emit(100);
    else assert.equal((await f.command('image-session-return', { id })).value.windowOpen, false);
    const recovered = (await f.command('image-session-read', { id })).value;
    assert.equal(recovered.document.ops[0], 'latest'); assert.equal(recovered.status, 'open'); assert.equal(recovered.windowOpen, false);
    assert.equal((await f.command('image-session-update', { id, expectedRevision: 1, document: {} }, sender)).ok, false);
  }
});

test('account transitions and logout invalidate old sessions even after the same account returns', async () => {
  for (const invalidate of [f => f.update({ authenticated: false }), f => f.update({ account: { id: 'bob' } }), f => f.command('logout')]) {
    const f = fixture(); const id = (await f.open()).value.id;
    await invalidate(f); f.update({ authenticated: true, account: { id: 'alice' } });
    assert.equal((await f.command('image-session-read', { id })).ok, false);
  }
});

function draftFixture() {
  let saved = { revision: 4, value: { text: 'original text', replyTo: 'reply', attachment: { kind: 'image', name: 'original.png', src: original } } };
  const writes = [];
  const scope = { wait: promise => promise, check() {} };
  const runtime = { initialise: async () => {}, auth: { session: { account: { id: 'alice' } }, scope: () => scope }, state: { remoteTeams: [{ id: 'one', joined: true }], drafts: {} }, emit() {}, storage: {
    get: async () => saved,
    updateDraft: async (accountId, teamId, patch, revision) => { if (revision !== saved.revision) throw new Error('draft conflict'); writes.push(patch); return saved = { ...saved, revision: saved.revision + 1, value: { ...saved.value, ...patch } }; },
  } };
  const Commands = productionModules({ ...languageGlobals, imageSource })('apps/extension/src/runtime/composition/dispatch.ts').RuntimeCommands;
  const commands = new Commands(runtime);
  return { runtime, writes, commands, saved: () => saved, execute: patch => commands.execute({ name: 'image-draft-save', payload: { accountId: 'alice', teamId: 'one', source: original, draftRevision: 4, src: edited, ...patch } }) };
}

test('runtime image save rejects changed account, membership, source and revision', async () => {
  for (const patch of [{ accountId: 'bob' }, { teamId: 'gone' }, { source: edited }, { draftRevision: 3 }, { src: 'data:text/html;base64,AA==' }]) {
    const f = draftFixture(); await assert.rejects(f.execute(patch)); assert.equal(f.writes.length, 0);
  }
});

test('runtime image save patches only attachment and preserves text, reply and image name', async () => {
  const f = draftFixture(); const result = await f.execute();
  assert.equal(result.draftRevision, 5); assert.deepEqual(Object.keys(f.writes[0]), ['attachment']);
  assert.equal(f.saved().value.text, 'original text'); assert.equal(f.saved().value.replyTo, 'reply');
  assert.equal(f.saved().value.attachment.name, 'original.png'); assert.equal(f.saved().value.attachment.src, edited);
  await assert.rejects(f.execute()); assert.equal(f.writes.length, 1);
});


test('loaded image popups receive explicit revoke and close on logout or account switch even if closing fails', async () => {
  for (const closeFails of [false, true]) for (const invalidate of [f => f.update({ authenticated: false }), f => f.update({ account: { id: 'bob' } }), f => f.command('logout')]) {
    const f = fixture(); const id = (await f.open()).value.id;
    const loaded = await f.command('image-session-read', { id }, f.image(id));
    assert.equal(loaded.value.source.src, original);
    if (closeFails) f.browser.windows.remove = async windowId => { f.removed.push(windowId); throw Error('close failed'); };
    await invalidate(f); await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.revoked.includes(id)); assert.deepEqual(f.removed, [100]);
    assert.equal((await f.command('image-session-read', { id }, f.image(id))).ok, false);
  }
});

function rendererFixture() {
  const source = ts.createSourceFile('main.tsx', readFileSync('apps/extension/entrypoints/image/main.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Session').getText(source);
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const slots = [], effects = [], commands = [], refs = [];
  let cursor = 0, initial = true;
  const runtimeMessages = new Set(), portMessages = new Set(), disconnects = new Set();
  const events = listeners => ({ addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) });
  const port = { onDisconnect: events(disconnects), onMessage: events(portMessages), disconnect() {} };
  const canvas = { width: 100, height: 100 }, pixels = { src: original, removeAttribute() { this.src = undefined; } };
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' };
  const context = {
    React, URL, location: { href: 'chrome-extension://qa/image.html?session=session' },
    useTranslations: () => key => key, useText: () => value => value?.key ?? value,
    useState(value) { const index = cursor++; if (initial) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = next; }]; },
    useRef(value) { const index = cursor++; if (initial) { slots[index] = { current: value }; refs.push(slots[index]); } return slots[index]; },
    useEffect(effect) { if (initial) effects.push(effect); }, flushSync: fn => fn(),
    browser: { runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}`, onMessage: events(runtimeMessages), connect: () => port } },
    command: (name, payload) => new Promise((resolve, reject) => commands.push({ name, payload, resolve, reject })),
    document: { querySelectorAll: selector => selector === 'canvas' ? [canvas] : [pixels] },
    window: { addEventListener() {}, removeEventListener() {}, close() {} },
    errorMessage: () => ({ key: 'common.error' }), ImageEditor: 'ImageEditor', Button: 'Button',
  };
  const Session = vm.runInNewContext(`${compiled}; Session`, context);
  function render() { cursor = 0; const view = Session(); initial = false; return view; }
  render(); const cleanup = effects.map(effect => effect()).filter(Boolean);
  const revoke = () => { for (const listener of runtimeMessages) listener({ type: 'palside/image-revoke', id: 'session' }, { id: 'qa' }, () => {}); };
  const disconnect = () => { for (const listener of disconnects) listener(); };
  const load = () => commands[0].resolve({ id: 'session', status: 'open', revision: 0, source: { src: original }, document: { ops: ['private'] }, mode: 'edit' });
  return { render, revoke, disconnect, load, commands, refs, canvas, pixels, cleanup };
}
const settleRenderer = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('loaded image renderer clears session, document and pixels before showing its existing ended state', async () => {
  for (const end of ['revoke', 'disconnect']) {
    const f = rendererFixture(); f.load(); await settleRenderer();
    const editor = f.render().children[0]; assert.equal(editor.type, 'ImageEditor');
    editor.props.documentRef.current = () => ({ private: true });
    editor.props.onDocumentChange({ ops: ['pending'] }); await settleRenderer();
    assert.equal(f.commands[1].name, 'image-session-update');
    f[end]();
    assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0); assert.equal(f.pixels.src, undefined);
    assert.equal(editor.props.documentRef.current, undefined);
    const ended = f.render(); assert.equal(ended.props.role, 'status'); assert.equal(ended.children[0].children[0], 'extension.image.sessionEnded');
    f.commands[1].resolve({ id: 'session', status: 'open', source: { src: original } }); await settleRenderer();
    assert.equal(f.render().props.role, 'status');
    assert.equal(f.refs.some(ref => ref.current?.source?.src === original || ref.current?.ops), false);
    for (const cleanup of f.cleanup) cleanup();
  }
});

test('image renderer ignores a read delivered after revoke or background disconnect', async () => {
  for (const end of ['revoke', 'disconnect']) {
    const f = rendererFixture(); f[end](); f.load(); await settleRenderer();
    assert.equal(f.render().props.role, 'status'); assert.equal(f.render().children[0].children[0], 'extension.image.sessionEnded');
    assert.equal(f.refs.some(ref => ref.current?.source?.src === original), false);
    for (const cleanup of f.cleanup) cleanup();
  }
});

test('image lifecycle ports revoke loaded windows and reject sessions absent after a worker restart', async () => {
  const f = fixture(); const id = (await f.open()).value.id;
  const messages = [];
  const port = { name: 'palside/image', sender: f.image(id), onDisconnect: event(), postMessage: value => messages.push(value.type) };
  f.browser.runtime.onConnect.emit(port); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(messages, ['ready']);
  await f.command('logout'); assert.deepEqual(messages, ['ready', 'revoke']);
  const restarted = fixture(), rejected = [];
  restarted.browser.runtime.onConnect.emit({ ...port, postMessage: value => rejected.push(value.type), onDisconnect: event() });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(rejected, ['revoke']);
});

test('an expired image session revokes and closes its window before the binding is dropped', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture(); const first = (await f.open()).value.id;
  now += 25 * 3600_000;
  await f.open();
  assert.ok(f.revoked.includes(first)); assert.deepEqual(f.removed, [100]);
  await f.command('logout'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.removed, [100, 101]);
});
