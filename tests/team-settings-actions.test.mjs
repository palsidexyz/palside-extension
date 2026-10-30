import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../apps/extension/src/features/palside/teams/team-settings.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const app = ts.createSourceFile('palside-app.tsx', readFileSync(new URL('../apps/extension/src/features/palside/app/palside-app.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dialog;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === 'AlertDialog') dialog = node;
  ts.forEachChild(node, visit);
}
visit(app);
assert.ok(dialog);
const dialogCode = ts.transpileModule(`(${dialog.getText(app)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
const message = (key, values) => ({ key, ...(values ? { values } : {}) });
const errorMessage = error => message(error.code || 'common.error');
const text = value => value?.key ?? value;
function find(node, type) {
  if (!node || typeof node !== 'object') return;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, type);
    if (found) return found;
  }
}

// Render the production JSX with the same lightweight hook/host boundary used by feature tests.
function fixture({ retention = 7, live = true } = {}) {
  const hooks = [];
  let cursor = 0;
  const calls = [];
  let command = async () => {};
  const c = {
    team: { id: 'team', owner: 'self', name: 'Squad', memberIds: [], retentionDays: retention },
    current: 'team', data: { self: 'self' }, canWrite: true, requests: [],
    setConfirmation(value) { c.confirmation = value; },
    setTeams(update) { c.teams = update(c.teams); c.team = c.teams[0]; },
  };
  c.teams = [c.team, { id: 'other', retentionDays: 14 }];
  if (live) c.live = { state: { remoteTeams: [] }, command: (...args) => { calls.push(args); return command(...args); } };
  const context = {
    exports: {}, Error,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
        useState(value) { const index = cursor++; if (!(index in hooks)) hooks[index] = value; return [hooks[index], next => { hooks[index] = next; }]; },
      };
      if (name === '@palside/i18n') return { message, errorMessage };
      if (name === 'use-intl') return { useTranslations: () => key => key };
      if (name === '../ui/text') return { useText: () => text };
      if (name === './retention') return { defaultRetentionDays: 7, retentionOptions: [1, 7, 14, 30], retentionPeriod: days => message(`retention.${days}`) };
      if (name.endsWith('.css')) return { default: {} };
      return new Proxy({}, { get: (_, key) => key === 'settingRows' ? {} : key });
    },
  };
  vm.runInNewContext(compiled, context);
  const confirmationContext = vm.createContext({ exports: {}, c, Error, uiMessage: message, errorMessage, text, t: key => key, AlertDialog: 'AlertDialog', confirmBusy: false, confirmFailure: undefined, require: () => ({ jsx }) });
  confirmationContext.setConfirmBusy = value => { confirmationContext.confirmBusy = value; };
  confirmationContext.setConfirmFailure = value => { confirmationContext.confirmFailure = value; };
  const render = () => { cursor = 0; return context.exports.TeamSettings({ c }); };
  const select = () => find(render(), 'ValueSelect').props;
  const confirmation = () => vm.runInContext(`{${dialogCode}}`, confirmationContext).props;
  return { c, calls, select, confirmation, change: days => select().onChange({ target: { value: String(days) } }), command: fn => { command = fn; } };
}
const drain = () => new Promise(resolve => setImmediate(resolve));

for (const failure of [Object.assign(new Error('offline'), { code: 'CONNECTION_UNAVAILABLE' }), 'offline']) {
  test(`rejected increase opens existing error dialog and retry is handled (${typeof failure})`, async () => {
    const f = fixture();
    f.command(async () => { throw failure; });
    f.change(14);
    await drain();
    assert.equal(f.confirmation().open, true);
    assert.equal(f.confirmation().description, failure.code ?? 'common.error');
    assert.equal(f.confirmation().confirmLabel, 'common.retry');
    assert.equal(f.select().disabled, false);
    assert.equal(f.c.team.retentionDays, 7);
    await f.confirmation().onConfirm();
    assert.equal(f.confirmation().error, failure.code ?? 'common.error');
    assert.equal(f.confirmation().open, true);
    f.command(async () => {});
    await f.confirmation().onConfirm();
    assert.equal(f.confirmation().open, false);
  });
}

test('decrease waits for confirmation, preserves failure feedback, and can succeed on retry', async () => {
  const f = fixture({ retention: 14 });
  f.command(async () => { throw Object.assign(new Error('offline'), { code: 'CONNECTION_UNAVAILABLE' }); });
  f.change(7);
  assert.equal(f.calls.length, 0);
  assert.equal(f.confirmation().title, 'extension.copy.retentionShorterTitle');
  await f.confirmation().onConfirm();
  assert.equal(f.confirmation().error, 'CONNECTION_UNAVAILABLE');
  assert.equal(f.confirmation().open, true);
  assert.equal(f.select().disabled, false);
  assert.equal(f.c.team.retentionDays, 14);
  f.command(async () => {});
  await f.confirmation().onConfirm();
  assert.equal(f.confirmation().open, false);
});

for (const live of [true, false]) test(`successful increase and confirmed decrease (${live ? 'live' : 'preview'})`, async () => {
  const f = fixture({ live });
  f.change(7);
  assert.equal(f.calls.length, 0);
  f.change(14);
  await drain();
  assert.equal(f.c.confirmation, undefined);
  f.change(1);
  await f.confirmation().onConfirm();
  assert.equal(f.c.confirmation, undefined);
  assert.equal(f.select().disabled, false);
  if (live) assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ['retention', { teamId: 'team', retentionDays: 14 }],
    ['retention', { teamId: 'team', retentionDays: 1 }],
  ]);
  else assert.deepEqual(f.c.teams.map(team => team.retentionDays), [1, 14]);
});

for (const days of [1, 14]) test(`pending ${days < 7 ? 'decrease' : 'increase'} blocks same-tick and rerendered conflicting actions`, async () => {
  const f = fixture();
  let resolve;
  f.command(() => new Promise(done => { resolve = done; }));
  const staleSelect = f.select();
  f.change(days);
  const pending = days < 7 ? f.confirmation().onConfirm() : undefined;
  staleSelect.onChange({ target: { value: '30' } });
  f.change(1);
  f.change(14);
  if (days < 7) await f.c.confirmation.confirm();
  assert.equal(f.calls.length, 1);
  assert.equal(f.select().disabled, true);
  resolve();
  await pending;
  await drain();
  assert.equal(f.select().disabled, false);
  f.command(async () => {});
  f.change(30);
  await drain();
  assert.equal(f.calls.length, 2);
});
