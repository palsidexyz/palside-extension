import test from "node:test";
import assert from "node:assert/strict";
import { avatarInitials } from "../packages/ui/src/internal/display-values.ts";

test("avatar fallbacks preserve graphemes and handle absent names", () => {
  assert.equal(avatarInitials("  Jun   Lee  "), "JL");
  assert.equal(avatarInitials("林安"), "林安");
  assert.equal(avatarInitials("e\u0301mil"), "E\u0301M");
  assert.equal(avatarInitials("👩🏽‍💻 Alice"), "👩🏽‍💻A");
  assert.equal(avatarInitials(" \n "), "");
  assert.equal(avatarInitials("ß a"), "SS");
});
