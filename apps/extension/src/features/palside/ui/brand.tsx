'use client';
import { motion } from 'motion/react';
import s from '../feedback/edge-states.module.css';

/** Uses the same artwork as the installed extension, in both hosts. */
export function Brand({ markOnly = false }: { markOnly?: boolean }) {
  return <span className={s.brand} aria-hidden={markOnly || undefined} style={markOnly ? { flex: '0 0 20px' } : undefined}>
    <motion.img src="/brand/palside.svg" width={markOnly ? 20 : 30} height={markOnly ? 20 : 30} alt="" draggable={false} />
    {!markOnly && <span>palside</span>}
  </span>;
}
