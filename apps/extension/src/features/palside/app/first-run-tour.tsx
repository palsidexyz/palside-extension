'use client';
import { Suspense, lazy, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Gift, ImageIcon, Scissors, SmilePlus } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { motionPresets } from '@palside/design/motion';
import type { PalsideController } from './use-palside';
import { defaultSignalSettings } from '../../../runtime/annotations/signals';
import { shortcutKeys } from '../../../runtime/browser/shortcuts';
import { KeyCaps } from '../settings/signal-settings';
import { DanmakuGlyph } from '../rooms/composer-danmaku';
import { useCaptureShortcut } from '../settings/use-shortcut';
import s from './first-run-tour.module.css';

/** Controls the tour points at carry `data-tour`; a step whose control is not on screen is left out. */
type Anchor = 'share' | 'site' | 'tools' | 'invite';
type Box = { left: number; top: number; width: number; height: number };
const GAP = 10, EDGE = 12, WIDTH = 288, PAD = 4, START_DELAY = 700;

/** The first visible control for an anchor inside the panel; 邀请 falls back from the header seat to the new team card's button. */
function anchorOf(app: Element | null, anchor: Anchor) {
  return [...app?.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`) ?? []].find(node => node.checkVisibility() && node.getBoundingClientRect().width > 0) ?? null;
}

/** Follows the control's box every frame, so header reflows, the composer growing and panel resizes keep the hole on it. */
function useBox(app: Element | null, anchor: Anchor | undefined) {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!anchor) return;
    let frame = 0, last = '';
    const tick = () => {
      const rect = anchorOf(app, anchor)?.getBoundingClientRect();
      const next = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setBox(next); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [app, anchor]);
  return anchor ? box : null;
}

/**
 * The first-run tour: the panel dims, one control at a time stays lit, and a bubble with an arrow says what it does. It runs once per
 * account on this device: the first bubble saves `toured`, because the panel can leave the chat from outside (a press on the page's
 * 弹幕) or close without 跳过 ever being pressed. `onRun` holds the run open past that save and lets it go after the last fade. 关于 › 重看引导 clears it.
 */
/** The demo's chart and danmaku stay out of the first panel bundle; the tour fetches them when it starts, two steps before they show. */
const loadDemo = () => import('./tour-demo');
const TourDemo = lazy(() => loadDemo().then(module => ({ default: module.TourDemo })));

export function FirstRunTour({ c, onRun }: { c: PalsideController; onRun: (team: string | undefined) => void }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<Element | null>(null);
  useEffect(() => { void loadDemo().catch(() => {}); }, []);
  const [anchors, setAnchors] = useState<Anchor[]>();
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const [height, setHeight] = useState(140);
  const shotKeys = shortcutKeys(useCaptureShortcut(c) ?? '');
  const steps: Record<Anchor, { title: string; body: ReactNode }> = {
    share: { title: t('extension.web.share'), body: <p>{t('extension.tour.share')}</p> },
    site: { title: t('extension.settings.interaction'), body: <><p>{t('extension.tour.site')}</p><Suspense fallback={null}><TourDemo settings={c.live?.page?.signalSettings ?? defaultSignalSettings} /></Suspense></> },
    tools: { title: t('extension.tour.toolsTitle'), body: <ul className={s.tools}>
      <li><SmilePlus aria-hidden="true" /><b>{t('extension.copy.reactionPicker')}</b><p><span>{t('extension.tour.reactions')}</span></p></li>
      <li><ImageIcon aria-hidden="true" /><b>{t('extension.copy.image')}</b><p><span>{t('extension.tour.image')}</span></p></li>
      <li><Scissors aria-hidden="true" /><b>{t('extension.privacy.feature_shot')}</b><p><span>{t('extension.tour.shot')}</span>{shotKeys.length > 0 && <KeyCaps keys={shotKeys} />}</p></li>
      <li><Gift aria-hidden="true" /><b>{t('extension.wallet.packet')}</b><p><span>{t('extension.tour.packet')}</span></p></li>
      <li><DanmakuGlyph /><b>{t('extension.room.name')}</b><p><span>{t('extension.tour.room')}</span></p></li>
    </ul> },
    invite: { title: t('extension.tour.inviteTitle'), body: <p>{t('extension.tour.invite')}</p> },
  };

  function save() {
    const live = c.live;
    if (live) void live.command('preferences', { accountId: c.data.self, toured: true }).catch(() => {});
  }
  const saveNow = useEffectEvent(save);
  // The panel settles first (capsule, presence, composer); the steps are the controls on screen at that moment.
  useEffect(() => {
    const root = layer.current?.closest('[data-palside-app]') ?? null;
    const timer = setTimeout(() => {
      const found = (['share', 'site', 'tools', 'invite'] as const).filter(anchor => anchorOf(root, anchor));
      setApp(root);
      setAnchors(found);
      // Nothing on screen to point at: the tour has nothing to say and counts as seen.
      if (!found.length) saveNow();
    }, START_DELAY);
    return () => clearTimeout(timer);
  }, []);
  const anchor = anchors?.[index];
  const target = useBox(app, closed ? undefined : anchor);
  const open = !closed && Boolean(anchor && target);
  const begin = useEffectEvent(() => { onRun(c.current); saveNow(); });
  useEffect(() => { if (open) begin(); }, [open]);
  const finish = () => setClosed(true);
  const count = anchors?.length ?? 0;
  const last = index === count - 1;
  const advance = () => { if (last) finish(); else setIndex(index + 1); };
  const onKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape') finish();
    else if (event.key === 'ArrowRight') advance();
    else if (event.key === 'ArrowLeft') setIndex(Math.max(0, index - 1));
    else if (event.key === 'Tab') {
      const buttons = [...bubble.current?.querySelectorAll<HTMLButtonElement>('button') ?? []];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });
  // While the panel is dimmed, focus and the tour's keys stay with the bubble: a field that grabs focus (the composer) gets it back
  // only when the tour ends.
  useEffect(() => {
    if (!open) return;
    next.current?.focus({ preventScroll: true });
    const keep = (event: FocusEvent) => { if (!bubble.current?.contains(event.target as Node)) next.current?.focus({ preventScroll: true }); };
    const keys = (event: globalThis.KeyboardEvent) => onKey(event);
    document.addEventListener('focusin', keep);
    addEventListener('keydown', keys, true);
    return () => { document.removeEventListener('focusin', keep); removeEventListener('keydown', keys, true); };
  }, [open, index]);
  const measure = (node: HTMLDivElement | null) => {
    bubble.current = node;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  };

  const bounds = app?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const width = Math.min(WIDTH, bounds.width - EDGE * 2);
  // Below the control when it fits, otherwise above; the arrow follows the control's centre.
  const below = target ? target.top + target.height + GAP + height + EDGE <= bounds.top + bounds.height : true;
  const centre = target ? target.left + target.width / 2 : 0;
  const left = Math.min(Math.max(centre - width / 2, bounds.left + EDGE), bounds.left + bounds.width - width - EDGE);
  const top = target ? below ? target.top + target.height + GAP : target.top - GAP - height : 0;
  const arrow = Math.min(Math.max(centre - left, 22), width - 22);
  const spring = reduced ? motionPresets.reduced : { type: 'spring' as const, stiffness: 380, damping: 34 };
  const hole = target && { left: target.left - PAD, top: target.top - PAD, width: target.width + PAD * 2, height: target.height + PAD * 2 };
  const step = anchor && steps[anchor];

  return <div ref={layer} className={s.root}>
    <AnimatePresence onExitComplete={() => { if (closed) onRun(undefined); }}>
      {open && step && <motion.div key="tour" className={s.layer} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionPresets.feedback}>
        <div className={s.block} />
        <motion.div className={s.hole} initial={false} animate={hole!} transition={spring} />
        <motion.div ref={measure} role="dialog" aria-modal="true" aria-label={t('extension.tour.label')} aria-describedby="tour-step" className={s.bubble} data-side={below ? 'bottom' : 'top'}
          style={{ width }} initial={{ left, top, scale: reduced ? 1 : 0.94, opacity: 0 }} animate={{ left, top, scale: 1, opacity: 1 }} transition={spring}>
          <motion.svg className={s.arrow} viewBox="0 0 18 9" aria-hidden="true" initial={false} animate={{ left: arrow - 9 }} transition={spring}>
            <path d="M0 9 L7.6 1.2 Q9 -0.2 10.4 1.2 L18 9" />
          </motion.svg>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={anchor} id="tour-step" className={s.body} aria-live="polite" initial={{ opacity: 0, x: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -12 }} transition={motionPresets.feedback}>
              <h2>{step.title}</h2>
              {step.body}
            </motion.div>
          </AnimatePresence>
          <footer className={s.footer}>
            <span className={s.dots} role="img" aria-label={t('extension.tour.progress', { current: index + 1, count })}>{anchors!.map((item, i) => <i key={item} data-on={i === index || undefined} />)}</span>
            {!last && <Button size="sm" variant="quiet" onClick={finish}>{t('extension.tour.skip')}</Button>}
            <Button ref={next} size="sm" variant="primary" onClick={advance}>{last ? t('extension.capture.done') : t('extension.wallet.next')}</Button>
          </footer>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
