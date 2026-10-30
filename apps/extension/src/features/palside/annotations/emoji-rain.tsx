'use client';
import { memo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import s from './emoji-rain.module.css';

export type Drop = { key: string; emoji: string; x: number; size: number; delay: number; duration: number; sway: number; opacity: number; rest: number };
const GOLDEN = 0.6180339887;
/** 表情雨: a low-discrepancy spread that covers the panel width evenly without a visible grid; bursts interleave. */
export function rain(seed: number, emoji: string, count: number, key: string): Drop[] {
  const n = Math.min(18, Math.max(8, 6 + count));
  return Array.from({ length: n }, (_, i) => {
    const depth = (seed * 0.37 + i * 0.7548776662) % 1;
    return { key: `${key}-${i}`, emoji, x: 4 + ((seed * 0.29 + i * GOLDEN) % 1) * 92, size: 18 + depth * 14, delay: i * 0.075 + ((i * GOLDEN) % 1) * 0.12, duration: 2.4 - depth * 0.7, sway: (i % 2 ? 1 : -1) * (6 + depth * 8), opacity: 0.6 + depth * 0.4, rest: 20 + ((i * GOLDEN + seed * 0.13) % 1) * 60 };
  });
}

/** Falls once and reports back; with reduced motion it fades in and out where it rests. */
export const RainDrop = memo(function RainDrop({ drop, onDone }: { drop: Drop; onDone: (key: string) => void }) {
  const reduced = useReducedMotion();
  if (reduced) return <motion.span className={s.still} style={{ left: `${drop.x}%`, top: `${drop.rest}%`, fontSize: drop.size }} aria-hidden="true"
    initial={{ opacity: 0 }} animate={{ opacity: [0, drop.opacity, drop.opacity, 0] }} transition={{ duration: 1.6, delay: drop.delay, times: [0, 0.15, 0.75, 1] }}
    onAnimationComplete={() => onDone(drop.key)}>{drop.emoji}</motion.span>;
  return <motion.span className={s.drop} style={{ left: `${drop.x}%`, fontSize: drop.size }} aria-hidden="true"
    initial={{ y: '-100%', rotate: -drop.sway, opacity: 0 }} animate={{ y: '0%', rotate: drop.sway, opacity: [0, drop.opacity, drop.opacity, 0] }}
    transition={{ y: { duration: drop.duration, delay: drop.delay, ease: [0.45, 0, 0.9, 0.6] }, rotate: { duration: drop.duration, delay: drop.delay, ease: 'easeInOut' }, opacity: { duration: drop.duration, delay: drop.delay, times: [0, 0.06, 0.82, 1] } }}
    onAnimationComplete={() => onDone(drop.key)}><span>{drop.emoji}</span></motion.span>;
});
