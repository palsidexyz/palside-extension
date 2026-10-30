import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the registered handler itself with no ambient page or extension authority.
const actions = new Set(['click', 'dblclick', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'keydown', 'keyup', 'wheel', 'input', 'mouseenter', 'mouseleave', 'dragstart', 'selectstart']);
for (const file of ['page-layer/signals', 'page-layer/capture', 'runtime/media/image-workspace', 'page-layer/picker', 'page-layer/danmaku-renderer', 'page-layer/sticky-projection', 'page-layer/reference-outline', 'page-layer/selection-menu']) {
  test(`${file} user-action listeners return before touching state for synthetic events`, () => {
    const source = ts.createSourceFile(file + '.ts', readFileSync(new URL(`../apps/extension/src/${file}.ts`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const definitions = new Map(), listeners = [];
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && node.name) definitions.set(node.name.text, node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) definitions.set(node.name.text, node.initializer);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addEventListener' && ts.isStringLiteral(node.arguments[0]) && actions.has(node.arguments[0].text)) listeners.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(listeners.length > 0);
    for (const listener of listeners) {
      const handler = listener.arguments[1];
      const fn = ts.isIdentifier(handler) ? definitions.get(handler.text) : handler;
      assert.ok(fn, listener.getText(source));
      const expression = ts.transpileModule(`const handler = (${fn.getText(source)}); handler;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const callback = vm.runInNewContext(expression, {});
      assert.doesNotThrow(() => callback({ isTrusted: false, type: listener.arguments[0].text }), listener.getText(source));
    }
  });
}
