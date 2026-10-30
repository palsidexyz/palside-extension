import test from "node:test";
import assert from "node:assert/strict";
import { textLength, lengthState, describedBy } from "../packages/ui/src/internal/form-values.ts";

test("length hints count complete graphemes without truncating Chinese or emoji input", () => {
  for (const [value, expected] of [["", 0], ["你好", 2], ["e\u0301", 1], ["👩🏽‍💻", 1], ["👨‍👩‍👧‍👦🇨🇳", 2], ["一\n二", 3]]) assert.equal(textLength(value), expected);
  assert.deepEqual(lengthState("👩🏽‍💻你好", 2), { count: 3, maximum: 2, remaining: 0, exceeded: true });
  assert.deepEqual(lengthState("你好", 2), { count: 2, maximum: 2, remaining: 0, exceeded: false });
});
test("description associations preserve external ids without duplicates", () => {
  assert.equal(describedBy("external hint", "hint", undefined, "error count"), "external hint error count");
  assert.equal(describedBy(undefined, "  "), undefined);
});
