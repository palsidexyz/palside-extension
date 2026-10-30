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
