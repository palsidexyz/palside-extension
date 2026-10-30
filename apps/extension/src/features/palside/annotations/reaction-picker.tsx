'use client';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SmilePlus, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { errorMessage } from '@palside/i18n';
import { motionPresets } from '@palside/design/motion';
import { IconButton } from '@palside/ui/button';
import { StateGlyph } from '../ui/motion-details';
import { RainDrop, rain, type Drop } from './emoji-rain';
import { ReactionBatcher, REACTION_DISPLAY, reactionEmojis, reactionName, type ReactionEmoji } from '../../../domain/annotations/reactions';
import type { PalsideController } from '../app/use-palside';
import s from './reactions.module.css';

const BURST = 5;
const HOLD_INTERVAL = 550;
const MAX_PARTICLES = 60;
const RISE = 420;
const LAUNCH_SPREAD = 6;
const CLIMB_SPREAD = 72;
// soft ease out: about 65% of the climb by the halfway point, so the glyph keeps moving
const EASE = [0.4, 0.3, 0.5, 1] as const;
const SWAY = [0, 0.3, 0.65, 1];
const GAP = 14;
const EDGE = 8;
const GLYPH = 26;
/** Received reactions older than this are dropped instead of replayed when a panel opens. */
const FRESH = 2_500;

type Particle = { id: number; emoji: string; x0: number; y0: number; x: number; drift: number; tilt: number; travel: number; scale: number; blur: number; fadeAt: number; duration: number; delay: number };
type Launch = (emoji: string, from: DOMRect, options?: { count?: number; stagger?: number }) => void;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const StageContext = createContext<Launch>(() => {});

function particles(emoji: string, seed: number, x0: number, y0: number, count: number, stagger: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const lane = rand(-1, 1);
    return { id: seed + i, emoji, x0, y0, x: lane * LAUNCH_SPREAD, drift: lane * CLIMB_SPREAD, tilt: rand(1, 4) * (lane < 0 ? -1 : 1), travel: RISE * rand(0.86, 1), scale: rand(0.78, 1.05), blur: rand(0.18, 0.3), fadeAt: rand(0.55, 0.88), duration: rand(1.4, 1.8), delay: i * stagger };
  });
}

// memo: a parent render would restart the flight and replay its delay
const Flight = memo(function Flight({ particle, onDone }: { particle: Particle; onDone: (id: number) => void }) {
  return <motion.span className={s.particle} aria-hidden="true" style={{ left: particle.x0, top: particle.y0 }}
    initial={{ x: particle.x, y: 0, scale: 0.6, opacity: 0, rotate: 0, filter: 'blur(0px)' }}
    animate={{
      x: particle.x + particle.drift, y: -particle.travel,
      scale: [0.6, particle.scale * 1.15, particle.scale, particle.scale * 0.75],
      rotate: [0, particle.tilt, -particle.tilt * 0.65, particle.tilt * 0.35],
      opacity: [0, 1, 1, 0],
      filter: ['blur(0px)', 'blur(0px)', `blur(${particle.blur * GLYPH}px)`],
    }}
    transition={{
      duration: particle.duration, delay: particle.delay, ease: EASE,
      // `inherit` keeps the shared duration and delay; a bare per-value transition would replace them
      rotate: { inherit: true, times: SWAY, ease: 'easeInOut' },
      scale: { inherit: true, times: [0, 0.1, 0.22, 1], ease: 'easeOut' },
      opacity: { inherit: true, times: [0, 0.03, particle.fadeAt, 1], ease: 'linear' },
      // blur follows the climb curve so it never lags the rise
      filter: { inherit: true, times: [0, 0.12, 1] },
    }}
    onAnimationComplete={() => onDone(particle.id)}>{particle.emoji}</motion.span>;
});

/**
 * The flight layer over the chat. Plays this panel's own reactions and teammates' live ones for
 * the current team. It never intercepts pointers and is clipped to the chat area.
 */
