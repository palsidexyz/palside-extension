/**
 * A non-catalog site's icon, kept on this device only: a small image data URL and, like catalog logos, the plate a nearly
 * all-black (`light`) or all-white (`dark`) mark needs in the theme it would vanish in.
 */
export type SiteIcon = { src: string; plate?: 'light' | 'dark' };

/** Icons are drawn at most 40px; 64px covers 1.5x screens. */
export const SITE_ICON_SIZE = 64;
/** The largest data URL kept for one site. */
export const SITE_ICON_LENGTH = 16_384;
/** How much of a homepage is read for its `<link rel="icon">` tags; they live in the head. */
export const SITE_ICON_HEAD = 262_144;

const relIcon = /^(?:icon|apple-touch-icon(?:-precomposed)?)$/;

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3])!.replace(/&amp;/g, '&').trim() : undefined;
}

/**
 * The icon addresses a homepage declares, best first, then `/favicon.ico`: the smallest raster of at least 64px, an SVG, then
 * smaller rasters by size. `apple-touch-icon` without `sizes` counts as 180px. Only https addresses and small image data URLs.
 */
export function iconCandidates(html: string, base: string): string[] {
  const found: { url: string; score: number }[] = [];
  for (const [tag] of html.slice(0, SITE_ICON_HEAD).matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.some(value => relIcon.test(value))) continue;
    const href = attribute(tag, 'href');
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.protocol === 'data:' ? !/^data:image\//i.test(href) || href.length > SITE_ICON_LENGTH : url.protocol !== 'https:') continue;
    const sizes = (attribute(tag, 'sizes') ?? '').toLowerCase();
    const svg = (attribute(tag, 'type') ?? '').toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(url.pathname) || /^data:image\/svg/i.test(href);
    const declared = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map(match => Number(match[1])));
    const size = declared || (rel.some(value => value.startsWith('apple-touch-icon')) ? 180 : 0);
    const score = svg || sizes === 'any' ? 2000 : size >= SITE_ICON_SIZE ? 4000 - size : size ? 1000 + size : 500;
    found.push({ url: url.href, score });
  }
  const urls = found.sort((a, b) => b.score - a.score).map(item => item.url);
  try { urls.push(new URL('/favicon.ico', base).href); } catch { /* no base, no fallback */ }
  return [...new Set(urls)];
}

/**
 * The plate an icon needs, from its RGBA pixels: `light` when nearly every visible pixel is near black, `dark` when near white.
 * An empty or fully transparent image has none.
 */
export function iconPlate(pixels: ArrayLike<number>): SiteIcon['plate'] {
  let visible = 0, black = 0, white = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    visible++;
    const luminance = (0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!) / 255;
    if (luminance < 0.18) black++;
    else if (luminance > 0.88) white++;
  }
  if (!visible) return undefined;
  return black / visible >= 0.9 ? 'light' : white / visible >= 0.9 ? 'dark' : undefined;
}

/** A stored entry as the panel may draw it: a small image data URL and a known plate, else nothing. */
export function readSiteIcon(value: unknown): SiteIcon | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { src, plate } = value as Record<string, unknown>;
  if (typeof src !== 'string' || !/^data:image\/(?:png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > SITE_ICON_LENGTH) return undefined;
  return plate === 'light' || plate === 'dark' ? { src, plate } : { src };
}

/** How a site's own icon is drawn: `glyph` when it has transparent corners — a mark, drawn bare like a tab's favicon — else a
 *  full tile that fills the face. A glyph that is nearly all white or all black takes the plate of the theme it would vanish in. */
export type IconFace = { glyph: boolean; plate?: SiteIcon['plate'] };

/** The share of a mark's visible pixels that must be near black or near white for it to need a plate. */
const GLYPH_TONE = 0.8;

/** Reads {@link IconFace} from square RGBA pixels `size` wide. */
export function iconFace(pixels: ArrayLike<number>, size: number): IconFace {
  const alpha = (x: number, y: number) => pixels[(y * size + x) * 4 + 3] ?? 0;
  const edge = Math.min(1, size - 1), far = size - 1 - edge;
  const glyph = [alpha(edge, edge), alpha(far, edge), alpha(edge, far), alpha(far, far)].some(value => value < 128);
  if (!glyph) return { glyph };
  let visible = 0, black = 0, white = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    visible++;
    const luminance = (0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!) / 255;
    if (luminance < 0.2) black++;
    else if (luminance > 0.86) white++;
  }
  if (!visible) return { glyph };
  // Only a mark that is nearly all one tone vanishes; a coloured mark on a white or black disc (Google's G) stays readable bare.
  return black / visible >= GLYPH_TONE ? { glyph, plate: 'light' } : white / visible >= GLYPH_TONE ? { glyph, plate: 'dark' } : { glyph };
}
