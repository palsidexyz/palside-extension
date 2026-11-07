'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Wheel, createSignalManifest, signalArtCss, spawnPing } from '@palside/shared/signal-art';
import { motionPresets } from '@palside/design/motion';
import { isEmote, type SignalKind, type SignalSettings } from '../../../runtime/annotations/signals';
import { Keys } from '../settings/signal-settings';
import s from './tour-demo.module.css';

/** The three things 网页互动 puts on a page, in the order the demo plays them. */
const scenes = ['signal', 'quote', 'danmaku'] as const;
type Scene = typeof scenes[number];
/** How long each scene plays before the next; the tab's bar fills over the same time. */
const LENGTH: Record<Scene, number> = { signal: 4300, quote: 4600, danmaku: 4400 };
/** The page wheel at a size that fits the 144px stage (its ring is 376/600 of this), and the ping it sends. */
const WHEEL_PX = 196, PING_PX = 46, PING_LIFE = 1.7;
const CHART = 'M0 34 L9 31 L17 33 L26 25 L35 27 L44 19 L52 22 L61 14 L70 17 L78 10 L87 13 L100 7';
const SIGNAL_CSS = `${signalArtCss}#pings{position:absolute;inset:0}`;

/**
 * A small looping page inside the 网页互动 bubble: a signal sent from the real wheel with the user's own shortcut, text selected
 * and stuck as a 便利贴 from the float bar, and 弹幕 crossing a token page. The tabs jump to a scene; with reduced motion nothing
 * plays and each tab shows its scene's final frame.
 */
