'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Globe2 } from 'lucide-react';
import type { Site } from '../settings/site-catalog';
import s from '../settings/sites.module.css';

/** Official artwork, normalized locally without changing its colors or proportions; a near-black or near-white mark sits on a plate in the theme it would vanish in. */
export function SiteLogo({ site, size = 'md', off }: { site?: Site; size?: 'xs' | 'sm' | 'md' | 'lg'; off?: boolean }) {
  const [failed, setFailed] = useState<string>();
  const pixels = { xs: 16, sm: 20, md: 28, lg: 40 }[size];
  return <span className={s.logo} data-size={size} data-plate={site?.plate} data-off={off || undefined} aria-hidden="true">
    {site?.logo && failed !== site.logo ? <motion.img width={pixels} height={pixels} src={site.logo} alt="" draggable={false} onError={() => setFailed(site.logo)} /> : <Globe2 />}
  </span>;
}