export function ReactionStage({ c, children }: { c: PalsideController; children: ReactNode }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const [flights, setFlights] = useState<Particle[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const seed = useRef(0);
  const seen = useRef<Map<string, number> | undefined>(undefined);
  const shownTeam = useRef<string | undefined>(undefined);
  const announcedAt = useRef<number | undefined>(undefined);
  const pendingAnnouncement = useRef<string | undefined>(undefined);
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const launch = useCallback<Launch>((emoji, from, { count = BURST, stagger = 0.25 } = {}) => {
    const rect = stage.current?.getBoundingClientRect();
    if (reduced || !rect || document.visibilityState !== 'visible') return;
    seed.current += count;
    const next = particles(emoji, seed.current, from.left + from.width / 2 - rect.left, from.top + from.height / 2 - rect.top, count, stagger);
    setFlights(old => [...old, ...next].slice(-MAX_PARTICLES));
  }, [reduced]);
  const settle = useCallback((id: number) => setFlights(old => old.filter(item => item.id !== id)), []);
  const fallen = useCallback((key: string) => setDrops(old => old.filter(item => item.key !== key)), []);

  const received = c.live?.state.reactions;
  const team = c.current; const visible = c.screen === 'chat';
  useEffect(() => {
    const clear = () => {
      clearTimeout(announcementTimer.current); announcementTimer.current = undefined;
      pendingAnnouncement.current = undefined; announcedAt.current = undefined;
      setAnnouncement('');
    };
    const onVisibility = () => { if (document.visibilityState !== 'visible') clear(); };
    clear();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clear(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [team, visible, c.disconnected]);
  useEffect(() => {
    const now = Date.now();
    // A panel that opens or switches team does not replay what already arrived.
    if (!seen.current || shownTeam.current !== team) {
      if (seen.current) { setDrops([]); setFlights([]); }
      seen.current = new Map(received?.filter(item => item.at + REACTION_DISPLAY > now).map(item => [item.id, item.at + REACTION_DISPLAY])); shownTeam.current = team; return;
    }
    const fresh = (received ?? []).filter(item => !seen.current!.has(item.id));
    for (const item of fresh) if (item.at + REACTION_DISPLAY > now) seen.current.set(item.id, item.at + REACTION_DISPLAY);
    const shown = fresh.filter(item => item.teamId === team && now - item.at < FRESH);
    if (!shown.length || !visible || c.disconnected || document.visibilityState !== 'visible') return;
    // Teammates' reactions fall as 表情雨 across the whole width: emoji only, no sender card.
    setDrops(old => [...old, ...shown.flatMap(reaction => { seed.current += 1; return rain(seed.current, reaction.emoji, reaction.count, reaction.id); })].slice(-60));
    const latest = shown.at(-1)!;
    const name = c.people.find(person => person.id === latest.personId)?.name ?? t('common.member');
    pendingAnnouncement.current = t('extension.dynamic.reactedBy', { name, emoji: latest.emoji, count: latest.count });
    const announce = () => {
      announcementTimer.current = undefined;
      announcedAt.current = Date.now();
      setAnnouncement(pendingAnnouncement.current ?? ''); pendingAnnouncement.current = undefined;
    };
    const wait = announcedAt.current === undefined ? 0 : Math.max(0, 1_500 - (now - announcedAt.current));
    if (!wait) { clearTimeout(announcementTimer.current); announce(); }
    else announcementTimer.current ??= setTimeout(announce, wait);
  }, [received, team, visible, c.disconnected, c.people, t]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prune = () => {
      const now = Date.now(); let next = Infinity;
      for (const [id, expires] of seen.current ?? []) {
        if (expires <= now) seen.current!.delete(id);
        else next = Math.min(next, expires);
      }
      if (next !== Infinity) timer = setTimeout(prune, next - now);
    };
    prune();
    return () => clearTimeout(timer);
  }, [received, team]);

  return <StageContext.Provider value={launch}>
    {children}
    <div ref={stage} className={s.stage} aria-hidden="true">
      {flights.map(particle => <Flight key={particle.id} particle={particle} onDone={settle} />)}
      {drops.map(drop => <RainDrop key={drop.key} drop={drop} onDone={fallen} />)}
    </div>
    <VisuallyHidden asChild><div role="status" aria-live="polite">{announcement}</div></VisuallyHidden>
  </StageContext.Provider>;
}

type Placement = { left: number; top: number; side: 'top' | 'bottom'; tailX: number };
function place(trigger: DOMRect, width: number, height: number, bounds: DOMRect): Placement {
  const center = trigger.left + trigger.width / 2;
  const left = Math.min(Math.max(center - width / 2, bounds.left + EDGE), bounds.right - EDGE - width);
  const above = trigger.top - GAP - height;
  const side = above < bounds.top + EDGE ? 'bottom' : 'top';
  // the tail stays over the trigger whatever the clamping did
  return { left, top: side === 'top' ? above : trigger.bottom + GAP, side, tailX: center - left };
}

/**
 * Composer reaction control. Tap, hold to repeat, or press the trigger and release over an emoji.
 * Bursts play immediately; sends are batched and are best effort, since reactions are never stored.
 */
export function ReactionPicker({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const launch = useContext(StageContext);
  // Opening is tied to the account, team, screen and connection; any change closes it.
  const context = `${c.data.self}|${c.current}|${c.screen}|${c.disconnected}`;
  const [openIn, setOpenIn] = useState<string>();
  const [shownContext, setShownContext] = useState(context);
  const open = openIn === context && !c.disconnected;
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement>();
  if (shownContext !== context) { setShownContext(context); setOpenIn(undefined); setPlacement(undefined); }
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const hold = useRef<number | undefined>(undefined);
  const justOpened = useRef(false);
  const gesture = useRef<(() => void) | undefined>(undefined);
  const noticeAt = useRef(0);
  const controller = useRef(c);
  useLayoutEffect(() => { controller.current = c; });
  const batcher = useRef<ReactionBatcher>(undefined);
  useEffect(() => {
    const created = new ReactionBatcher((teamId, emoji, count) => {
      const live = controller.current.live; if (!live) return;
      void live.command('react', { teamId, emoji, count }).catch(error => {
        // Reactions are momentary: one notice per burst of failures, never a retry queue.
        if (Date.now() - noticeAt.current < 5_000) return;
        noticeAt.current = Date.now(); controller.current.setNotice(errorMessage(error));
      });
    });
    batcher.current = created;
    return () => created.flush();
  }, []);
  const disabled = c.disconnected;

  const stopHold = useCallback(() => { window.clearInterval(hold.current); hold.current = undefined; }, []);
  const cancelGesture = useCallback(() => { gesture.current?.(); justOpened.current = false; }, []);
  const close = useCallback(() => { cancelGesture(); stopHold(); setOpenIn(undefined); setPlacement(undefined); }, [cancelGesture, stopHold]);
  // Leaving the team or screen sends what is batched and ends a held press.
  useLayoutEffect(() => () => { cancelGesture(); stopHold(); batcher.current?.flush(); }, [context, cancelGesture, stopHold]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = layer.current; const anchor = trigger.current; if (!node || !anchor) return;
      const bounds = anchor.closest('[data-palside-app]')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      setPlacement(place(anchor.getBoundingClientRect(), node.offsetWidth, node.offsetHeight, bounds));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // The opening press can still reach this listener after the trigger re-rendered,
    // so test the event path rather than a possibly detached target.
    const onPointerDown = (event: PointerEvent) => { const path = event.composedPath(); if (!path.includes(layer.current!) && !path.includes(trigger.current!)) close(); };
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key !== 'Escape') return; event.preventDefault(); close(); trigger.current?.focus(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); window.removeEventListener('blur', close); };
  }, [open, close]);
  useEffect(() => { if (open && placement) items.current[active]?.focus({ preventScroll: true }); }, [open, Boolean(placement)]); // eslint-disable-line react-hooks/exhaustive-deps

  const react = useCallback((emoji: ReactionEmoji, from: DOMRect) => {
    launch(emoji, from);
    batcher.current?.add(controller.current.current, emoji);
  }, [launch]);
  const startHold = useCallback((emoji: ReactionEmoji, from: DOMRect) => {
    react(emoji, from); stopHold();
    hold.current = window.setInterval(() => react(emoji, from), HOLD_INTERVAL);
  }, [react, stopHold]);

  // press the trigger and slide onto the bar; releasing over an emoji picks it
  function onTriggerPointerDown(event: React.PointerEvent) {
    if (open || disabled || event.button !== 0) return;
    cancelGesture();
    setOpenIn(context); justOpened.current = true;
    const pointerId = event.pointerId;
    const origin = controller.current;
    const cleanup = () => {
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancelGesture);
      gesture.current = undefined;
    };
    const cancel = (release: PointerEvent) => { if (gesture.current === cleanup && release.pointerId === pointerId) cancelGesture(); };
    const up = (release: PointerEvent) => {
      if (gesture.current !== cleanup || release.pointerId !== pointerId) return;
      const current = controller.current;
      if (current.current !== origin.current || current.screen !== origin.screen || current.disconnected || current.data.self !== origin.data.self) { cancelGesture(); return; }
      cleanup();
      const target = document.elementFromPoint(release.clientX, release.clientY);
      const picked = target?.closest<HTMLElement>('[data-reaction-emoji]');
      const emoji = picked?.dataset.reactionEmoji;
      if (picked && layer.current?.contains(picked) && emoji && reactionEmojis.some(item => item.emoji === emoji)) react(emoji as ReactionEmoji, picked.getBoundingClientRect());
      // releasing away from the trigger fires no click, so nothing else would clear the guard
      if (!trigger.current?.contains(target)) justOpened.current = false;
    };
    gesture.current = cleanup;
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancelGesture);
  }
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = reactionEmojis.length; let next = active;
    if (event.key === 'ArrowRight') next = (active + 1) % count;
    else if (event.key === 'ArrowLeft') next = (active - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (event.key === 'Tab') { close(); return; }
    else return;
    event.preventDefault(); setActive(next); items.current[next]?.focus();
  }

  const label = open ? t('extension.copy.closeReactions') : t('extension.copy.reactions');
  const top = placement?.side !== 'bottom';
  return <>
    <IconButton ref={trigger} size="sm" variant="quiet" label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onPointerDown={onTriggerPointerDown}
      onClick={() => { if (justOpened.current) { justOpened.current = false; return; } if (open) close(); else setOpenIn(context); }}>
      <StateGlyph state={open ? 'open' : 'closed'}>{open ? <X /> : <SmilePlus />}</StateGlyph>
    </IconButton>
    <AnimatePresence>{open && <motion.div key="reactions" popover="manual" className={s.layer}
      ref={node => { layer.current = node; if (node && !node.matches(':popover-open')) node.showPopover(); }}
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? 'visible' : 'hidden', transformOrigin: `${placement?.tailX ?? 0}px ${top ? '100%' : '0%'}` }}
      initial={{ opacity: 0, y: reduced ? 0 : top ? 10 : -10, scale: reduced ? 1 : 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : top ? 6 : -6, scale: reduced ? 1 : 0.9 }}
      transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 520, damping: 30 }}>
      <div role="menu" aria-label={t('extension.copy.reactionPicker')} aria-orientation="horizontal" className={s.bar} onKeyDown={onMenuKeyDown}>
        {reactionEmojis.map(({ emoji }, i) => {
          const itemLabel = t('extension.dynamic.reactWith', { name: `${emoji} ${t('extension.dynamic.reactionName', { emoji: reactionName(emoji) })}` });
          return <button key={emoji} ref={node => { items.current[i] = node; }} type="button" role="menuitem" className={s.item} data-reaction-emoji={emoji}
            tabIndex={i === active ? 0 : -1} aria-label={itemLabel} title={itemLabel}
            onFocus={() => setActive(i)}
            onPointerDown={event => { if (event.button === 0) startHold(emoji, event.currentTarget.getBoundingClientRect()); }}
            onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
            onContextMenu={event => event.preventDefault()}
            // detail is 0 only for keyboard activation; pointer presses already reacted above
            onClick={event => { if (event.detail === 0) react(emoji, event.currentTarget.getBoundingClientRect()); }}>
            <motion.span className={s.glyph} aria-hidden="true"
              initial={reduced ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 800, damping: 25, delay: 0.04 + i * 0.035 }}
              whileHover={reduced ? undefined : { scale: 1.24, y: -3 }} whileTap={reduced ? undefined : { scale: 0.92 }}>{emoji}</motion.span>
          </button>;
        })}
      </div>
      <span className={s.tail} data-side={top ? 'top' : 'bottom'} style={{ left: placement?.tailX ?? 0 }} aria-hidden="true" />
      <span className={s.tailDot} data-side={top ? 'top' : 'bottom'} style={{ left: (placement?.tailX ?? 0) + 6 }} aria-hidden="true" />
    </motion.div>}</AnimatePresence>
  </>;
}
