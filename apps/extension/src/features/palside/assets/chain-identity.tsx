'use client';

import { useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { Globe2 } from 'lucide-react';
import { chainInfo } from './chain-catalog';
import s from './chain-identity.module.css';

export function ChainLogo({ chain, size = 16 }: { chain: string; size?: 14 | 16 | 20 }) {
  const entry = chainInfo(chain);
  const [failed, setFailed] = useState<string>();
  return <span className={s.logo} data-chain-logo={chain} title={entry?.label ?? chain} role="img" aria-label={entry?.label ?? chain} style={{ '--chain-logo-size': `${size}px` } as CSSProperties}>
    {entry && failed !== entry.logo ? <motion.img src={entry.logo} alt="" draggable={false} onError={() => setFailed(entry.logo)} /> : <Globe2 />}
  </span>;
}

/** Size is inherited from the token frame, never from the source artwork. */
export function ChainBadge({ chain }: { chain: string }) {
  const entry = chainInfo(chain);
  const [failed, setFailed] = useState<string>();
  return <span className={s.badge} data-chain-badge={chain} title={entry?.label ?? chain} aria-hidden="true">
    {entry && failed !== entry.logo ? <motion.img src={entry.logo} alt="" draggable={false} onError={() => setFailed(entry.logo)} /> : <Globe2 />}
  </span>;
}
