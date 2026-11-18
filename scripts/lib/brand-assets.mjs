import sharp from 'sharp';

export const brandIconSizes = [16, 24, 32, 48, 128];

/** The store's 128px canvas contains the 96px tile (the master's tile sits 4 units in); small toolbar icons use the master as drawn. */
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

/** Token lists crop to a circle or a square, so the mark sits on an opaque full-bleed tile at its master proportions; the P stays inside either crop. */
export async function renderTokenPng(source) {
  const tile = '<rect x="4" y="4" width="120" height="120" rx="30"/>';
  if (!source.includes(tile)) throw new Error('Brand master lacks the expected rounded tile');
  const svg = source.replaceAll(tile, '<rect x="-8" y="-8" width="144" height="144"/>').replace(/<rect x="4\.6"[^>]*\/>/, '');
  return sharp(Buffer.from(svg), { density: 72 * tokenImageSize / 128 })
    .resize(tokenImageSize, tokenImageSize, { kernel: 'lanczos3' })
    .flatten({ background: '#ADEB18' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}
