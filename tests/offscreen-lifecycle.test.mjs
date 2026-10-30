import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { languageGlobals } from './helpers/language-host.mjs';

const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function entrypoint() {
  const source = ts.createSourceFile('main.ts', readFileSync('apps/extension/entrypoints/offscreen/main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declarations = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n');
  return ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function offscreen({ fail = false } = {}) {
  const messages = [], instances = [], timers = []; let receive;
  class Service {
    state = { ready: false, revision: 0 };
    auth = { hostEpoch: 0 };
    attempts = 0;
    constructor() { instances.push(this); }
    subscribe(listener) { this.listener = listener; }
    async initialise() {
      this.attempts++;
      if (fail && this.attempts === 1) throw new languageGlobals.MessageError({ key: 'extension.runtime.storageOpenFailed' });
      this.state = { ...this.state, ready: true, revision: this.state.revision + 1 }; this.listener(this.state);
    }
    async command() { return this.state; }
    reset() { this.auth.hostEpoch++; this.state = { ...this.state, revision: this.state.revision + 1 }; this.listener(this.state); }
  }
  const browser = { runtime: {
    id: 'test', getURL: path => `chrome-extension://test${path}`,
    sendMessage: async message => { messages.push(message); },
    onMessage: { addListener(listener) { receive = listener; } },
  } };
  vm.runInNewContext(entrypoint(), { ...languageGlobals, browser, PalsideService: Service, crypto,
    createPatchSliceCache: () => ({}), diffState: (_before, state) => ({ revision: state.revision, state }),
    setTimeout: callback => timers.push(callback), window: { addEventListener() {} }, console,
  });
  const command = () => new Promise(resolve => receive({ target: 'palside/offscreen', command: { name: 'snapshot' } }, { id: 'test', url: 'chrome-extension://test/background.js' }, resolve));
  return { instances, messages, timers, command };
}

test('offscreen snapshot retry recovers failed startup in the same service and announces readiness once', async () => {
  const f = offscreen({ fail: true }); await drain();
  assert.equal(f.messages.filter(m => m.type === 'palside/runtime-error').length, 1);
  assert.equal(f.messages.filter(m => m.type === 'palside/runtime-ready').length, 0);
  const replies = await Promise.all([f.command(), f.command()]);
  assert.ok(replies.every(reply => reply.ok && reply.value.ready));
  assert.equal(f.instances.length, 1); assert.equal(f.instances[0].attempts, 2);
  const ready = f.messages.filter(m => m.type === 'palside/runtime-ready');
  assert.equal(ready.length, 1); assert.equal(typeof ready[0].epoch, 'string');
  await f.command(); assert.equal(f.instances[0].attempts, 2);
});

test('offscreen account resets announce distinct epochs even when state patches are coalesced', async () => {
  const f = offscreen(); await drain();
  f.instances[0].reset(); f.instances[0].reset(); await drain();
  const ready = f.messages.filter(m => m.type === 'palside/runtime-ready');
  assert.equal(ready.length, 3); assert.equal(new Set(ready.map(m => m.epoch)).size, 3);
  for (const message of ready) assert.equal(f.messages[f.messages.indexOf(message) - 1].type, 'palside/state-patch');
});

test('the existing loading retry button requests runtime startup before reloading its panel', async () => {
  const source = ts.createSourceFile('live-app.tsx', readFileSync('apps/extension/src/features/palside/app/live-app.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onClick') expression = node.initializer.expression.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const script = ts.transpileModule(`globalThis.retry = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fails of [false, true]) {
    const calls = [], release = Promise.withResolvers();
    const context = { command: name => { calls.push(name); return release.promise; }, location: { reload() { calls.push('reload'); } } };
    vm.runInNewContext(script, context); context.retry();
    assert.deepEqual(calls, ['snapshot']);
    if (fails) release.reject(Error('unavailable')); else release.resolve({ ready: true });
    await drain(); assert.deepEqual(calls, ['snapshot', 'reload']);
  }
});

test('offscreen creation shares the context check and retries a failed create without overlapping owners', async () => {
  const { createContext } = await import('../apps/extension/src/background/context.ts');
  let checks = 0, creates = 0, running = 0, peak = 0, exists = false;
  const checked = Promise.withResolvers();
  const browser = {
    action: { setTitle: async () => {} }, storage: { local: { get: async () => ({}) } },
    i18n: { getAcceptLanguages: async () => ['en'] },
    runtime: { getURL: path => path, async getContexts() { checks++; await checked.promise; return exists ? [{}] : []; } },
    offscreen: { async createDocument() { creates++; running++; peak = Math.max(peak, running); await Promise.resolve(); running--; if (creates === 1) throw Error('temporary failure'); exists = true; } },
  };
  const context = createContext({ browser });
  const first = assert.rejects(context.ensureRuntime(), /temporary failure/), second = assert.rejects(context.ensureRuntime(), /temporary failure/);
  assert.equal(checks, 1); checked.resolve(); await Promise.all([first, second]);
  await Promise.all([context.ensureRuntime(), context.ensureRuntime()]);
  await context.ensureRuntime();
  assert.equal(creates, 2); assert.equal(peak, 1); assert.equal(checks, 3);
});
