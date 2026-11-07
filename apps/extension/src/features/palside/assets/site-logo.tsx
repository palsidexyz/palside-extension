'use client';

import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import type { Site } from '../settings/site-catalog';
import s from '../settings/sites.module.css';

/** Logos that failed to load in this panel: they draw the letter at once instead of retrying on every mount. */
const failures = new Set<string>();

function initial(site: Site) {
  return site.name.replace(/^www\./, '').charAt(0).toUpperCase();
}

/** One logo image: the tile stays empty until it has loaded, then the image fades in; a broken one gives way to the letter. */
function LogoImage({ site, pixels }: { site: Site & { logo: string }; pixels: number }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() => failures.has(site.logo) ? 'failed' : 'loading');
  if (state === 'failed') return <span className={s.letter}>{initial(site)}</span>;
  return <img width={pixels} height={pixels} src={site.logo} alt="" draggable={false} data-ready={state === 'ready' || undefined}
    ref={image => { if (image?.complete && image.naturalWidth && state === 'loading') setState('ready'); }}
    onLoad={() => setState('ready')} onError={() => { failures.add(site.logo); setState('failed'); }} />;
}

/**
 * A site's face, the same wherever a site is drawn — the page capsule, a 共享在看 page, settings, 收藏, 详情, 弹幕. Official artwork,
 * normalized locally without changing its colors or proportions; a near-black or near-white mark sits on a plate in the theme it
 * would vanish in. A site without artwork, or whose artwork fails, shows its first letter; the globe stands only for no single site
 * (所有网站). Resolve the site with `siteOf`/`siteAt` so every place picks the same image.
 */
export function SiteLogo({ site, size = 'md', off }: { site?: Site; size?: 'xs' | 'sm' | 'md' | 'lg'; off?: boolean }) {
  const pixels = { xs: 16, sm: 20, md: 28, lg: 40 }[size];
  return <span className={s.logo} data-size={size} data-plate={site?.plate} data-off={off || undefined} aria-hidden="true">
    {site?.logo ? <LogoImage key={site.logo} site={site as Site & { logo: string }} pixels={pixels} />
      : site && site.domain !== '*' ? <span className={s.letter}>{initial(site)}</span> : <Globe2 />}
  </span>;
}

/** {@link SiteLogo} inside a wrapper the caller sizes (`.wrapper > span { --logo-size }`), for logos outside the four sizes. */
export function SiteFace({ site, off, className }: { site?: Site; off?: boolean; className?: string }) {
  return <span className={className}><SiteLogo site={site} off={off} /></span>;
}
