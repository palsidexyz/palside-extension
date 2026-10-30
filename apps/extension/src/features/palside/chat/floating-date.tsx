'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { latestTolerance } from './chat-reading';
import navigation from './chat-navigation.module.css';

const IDLE_MS = 1000;

/**
 * The date of the topmost message, shown only while the reader scrolls through history and gone a moment after they
 * stop. Never shown at the live tail, and hidden while that day's own separator sits right under it.
 */
export function FloatingDate({ list, labelOf }: { list: RefObject<HTMLDivElement | null>; labelOf: (id: string) => string | undefined }) {
  const [shown, setShown] = useState<{ label: string; visible: boolean }>({ label: '', visible: false });
  const latest = useRef(labelOf);
  useEffect(() => { latest.current = labelOf; }, [labelOf]);
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      frame = 0;
      const top = root.getBoundingClientRect().top;
      const atTail = root.scrollHeight - root.clientHeight - root.scrollTop <= latestTolerance;
      const row = [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > top + 8);
      const label = row ? latest.current(row.dataset.messageId!) : undefined;
      const separatorBelow = [...root.querySelectorAll<HTMLElement>('[data-day-label]')].some(item => { const at = item.getBoundingClientRect().top - top; return at > -12 && at < 40; });
      setShown(old => label && !atTail && !separatorBelow ? { label, visible: true } : old.visible ? { ...old, visible: false } : old);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(old => old.visible ? { ...old, visible: false } : old), IDLE_MS);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [list]);
  return <div className={navigation.floatingDate} data-visible={shown.visible || undefined} aria-hidden="true">{shown.label}</div>;
}
