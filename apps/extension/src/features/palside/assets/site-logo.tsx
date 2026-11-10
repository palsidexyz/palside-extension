'use client';

import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import type { Site } from '../settings/site-catalog';
import { iconFace, type IconFace } from '../../../domain/assets/site-icon';
import s from '../settings/sites.module.css';

/** Logos that failed to load in this panel: they draw the letter at once instead of retrying on every mount. */
const failures = new Set<string>();

function initial(site: Site) {
  return site.name.replace(/^www\./, '').charAt(0).toUpperCase();
}

/** How each site's own icon (a data URL: kept for a site outside the catalog, or a page's favicon) is drawn, read once per image. */
const faces = new Map<string, IconFace>();
const FACE_PIXELS = 32;

function readFace(image: HTMLImageElement) {
  if (!image.src.startsWith('data:') || faces.has(image.src)) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = FACE_PIXELS;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, FACE_PIXELS, FACE_PIXELS);
    faces.set(image.src, iconFace(context.getImageData(0, 0, FACE_PIXELS, FACE_PIXELS).data, FACE_PIXELS));
  } catch { /* drawn as a tile */ }
}

/** One logo image: the tile stays empty until it has loaded, then the image fades in; a broken one gives way to the letter. */
function LogoImage({ site, pixels, onFace }: { site: Site & { logo: string }; pixels: number; onFace: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() => failures.has(site.logo) ? 'failed' : 'loading');
  if (state === 'failed') return <span className={s.letter}>{initial(site)}</span>;
  const ready = (image: HTMLImageElement) => { const known = faces.has(image.src); readFace(image); if (!known && faces.has(image.src)) onFace(); setState('ready'); };
  return <img width={pixels} height={pixels} src={site.logo} alt="" draggable={false} data-ready={state === 'ready' || undefined}
    ref={image => { if (image?.complete && image.naturalWidth && state === 'loading') ready(image); }}
    onLoad={event => ready(event.currentTarget)} onError={() => { failures.add(site.logo); setState('failed'); }} />;
}

/**
 * A site's face, the same wherever a site is drawn — the page capsule, a 共享在看 page, settings, 收藏, 详情, 弹幕. Official artwork,
 * normalized locally without changing its colors or proportions; a near-black or near-white mark sits on a plate in the theme it
 * would vanish in. A site outside the catalog shows its own icon: a mark with transparent corners is drawn bare and smaller, like
 * a tab's favicon, never framed by the tile; a full square icon fills it. A site without artwork, or whose artwork fails, shows its first letter; the globe stands only for no single site
 * (所有网站). Resolve the site with `siteOf`/`siteAt` so every place picks the same image.
 */
export function SiteLogo({ site, size = 'md', off }: { site?: Site; size?: 'xs' | 'sm' | 'md' | 'lg'; off?: boolean }) {
  const pixels = { xs: 16, sm: 20, md: 28, lg: 40 }[size];
  const [, seen] = useState(0);
  // A site's own mark is drawn bare, like the tab shows it; only a mostly white or black one gets the plate it needs.
  const face = site?.logo ? faces.get(site.logo) : undefined;
  return <span className={s.logo} data-size={size} data-plate={face?.glyph ? face.plate : site?.plate} data-glyph={face?.glyph || undefined} data-off={off || undefined} aria-hidden="true">
    {site?.logo ? <LogoImage key={site.logo} site={site as Site & { logo: string }} pixels={pixels} onFace={() => seen(value => value + 1)} />
      : site && site.domain !== '*' ? <span className={s.letter}>{initial(site)}</span> : <Globe2 />}
  </span>;
}

/** {@link SiteLogo} inside a wrapper the caller sizes (`.wrapper > span { --logo-size }`), for logos outside the four sizes. */
export function SiteFace({ site, off, className }: { site?: Site; off?: boolean; className?: string }) {
  return <span className={className}><SiteLogo site={site} off={off} /></span>;
}
