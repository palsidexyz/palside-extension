import { ROOM_LOGO_URL_LENGTH } from '@palside/shared/contracts/limits';
import { siteImages } from '@palside/shared/sites';

const prefix = 'data:image/png;base64,';
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Receivers accept exactly the image locations that some site's 代币资料 may export. */
const imageRules = siteImages.map(image => ({ host: image.host, path: new RegExp(`^${literal(image.path)}${image.file}$`) }));
export function tokenLogoUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > ROOM_LOGO_URL_LENGTH) return;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return;
    if (!imageRules.some(rule => url.hostname === rule.host && rule.path.test(url.pathname))) return;
    url.search = ''; url.hash = ''; return url.href;
  } catch { return; }
}
/** Embedded snapshots remain bounded PNGs; remote display sources use the separate allowlist. */
export function tokenLogo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 10_690 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return;
  try {
    const bytes = Uint8Array.from(atob(value.slice(prefix.length)), c => c.charCodeAt(0));
    if (bytes.length < 45 || bytes.length > 8000 || [137,80,78,71,13,10,26,10].some((b, i) => bytes[i] !== b)) return;
    const header = new DataView(bytes.buffer);
    if (header.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') return;
    const width = header.getUint32(16), height = header.getUint32(20);
    if (width < 1 || width > 48 || height < 1 || height > 48) return;
    return value;
  } catch { return; }
}
/** Image display only: never accept arbitrary page URLs, signed query strings or active content. */
export function tokenLogoSource(value: unknown) { return tokenLogo(value) ?? tokenLogoUrl(value); }
/** Validate embedded pixels locally or a public image URL syntactically; no metadata/image fetch here. */
export async function validateTokenLogo(value: unknown) {
  const remote = tokenLogoUrl(value); if (remote) return remote;
  const png = tokenLogo(value); if (!png) return;
  try { const bytes = Uint8Array.from(atob(png.slice(prefix.length)), c => c.charCodeAt(0)); const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); const valid = bitmap.width <= 48 && bitmap.height <= 48; bitmap.close(); return valid ? png : undefined; } catch { return; }
}
