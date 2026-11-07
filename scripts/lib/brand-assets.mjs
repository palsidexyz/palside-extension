import sharp from 'sharp';

export const brandIconSizes = [16, 24, 32, 48, 128];

/** The store's 128px canvas contains 96px artwork; small toolbar icons stay compact. */
export async function renderBrandPng(source, size) {
  const svg = size === 128
    ? source.replace(/(<svg\b[^>]*>)/, '$1<g transform="translate(12.8 12.8) scale(.8)">').replace('</svg>', '</g></svg>')
    : source;
  return sharp(Buffer.from(svg), { density: 288 })
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}

export const tokenImageSize = 1024;

/** Token lists crop to a circle or a square, so the mark sits on an opaque full-bleed lime field at its master proportions. */
export async function renderTokenPng(source) {
  const svg = source.replace(/<rect x="4" y="4" width="120" height="120" rx="32" fill="(#[0-9A-Fa-f]{6})"\/>/, (_, fill) => `<rect width="128" height="128" fill="${fill}"/>`);
  if (svg === source) throw new Error('Brand master lacks the expected rounded tile');
  return sharp(Buffer.from(svg), { density: 72 * tokenImageSize / 128 })
    .resize(tokenImageSize, tokenImageSize, { kernel: 'lanczos3' })
    .flatten({ background: '#CCFF00' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}
