import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function pollingEffect(globals) {
  const file = 'apps/extension/src/features/palside/media/image-editor.tsx';
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes("command('image-session-read'")) effect = node.arguments[0].getText(source); ts.forEachChild(node, visit); }; visit(source);
  assert.ok(effect);
  return vm.runInNewContext(ts.transpileModule(`(${effect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}
test('image window status backs off to five seconds and pauses while hidden', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const document = new EventTarget(); document.visibilityState = 'visible'; const calls = [];
  const stop = pollingEffect({ document, setTimeout, clearTimeout, remote: { id: 'image' }, command: async () => { calls.push(Date.now()); return { windowOpen: true }; }, setFailure() {}, handlers: { current: {} }, text: value => value, errorMessage: value => value });
  for (const delay of [750, 1500, 3000, 5000, 5000]) { t.mock.timers.tick(delay); await drain(); }
  assert.deepEqual(calls, [750, 2250, 5250, 10250, 15250]);
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(20000); await drain(); assert.equal(calls.length, 5);
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await drain(); assert.equal(calls.length, 6);
  stop(); t.mock.timers.tick(20000); await drain(); assert.equal(calls.length, 6);
});
