import { useEffect, useState, type ReactNode } from 'react';
import w from './wait.module.css';

/** Palside's bubble mark; while something runs its eyes blink now and then, alive without bouncing. */
export function MarkLogo({ className, blink = false }: { className?: string; blink?: boolean }) {
  return <svg className={className} viewBox="0 0 128 128" aria-hidden="true"><rect x="4" y="4" width="120" height="120" rx="32" fill="#CCFF00" /><path d="M38 33H90A4 4 0 0 1 94 37V75A4 4 0 0 1 90 79H59.333Q58 79 56.933 79.8L36.4 95.2Q34 97 34 94V37A4 4 0 0 1 38 33Z" fill="#202121" /><circle className={blink ? w.eye : undefined} cx="53" cy="56" r="5" fill="#CCFF00" /><circle className={blink ? w.eye : undefined} cx="75" cy="56" r="5" fill="#CCFF00" /></svg>;
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
