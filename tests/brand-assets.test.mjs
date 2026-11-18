import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { brandIconSizes, renderBrandPng } from '../scripts/lib/brand-assets.mjs';

const source = await readFile(new URL('../packages/design/assets/brand/palside.svg', import.meta.url), 'utf8');

test('Chrome icons are small lossless RGBA images with a white P, visible eyes and transparent corners', async () => {
  for (const size of brandIconSizes) {
    const bytes = await renderBrandPng(source, size);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(bytes.length < (size === 128 ? 14_000 : 5_000));
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.equal(pixel(0, 0)[3], 0);
    assert.equal(pixel(size - 1, size - 1)[3], 0);
    const scale = size === 128 ? .8 : size / 128;
    const offset = size === 128 ? 12.8 : 0;
    const at = (x, y) => pixel(Math.floor(offset + x * scale), Math.floor(offset + y * scale));
    // The white P stands apart from the lime tile by its blue channel; the eyes stay dark on it even at 16px.
    const body = at(44, 72), tile = at(108, 24);
    assert.ok(body[2] > 200 && tile[2] < 60, `${size}px P must read white against the lime tile`);
    for (const x of [58, 75]) {
      const eye = at(x, 57);
      assert.ok(eye[0] < 120 && body[0] - eye[0] > 120, `${size}px eye must stay visible`);
    }
  }
});

test('store icon has exactly 16 transparent pixels around its 96px tile', async () => {
  const { data } = await sharp(await renderBrandPng(source, 128)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = [128, 128, -1, -1];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (!data[(y * 128 + x) * 4 + 3]) continue;
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  assert.deepEqual(bounds, [16, 16, 111, 111]);
});

test('PALS token image is an opaque 1024px full-bleed mark that survives a circle crop', async () => {
  const { renderTokenPng, tokenImageSize } = await import('../scripts/lib/brand-assets.mjs');
  const bytes = await renderTokenPng(source);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, tokenImageSize);
  assert.equal(info.height, tokenImageSize);
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  // Opaque lime corners and edges: nothing for a circle or square crop to cut into.
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023], [512, 2], [2, 512]]) {
    const [, g, b, a] = pixel(x, y);
    assert.ok(a === 255 && g > 180 && b < 90, `lime tile at ${x},${y}`);
  }
  const unit = tokenImageSize / 128;
  const body = pixel(Math.round(44 * unit), Math.round(72 * unit));
  assert.ok(body[2] > 200, 'white P body stays in place');
  for (const x of [58, 75]) assert.ok(pixel(Math.round(x * unit), Math.round(57 * unit))[0] < 60, 'eyes stay in place');
  // The whole P fits inside the inscribed circle.
  for (const [x, y] of [[47.5, 104.75], [99, 55.25], [48, 25.25], [32, 50]]) assert.ok(Math.hypot(x - 64, y - 64) < 62, `P point ${x},${y} inside the circle crop`);
});
