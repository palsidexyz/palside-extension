import test from "node:test";
import assert from "node:assert/strict";
import { imageFileError } from "../packages/ui/src/lib/image.ts";

test("image picker rejects unsupported, empty and oversized inputs before decoding", () => {
  assert.equal(imageFileError({ type: "image/png", size: 8 }, 10), undefined);
  assert.ok(imageFileError({ type: "image/svg+xml", size: 8 }, 10));
  assert.ok(imageFileError({ type: "image/webp", size: 11 }, 10));
  assert.ok(imageFileError({ type: "image/jpeg", size: 0 }, 10));
});
