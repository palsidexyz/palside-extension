import sharp from 'sharp';

/** The largest ICO frame: embedded PNG frames pass through, 32-bit BMP frames become raw RGBA. */
function largestIcoFrame(bytes) {
  let best;
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const at = 6 + i * 16, width = bytes[at] || 256;
    if (!best || width > best.width) best = { width, data: bytes.subarray(bytes.readUInt32LE(at + 12), bytes.readUInt32LE(at + 12) + bytes.readUInt32LE(at + 8)) };
  }
  if (!best) throw new Error('Empty ICO');
  if (best.data.readUInt32BE(0) === 0x89504e47) return { input: best.data };
  const header = best.data.readUInt32LE(0), width = best.data.readInt32LE(4), height = best.data.readInt32LE(8) / 2;
  if (best.data.readUInt16LE(14) !== 32) throw new Error('Unsupported ICO bit depth');
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = header + ((height - 1 - y) * width + x) * 4, to = (y * width + x) * 4;
    rgba[to] = best.data[from + 2]; rgba[to + 1] = best.data[from + 1]; rgba[to + 2] = best.data[from]; rgba[to + 3] = best.data[from + 3];
  }
  return { input: rgba, options: { raw: { width, height, channels: 4 } } };
}

/** Decodes an official icon (SVG, ICO or raster) at its own resolution; SVG renders at 512px. */
export async function decodeSiteLogo(bytes) {
  if (bytes.subarray(0, 512).toString('utf8').includes('<svg')) {
    const probe = await sharp(bytes).metadata();
    return sharp(bytes, { density: Math.min(2400, Math.ceil(72 * 512 / Math.max(probe.width, probe.height))) });
  }
  if (bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) { const frame = largestIcoFrame(bytes); return sharp(frame.input, frame.options); }
  return sharp(bytes, { pages: 1 });
}

export const SITE_LOGO_SIZE = 96;

/**
 * One rule for every site logo: transparent margins trimmed, aspect kept, centered on a 96×96 transparent canvas,
 * original colors, lossless WebP. Opaque icons (app-icon squares) keep their background untouched.
 */
export async function normalizeSiteLogo(bytes) {
  const decoded = await decodeSiteLogo(bytes);
  const { data, info } = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let image = sharp(data, { raw: info });
  if (data[3] === 0) image = sharp(await image.trim({ threshold: 1 }).png().toBuffer());
  const { width, height } = await image.metadata();
  const scale = Math.min(SITE_LOGO_SIZE / width, SITE_LOGO_SIZE / height);
  const fitted = await image.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { kernel: 'lanczos3' }).png().toBuffer();
  return {
    source: { width, height },
    output: await sharp({ create: { width: SITE_LOGO_SIZE, height: SITE_LOGO_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fitted, gravity: 'center' }]).webp({ lossless: true, effort: 6 }).toBuffer(),
  };
}
