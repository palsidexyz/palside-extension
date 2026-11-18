import { useEffect, useId, useState, type ReactNode } from 'react';
import w from './wait.module.css';

/** The P of the brand mark, in its 128-unit box (drawn inside `translate(1 2.25)`). */
export const MARK_P = 'M47 23H68A30 30 0 0 1 68 83H65A5 5 0 0 0 60 88A14.5 14.5 0 0 1 31 88V39A16 16 0 0 1 47 23Z';

/** An inner shadow and inner light along the shape's own edge, as the master draws its tile and P. */
function Inset({ id, dx, dy, blur, color, opacity, light }: { id: string; dx: number; dy: number; blur: number; color: string; opacity: number; light: number }) {
  return <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur in="SourceAlpha" stdDeviation={blur} result="bl" />
    <feOffset in="bl" dx={-dx} dy={-dy} result="o1" /><feComposite in="SourceAlpha" in2="o1" operator="arithmetic" k2={1} k3={-1} result="e1" />
    <feFlood floodColor={color} floodOpacity={opacity} /><feComposite in2="e1" operator="in" result="sh" />
    <feOffset in="bl" dx={dx} dy={dy} result="o2" /><feComposite in="SourceAlpha" in2="o2" operator="arithmetic" k2={1} k3={-1} result="e2" />
    <feFlood floodColor="#FFFFFF" floodOpacity={light} /><feComposite in2="e2" operator="in" result="hl" />
    <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="sh" /><feMergeNode in="hl" /></feMerge>
  </filter>;
}

/** The brand mark (packages/design/assets/brand/palside.svg) drawn inline; while something runs its eyes blink now and then, alive without bouncing. */
export function MarkLogo({ className, blink = false }: { className?: string; blink?: boolean }) {
  const id = `pm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`, u = (part: string) => `url(#${id}${part})`;
  const tile = <rect x="4" y="4" width="120" height="120" rx="30" />;
  return <svg className={className} viewBox="0 0 128 128" aria-hidden="true">
    <defs>
      <path id={`${id}p`} d={MARK_P} />
      <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#D9FC40" /><stop offset=".5" stopColor="#ADEB18" /><stop offset="1" stopColor="#66CB1E" /></linearGradient>
      <radialGradient id={`${id}l`} cx=".26" cy=".18" r=".65"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".22" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".5" /><stop offset=".5" stopColor="#FFFFFF" stopOpacity=".08" /><stop offset="1" stopColor="#FFFFFF" stopOpacity=".22" /></linearGradient>
      <Inset id={`${id}ti`} dx={1.5} dy={2.5} blur={3} color="#3F8A00" opacity={.22} light={0} />
      <radialGradient id={`${id}b`} cx=".36" cy=".28" r=".85"><stop offset=".3" stopColor="#FFFFFF" /><stop offset=".78" stopColor="#F5FBE6" /><stop offset="1" stopColor="#E1F0BC" /></radialGradient>
      <Inset id={`${id}pi`} dx={2} dy={3} blur={2.8} color="#78A82C" opacity={.42} light={.85} />
      <filter id={`${id}g`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="6.5" result="a" /><feFlood floodColor="#F7FFD2" floodOpacity=".78" /><feComposite in2="a" operator="in" result="halo" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="3.6" /><feOffset dx="1" dy="4.5" result="o" /><feFlood floodColor="#2F7A00" floodOpacity=".32" /><feComposite in2="o" operator="in" result="ds" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="1" /><feOffset dy="1.2" result="o2" /><feFlood floodColor="#2F7A00" floodOpacity=".25" /><feComposite in2="o2" operator="in" result="ct" />
        <feMerge><feMergeNode in="halo" /><feMergeNode in="ds" /><feMergeNode in="ct" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${id}s`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
      <clipPath id={`${id}c`}><use href={`#${id}p`} /></clipPath>
      <radialGradient id={`${id}e`} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#333333" /><stop offset="1" stopColor="#0B0B0B" /></radialGradient>
    </defs>
    <g fill={u('t')} filter={u('ti')}>{tile}</g><g fill={u('l')}>{tile}</g>
    <rect x="4.6" y="4.6" width="118.8" height="118.8" rx="29.4" fill="none" stroke={u('r')} strokeWidth="1.2" />
    <g transform="translate(1 2.25)">
      <g filter={u('g')}><use href={`#${id}p`} fill={u('b')} filter={u('pi')} /></g>
      <g clipPath={u('c')}><ellipse cx="45" cy="32" rx="9" ry="4" fill="#FFFFFF" opacity=".7" filter={u('s')} transform="rotate(-22 45 32)" /></g>
      {[57, 74].map(x => <g key={x} className={blink ? w.eye : undefined}><ellipse cx={x} cy="53" rx="5.6" ry="8.2" fill={u('e')} /><ellipse cx={x - 1.7} cy="49.4" rx="1.9" ry="2.2" fill="#FFFFFF" /></g>)}
    </g>
  </svg>;
}

/** A running word: a soft band of light passes through it. A mask, so the ink stays the real text colour. */
export function Band({ active = true, children }: { active?: boolean; children: ReactNode }) {
  return <span className={active ? w.band : undefined}>{children}</span>;
}

/** The quiet line under a wait: slow, offline, checking. */
export function WaitNote({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className={w.note} role="status">{icon}{children}</p>;
}

/** True once the same step has been running for `ms`; the clock restarts whenever `key` changes. Measured, never assumed. */
export function useSlow(key: string | undefined, ms = 8_000) {
  const [slow, setSlow] = useState<string>();
  useEffect(() => {
    if (key === undefined) return;
    const timer = setTimeout(() => setSlow(key), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return key !== undefined && slow === key;
}