export function TourDemo({ settings }: { settings: SignalSettings }) {
  const t = useTranslations();
  const reduced = useReducedMotion() ?? false;
  const [scene, setScene] = useState<Scene>('signal');
  const [run, setRun] = useState(0);
  const go = (next: Scene) => { setScene(next); setRun(value => value + 1); };
  const labels: Record<Scene, string> = { signal: t('extension.web.signal'), quote: t('extension.tour.quoteTab'), danmaku: t('extension.room.name') };
  const caption = {
    signal: <><Keys value={settings.key} /><span>{t('extension.tour.signalHow')}</span></>,
    quote: <span>{t('extension.tour.quoteHow')}</span>,
    danmaku: <span>{t('extension.tour.danmakuHow')}</span>,
  }[scene];
  return <div className={s.demo}>
    <div className={s.tabs} role="group" aria-label={t('extension.settings.interaction')}>
      {scenes.map(item => <button key={item} type="button" aria-pressed={scene === item} onClick={() => go(item)}>
        {scene === item && <motion.span layoutId="tour-demo-tab" className={s.pill} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 420, damping: 36 }} />}
        <span className={s.label}>{labels[item]}</span>
        {scene === item && !reduced && <i key={run} className={s.progress} style={{ animationDuration: `${LENGTH[item]}ms` }} />}
      </button>)}
    </div>
    <Stage key={`${scene}-${run}`} scene={scene} reduced={reduced} settings={settings}
      onDone={() => go(scenes[(scenes.indexOf(scene) + 1) % scenes.length]!)} />
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p key={scene} className={s.caption} initial={{ opacity: 0, y: reduced ? 0 : 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={motionPresets.feedback}>{caption}</motion.p>
    </AnimatePresence>
  </div>;
}

type Cursor = { x: number; y: number; ms: number; shown: boolean; down: boolean };

/** One play of one scene. It mounts fresh for every play, so each starts from its first frame with nothing left over. */
function Stage({ scene, reduced, settings, onDone }: { scene: Scene; reduced: boolean; settings: SignalSettings; onDone: () => void }) {
  const t = useTranslations();
  const [cursor, setCursor] = useState<Cursor>({ x: 0, y: 0, ms: 0, shown: false, down: false });
  const [keyDown, setKeyDown] = useState(false);
  const [selected, setSelected] = useState(false);
  const [bar, setBar] = useState(false);
  const [hover, setHover] = useState(false);
  const [stuck, setStuck] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLElement>(null);
  const button = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => { done.current = onDone; });
  // The slot the demo aims at: 注意 when the wheel holds it, otherwise the wheel's first signal.
  const preferred = settings.wheel.indexOf('attention');
  const slot = Math.max(0, preferred >= 0 ? preferred : settings.wheel.findIndex(entry => !isEmote(entry)));
  const entry = settings.wheel[slot];
  const kind: SignalKind = entry && !isEmote(entry) ? entry as SignalKind : 'attention';
  const wheelKey = settings.wheel.join();

  useLayoutEffect(() => {
    const box = stage.current, node = host.current;
    if (!box || !node) return;
    const w = box.clientWidth, h = box.clientHeight;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, step: () => void) => { timers.push(setTimeout(step, ms)); };
    const move = (x: number, y: number, ms: number, patch: Partial<Cursor> = {}) => setCursor(old => ({ ...old, x, y, ms, shown: true, ...patch }));
    const local = (target: Element | null) => {
      const outer = box.getBoundingClientRect(), inner = target?.getBoundingClientRect();
      return inner ? { left: inner.left - outer.left, top: inner.top - outer.top, width: inner.width, height: inner.height } : { left: w / 2, top: h / 2, width: 0, height: 0 };
    };

    // The real page wheel and pings, in the stage's shadow root, styled exactly as the page layer styles them.
    let wheel: Wheel | undefined, ping: ((signal: SignalKind, x: number, y: number) => void) | undefined;
    const root = node.shadowRoot ?? node.attachShadow({ mode: 'open' });
    if (scene === 'signal') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SIGNAL_CSS);
      root.adoptedStyleSheets = [sheet];
      const art = createSignalManifest('/signals/');
      const pings = document.createElement('div');
      pings.id = 'pings';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'wheel';
      svg.setAttribute('viewBox', '-300 -300 600 600');
      root.replaceChildren(pings, svg);
      wheel = new Wheel(svg, '', () => {});
      wheel.setItems(wheelKey.split(',').map(item => ({ key: item, icon: (art.pings.find(p => p.id === item) ?? art.emotes.find(e => e.id === item))?.icon ?? '' })));
      wheel.setSize(WHEEL_PX);
      svg.querySelector('.backTxt')?.replaceChildren();
      ping = (signal, x, y) => { spawnPing(pings, art.pings.find(p => p.id === signal)!, x, y, { sizePx: PING_PX, durationS: PING_LIFE }); };
    }

    if (scene === 'signal') {
      const p = { x: Math.round(w * .44), y: Math.round(h * .5) };
      const angle = (-90 + slot * 45) * Math.PI / 180, reach = WHEEL_PX * .2;
      const aim = { x: p.x + Math.cos(angle) * reach, y: p.y + Math.sin(angle) * reach };
      const half = { x: p.x + (aim.x - p.x) * .55, y: p.y + (aim.y - p.y) * .55 };
      if (reduced) at(0, () => { wheel?.open(p.x, p.y); wheel?.move(aim.x, aim.y); setKeyDown(true); move(aim.x, aim.y, 0, { down: true }); });
      else {
        at(0, () => move(w * .86, h * .94, 0, { shown: false }));
        at(60, () => move(w * .86, h * .94, 0));
        at(160, () => move(p.x, p.y, 640));
        at(920, () => setKeyDown(true));
        at(1080, () => { move(p.x, p.y, 0, { down: true }); wheel?.open(p.x, p.y); });
        at(1460, () => move(half.x, half.y, 200));
        at(1600, () => wheel?.move(half.x, half.y));
        at(1660, () => move(aim.x, aim.y, 240));
        at(1900, () => wheel?.move(aim.x, aim.y));
        at(2380, () => { wheel?.release(aim.x, aim.y); ping?.(kind, p.x, p.y); setKeyDown(false); move(aim.x, aim.y, 0, { down: false }); });
        at(2750, () => move(aim.x + 26, aim.y + 30, 700));
      }
    } else if (scene === 'quote') {
      const text = local(mark.current);
      const y = text.top + text.height / 2;
      const toButton = (ms: number) => { const target = local(button.current); move(target.left + target.width * .55, target.top + target.height * .6, ms); };
      if (reduced) {
        at(0, () => { setSelected(true); setBar(true); setHover(true); });
        at(30, () => toButton(0));
      } else {
        at(0, () => move(text.left - 8, h * .96, 0, { shown: false }));
        at(60, () => move(text.left - 8, h * .96, 0));
        at(160, () => move(text.left, y, 560));
        at(800, () => { move(text.left, y, 0, { down: true }); setSelected(true); });
        at(830, () => move(text.left + text.width, y, 620));
        at(1500, () => move(text.left + text.width, y, 0, { down: false }));
        at(1640, () => setBar(true));
        at(2080, () => toButton(520));
        at(2560, () => setHover(true));
        at(2880, () => setCursor(old => ({ ...old, ms: 0, down: true })));
        at(3020, () => { setCursor(old => ({ ...old, down: false })); setBar(false); setSelected(false); setHover(false); setStuck(true); });
        at(3360, () => setCursor(old => ({ ...old, x: old.x + 30, y: old.y + 34, ms: 700 })));
      }
    }
    if (!reduced) at(LENGTH[scene], () => done.current());
    return () => { timers.forEach(clearTimeout); wheel?.cancel(); root.replaceChildren(); };
  }, [scene, reduced, slot, kind, wheelKey]);

  const danmaku = [t('extension.tour.demoDanmaku1'), t('extension.tour.demoDanmaku2'), t('extension.tour.demoDanmaku3')];
  return <div ref={stage} className={s.stage} data-scene={scene} aria-hidden="true">
    {scene !== 'quote' && <svg className={s.chart} viewBox="0 0 100 40" preserveAspectRatio="none"><path className={s.area} d={`${CHART} L100 40 L0 40 Z`} /><path className={s.line} d={CHART} /></svg>}
    {scene === 'signal' && <span className={s.held} data-down={keyDown || undefined}><Keys value={settings.key} /></span>}
    {scene === 'quote' && <p className={s.page}>
      {t.rich('extension.tour.demoText', { mark: chunks => <mark ref={mark} className={s.mark} data-selected={selected || undefined} data-stuck={stuck || undefined}>{chunks}{stuck && <i className={s.pin} />}</mark> })}
    </p>}
    <AnimatePresence>{bar && <motion.span key="bar" ref={node => place(node, mark.current, stage.current)} className={s.bar}
      initial={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .96 }}
      transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 520, damping: 34 }}>
      <span>{t('extension.sticky.quote')}</span><span ref={button} data-hover={hover || undefined}>{t('extension.sticky.add')}</span>
    </motion.span>}</AnimatePresence>
    {scene === 'danmaku' && <span className={s.lanes} data-still={reduced || undefined}>
      {danmaku.map((line, index) => <span key={index} className={s.dm} data-lane={index} data-mate={index === 1 || undefined}>{line}</span>)}
    </span>}
    <span ref={host} className={s.signals} />
    <svg className={s.cursor} viewBox="0 0 14 20" data-down={cursor.down || undefined} data-shown={cursor.shown || undefined}
      style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transitionDuration: `${cursor.ms}ms, 160ms, 120ms` }}>
      <path d="M1 1 L1 15.6 L4.8 12.2 L7.6 18.6 L10.2 17.5 L7.5 11.3 L12.6 11.3 Z" />
    </svg>
  </div>;
}

/** The float bar sits just under the selection, centred on it, as the page layer places it; kept inside the stage. */
function place(bar: HTMLElement | null, mark: Element | null, stage: Element | null) {
  if (!bar || !mark || !stage) return;
  const outer = stage.getBoundingClientRect(), inner = mark.getBoundingClientRect();
  const left = inner.left - outer.left + inner.width / 2 - bar.offsetWidth / 2;
  bar.style.left = `${Math.max(6, Math.min(outer.width - bar.offsetWidth - 6, left))}px`;
  bar.style.top = `${Math.min(outer.height - bar.offsetHeight - 6, inner.bottom - outer.top + 6)}px`;
}
