import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { overlayPosition } from "../packages/ui/src/internal/overlay-position.ts";

function productionFunction(path, name, context = {}) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === name);
  assert.ok(declaration, `${name} exists`);
  const code = ts.transpileModule(`${declaration.getText(source)}\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code, context);
}

test("anchored surfaces fit narrow viewports and flip above a bottom edge", () => {
  const result = overlayPosition({ left: 250, right: 312, top: 430, bottom: 470, width: 62 }, { width: 288, height: 180 }, { left: 0, top: 0, width: 320, height: 480 }, "end");
  assert.equal(result.side, "top");
  assert.ok(result.left >= 8 && result.left + result.width <= 312);
  assert.ok(result.top >= 8 && result.top + 180 <= 430);
});
test("surface constraints account for zoomed visual viewport offsets", () => {
  const result = overlayPosition({ left: 120, right: 170, top: 100, bottom: 140, width: 50 }, { width: 500, height: 500 }, { left: 100, top: 50, width: 200, height: 300 });
  assert.equal(result.width, 184);
  assert.ok(result.left >= 108 && result.left + result.width <= 292);
  assert.ok(result.top + result.maxHeight <= 342);
});

test("composed refs assign objects and invoke each callback's cleanup or null fallback", () => {
  const mergeRefs = productionFunction("../packages/ui/src/components/popover/popover.tsx", "mergeRefs");
  const object = { current: null }, node = {}, calls = [];
  const ref = mergeRefs(object, value => { calls.push(["assign", value]); return () => { calls.push(["cleanup"]); }; }, value => { calls.push(["fallback", value]); }, null, undefined);
  const cleanup = ref(node);
  assert.equal(object.current, node);
  assert.deepEqual(calls, [["assign", node], ["fallback", node]]);
  cleanup();
  assert.equal(object.current, null);
  assert.deepEqual(calls, [["assign", node], ["fallback", node], ["cleanup"], ["fallback", null]]);
  const replacement = {};
  const unmount = ref(replacement);
  assert.equal(object.current, replacement);
  unmount();
  assert.equal(object.current, null);
  assert.deepEqual(calls.slice(4), [["assign", replacement], ["fallback", replacement], ["cleanup"], ["fallback", null]]);
});

test("menu keys enter an unfocused list at either end and wrap enabled items", () => {
  const document = { activeElement: null };
  const moveFocus = productionFunction("../packages/ui/src/components/menu/menu.tsx", "moveFocus", { document, ITEM: "[role='menuitem']:not(:disabled)" });
  const items = Array.from({ length: 3 }, () => ({ focus() { document.activeElement = this; } }));
  let enabled = items;
  const currentTarget = { querySelectorAll() { return enabled; } };
  function press(key) {
    let prevented = false;
    moveFocus({ key, currentTarget, preventDefault() { prevented = true; } });
    return prevented;
  }
  assert.equal(press("ArrowUp"), true);
  assert.equal(document.activeElement, items[2]);
  press("ArrowDown"); assert.equal(document.activeElement, items[0]);
  press("ArrowUp"); assert.equal(document.activeElement, items[2]);
  document.activeElement = null;
  press("ArrowDown"); assert.equal(document.activeElement, items[0]);
  press("ArrowDown"); assert.equal(document.activeElement, items[1]);
  press("End"); assert.equal(document.activeElement, items[2]);
  press("Home"); assert.equal(document.activeElement, items[0]);
  enabled = [items[1]]; document.activeElement = null;
  press("ArrowUp"); assert.equal(document.activeElement, items[1]);
  press("ArrowDown"); assert.equal(document.activeElement, items[1]);
  assert.equal(press("Enter"), false);
  enabled = [];
  assert.equal(press("ArrowUp"), false);
});
