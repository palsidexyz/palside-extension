'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'use-intl';
import { Counter } from '@palside/ui/counter';
import { motionPresets } from '@palside/design/motion';
import s from '../app/palside.module.css';
import m from './motion-details.module.css';

/** Keep the button frame fixed while its glyph changes. */
export function StateGlyph({ state, children }: { state: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <span className={s.stateGlyph} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout"><motion.span key={state} className={s.glyphLayer}
    initial={{ opacity: 0, y: reduced ? 0 : 3, filter: reduced ? 'none' : 'blur(2px)' }}
    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
    exit={{ opacity: 0, y: reduced ? 0 : -3, filter: reduced ? 'none' : 'blur(2px)' }}
    transition={reduced ? motionPresets.reduced : motionPresets.feedback}>{children}</motion.span></AnimatePresence></span>;
}

/** Shared rolling digits inherit the surrounding count typography. */
export function Count({ value }: { value: number }) {
  return <Counter value={value} separator="" className={s.countNumber} />;
}

/** A translated count phrase whose number rolls: the value, as the message printed it, becomes a Count; `last` when a name precedes it. */
export function CountText({ text, value, last }: { text: string; value: number; last?: boolean }) {
  const locale = useLocale();
  const shown = [new Intl.NumberFormat(locale).format(value), String(value)].find(form => text.includes(form));
  if (!shown) return <>{text}</>;
  const at = last ? text.lastIndexOf(shown) : text.indexOf(shown);
  return <>{text.slice(0, at)}<Count value={value} />{text.slice(at + shown.length)}</>;
}

/** Animate unread visibility separately from the count itself. */
export function UnreadBadge({ count }: { count: number }) {
  const reduced = useReducedMotion();
  return <AnimatePresence initial={false}>{count > 0 && <motion.span className={s.unreadBadge} initial={{ opacity: 0, scale: reduced ? 1 : .65 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .65 }} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 600, damping: 20 }}><Count value={count} /></motion.span>}</AnimatePresence>;
}

/** Swaps one phrase for another in place: the old one lifts away blurred, the new one settles. */
export function Swap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <span className={`${m.swap} ${className ?? ''}`}><AnimatePresence initial={false} mode="popLayout">
    <motion.span key={k} className={m.swapLayer} initial={{ opacity: 0, y: reduced ? 0 : 4, filter: reduced ? 'none' : 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: reduced ? 0 : -4, filter: reduced ? 'none' : 'blur(2px)' }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>{children}</motion.span>
  </AnimatePresence></span>;
}

/** A check that is drawn, not shown: the disc springs in, then the stroke is written left to right. */
export function DrawnCheck({ size = 'lg', delay = 0 }: { size?: 'sm' | 'lg'; delay?: number }) {
  const reduced = useReducedMotion();
  const big = size === 'lg';
  return <motion.span className={big ? m.done : m.doneSmall} aria-hidden="true" initial={reduced ? false : { scale: .3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 520, damping: 24, delay }}>
    {big && !reduced && <motion.span className={m.doneRing} initial={{ scale: 1, opacity: .5 }} animate={{ scale: 1.7, opacity: 0 }} transition={{ delay: delay + .22, duration: .7, ease: [.22, 1, .36, 1] }} />}
    <svg viewBox="0 0 24 24"><motion.path d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="currentColor" strokeWidth={big ? 2.6 : 3} strokeLinecap="round" strokeLinejoin="round"
      initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={reduced ? motionPresets.reduced : { delay: delay + .16, duration: .34, ease: [.65, 0, .35, 1] }} /></svg>
  </motion.span>;
}

/** Content that arrives after a beat, rising a few pixels. */
export function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.span className={`${m.rise} ${className ?? ''}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? motionPresets.reduced : { ...motionPresets.feedback, delay }}>{children}</motion.span>;
}

/** One step of a flow; moving forward slides in from the right, back from the left. */
export function Step({ k, dir = 1, className, children }: { k: string; dir?: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <AnimatePresence initial={false} mode="popLayout" custom={dir}>
    <motion.div key={k} className={className} custom={dir}
      variants={{ enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 28 }), center: { opacity: 1, x: 0 }, leave: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -28 }) }}
      initial="enter" animate="center" exit="leave" transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 380, damping: 36 }}>{children}</motion.div>
  </AnimatePresence>;
}

/** Follows its content's height with the step spring, so a sheet grows or settles between steps instead of jumping. */
export function Fit({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion(), inner = useRef<HTMLDivElement>(null), [height, setHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const element = inner.current; if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <motion.div className={m.fit} initial={false} animate={{ height }} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 380, damping: 36 }}>
    <div ref={inner} className={`${m.fitInner} ${className ?? ''}`}>{children}</div>
  </motion.div>;
}

/** Three dots that breathe in turn while something is on its way. */
export function Dots() {
  return <span className={m.dots} aria-hidden="true"><i /><i /><i /></span>;
}
