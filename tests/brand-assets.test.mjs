import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { brandIconSizes, renderBrandPng } from '../scripts/lib/brand-assets.mjs';

const source = await readFile(new URL('../packages/design/assets/brand/palside.svg', import.meta.url), 'utf8');

test('Chrome icons are small lossless RGBA images with visible eyes and transparent corners', async () => {
  for (const size of brandIconSizes) {
    const bytes = await renderBrandPng(source, size);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(bytes.length < (size === 128 ? 10_000 : 5_000));
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.equal(pixel(0, 0)[3], 0);
    assert.equal(pixel(size - 1, size - 1)[3], 0);
    const scale = size === 128 ? .8 : size / 128;
    const offset = size === 128 ? 12.8 : 0;
    for (const x of [53, 75]) {
      const eye = pixel(Math.floor(offset + x * scale), Math.floor(offset + 56 * scale));
      // At 16px each 1.25px-wide eye straddles rows; antialiasing mixes in the dark body.
      assert.ok(eye[1] > 100 && eye[1] > eye[2] + 80, `${size}px eye must stay visible`);
    }
  }
});

test('store icon has exactly 16 transparent pixels around its 96px artwork', async () => {
  const { data } = await sharp(await renderBrandPng(source, 128)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = [128, 128, -1, -1];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (!data[(y * 128 + x) * 4 + 3]) continue;
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  assert.deepEqual(bounds, [16, 16, 111, 111]);
});
