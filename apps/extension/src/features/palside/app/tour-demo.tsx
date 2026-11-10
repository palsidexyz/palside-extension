'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Wheel, createSignalManifest, signalArtCss, spawnPing } from '@palside/shared/signal-art';
import { motionPresets } from '@palside/design/motion';
import { isEmote, type SignalKind, type SignalSettings } from '../../../runtime/annotations/signals';
import { Keys } from '../settings/signal-settings';
import { ChartPage, chartEnd, chartGeometry, chartStart, type ChartGeometry, type ChartState } from './tour-chart';
import { DM_LINES, DM_MS, DanmakuLayer, HELD, LANES, type Card } from './tour-danmaku';
import s from './tour-demo.module.css';

/** What 网页互动 puts on a page, in the order the demo plays them. */
const scenes = ['signal', 'danmaku', 'chart'] as const;
type Scene = typeof scenes[number];
/** How long each scene plays before the next; the tab's bar fills over the same time. */
const LENGTH: Record<Scene, number> = { signal: 5400, danmaku: 6200, chart: 7000 };
/** The page wheel at a size that fits the 144px stage (its ring is 376/600 of this), and the ping it sends. */
const WHEEL_PX = 196, PING_PX = 46, PING_LIFE = 1.7, MATE_LIFE = 3.2;
/** The 弹幕 card's width at most, so it never runs past the stage's right edge. */
const CARD_W = 116;
const SIGNAL_CSS = `${signalArtCss}#pings{position:absolute;inset:0}`;

/**
 * A small looping page inside the 网页互动 bubble, all on one token site's chart: a teammate's signal lands and you answer from the
 * real wheel with your own shortcut (the caption's key presses with it), 弹幕 cross the page and a hovered line holds to say who
 * wrote it, and lines are shared from the chart's toolbar. The tabs jump to a scene; with reduced motion nothing plays and each tab
 * shows its scene's final frame.
 */
export function TourDemo({ settings }: { settings: SignalSettings }) {
  const t = useTranslations();
  const reduced = useReducedMotion() ?? false;
  const [scene, setScene] = useState<Scene>('signal');
  const [run, setRun] = useState(0);
  const [held, setHeld] = useState(false);
  const go = (next: Scene) => { setScene(next); setRun(value => value + 1); setHeld(false); };
  const labels: Record<Scene, string> = { signal: t('extension.web.signal'), danmaku: t('extension.room.name'), chart: t('extension.web.chart') };
  const caption = {
    signal: <><span className={s.held} data-down={held || undefined}><Keys value={settings.key} /></span><span>{t('extension.tour.signalHow')}</span></>,
    danmaku: <span>{t('extension.tour.danmakuHow')}</span>,
    chart: <span>{t('extension.tour.chartHow')}</span>,
  }[scene];
  return <div className={s.demo}>
    <div className={s.tabs} role="group" aria-label={t('extension.settings.interaction')}>
      {scenes.map(item => <button key={item} type="button" aria-pressed={scene === item} onClick={() => go(item)}>
        {scene === item && <motion.span layoutId="tour-demo-tab" className={s.pill} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 420, damping: 36 }} />}
        <span className={s.label}>{labels[item]}</span>
        {scene === item && !reduced && <i key={run} className={s.progress} style={{ animationDuration: `${LENGTH[item]}ms` }} />}
      </button>)}
    </div>
    <Stage key={`${scene}-${run}`} scene={scene} reduced={reduced} settings={settings} onKey={setHeld}
      onDone={() => go(scenes[(scenes.indexOf(scene) + 1) % scenes.length]!)} />
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p key={scene} className={s.caption} initial={{ opacity: 0, y: reduced ? 0 : 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={motionPresets.feedback}>{caption}</motion.p>
    </AnimatePresence>
  </div>;
}

type Cursor = { x: number; y: number; ms: number; shown: boolean; down: boolean; cross?: boolean };

/** One play of one scene. It mounts fresh for every play, so each starts from its first frame with nothing left over. */
function Stage({ scene, reduced, settings, onKey, onDone }: { scene: Scene; reduced: boolean; settings: SignalSettings; onKey: (down: boolean) => void; onDone: () => void }) {
  const [cursor, setCursor] = useState<Cursor>({ x: 0, y: 0, ms: 0, shown: false, down: false });
  const t = useTranslations();
  const [card, setCard] = useState<Card>();
  const [geo, setGeo] = useState<ChartGeometry>();
  const [chart, setChart] = useState<ChartState>(chartStart);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone), key = useRef(onKey);
  useLayoutEffect(() => { done.current = onDone; key.current = onKey; });
  // The slot the demo aims at: 注意 when the wheel holds it, otherwise the wheel's first signal.
  const preferred = settings.wheel.indexOf('attention');
  const slot = Math.max(0, preferred >= 0 ? preferred : settings.wheel.findIndex(entry => !isEmote(entry)));
  const entry = settings.wheel[slot];
  const kind: SignalKind = entry && !isEmote(entry) ? entry as SignalKind : 'attention';
  const wheelKey = settings.wheel.join();
  // The teammate's signal: 盯 when it is not the one you send, otherwise 提问.
  const mateKind: SignalKind = kind === 'watch' ? 'question' : 'watch';
  const mateName = t('extension.tour.demoMate');

  useLayoutEffect(() => {
    const box = stage.current, node = host.current;
    if (!box || !node) return;
    const w = box.clientWidth, h = box.clientHeight;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, step: () => void) => { timers.push(setTimeout(step, ms)); };
    const move = (x: number, y: number, ms: number, patch: Partial<Cursor> = {}) => setCursor(old => ({ ...old, x, y, ms, shown: true, ...patch }));

    const g = chartGeometry(w, h);
    setGeo(g);
    const setKeyDown = (down: boolean) => key.current(down);

    // The real page wheel and pings, in the stage's shadow root, styled exactly as the page layer styles them.
    let wheel: Wheel | undefined, ping: ((signal: SignalKind, x: number, y: number, from?: string) => void) | undefined;
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
      // A teammate's signal carries their name, as on the page; it stays a little longer so the answer meets it.
      ping = (signal, x, y, from) => {
        spawnPing(pings, art.pings.find(p => p.id === signal)!, x, y, { sizePx: PING_PX, durationS: from ? MATE_LIFE : PING_LIFE, keep: reduced, ...(from ? { tag: { name: from, color: 0 } } : {}) });
      };
    }

    if (scene === 'signal') {
      const p = { x: Math.round(w * .44), y: Math.round(h * .5) };
      // The teammate marks the newest candles, right of where your wheel opens.
      const mate = g.stage({ x: g.x(17), y: g.y(58) });
      const angle = (-90 + slot * 45) * Math.PI / 180, reach = WHEEL_PX * .2;
      const aim = { x: p.x + Math.cos(angle) * reach, y: p.y + Math.sin(angle) * reach };
      const half = { x: p.x + (aim.x - p.x) * .55, y: p.y + (aim.y - p.y) * .55 };
      if (reduced) at(0, () => { ping?.(mateKind, mate.x, mate.y, mateName); wheel?.open(p.x, p.y); wheel?.move(aim.x, aim.y); setKeyDown(true); move(aim.x, aim.y, 0, { down: true }); });
      else {
        at(200, () => ping?.(mateKind, mate.x, mate.y, mateName));
        at(700, () => move(w * .86, h * .94, 0));
        at(800, () => move(p.x, p.y, 640));
        at(1560, () => setKeyDown(true));
        at(1720, () => { move(p.x, p.y, 0, { down: true }); wheel?.open(p.x, p.y); });
        at(2100, () => move(half.x, half.y, 200));
        at(2240, () => wheel?.move(half.x, half.y));
        at(2300, () => move(aim.x, aim.y, 240));
        at(2540, () => wheel?.move(aim.x, aim.y));
        at(3020, () => { wheel?.release(aim.x, aim.y); ping?.(kind, p.x, p.y); setKeyDown(false); move(aim.x, aim.y, 0, { down: false }); });
        at(3380, () => move(aim.x + 26, aim.y + 30, 700));
      }
    }

    // 弹幕 fly at one pace from the right edge; the pointer meets the teammate's line, which holds while hovered.
    const flights: Animation[] = [];
    if (scene === 'danmaku') {
      const lines = [...box.querySelectorAll<HTMLElement>('[data-dm]')];
      const HOLD = 2900, REACH = 600, laneTop = LANES[DM_LINES[HELD]!.lane];
      lines.forEach((element, index) => {
        const flight = element.animate([{ transform: `translateX(${w}px)` }, { transform: `translateX(${-element.offsetWidth}px)` }], { duration: DM_MS, fill: 'both' });
        flight.currentTime = DM_LINES[index]!.at * DM_MS + (reduced ? HOLD : 0);
        if (reduced) flight.pause();
        flights.push(flight);
      });
      const target = lines[HELD], flight = flights[HELD];
      const spot = (ahead: number) => {
        const width = target!.offsetWidth, progress = (Number(flight!.currentTime) + ahead) / DM_MS;
        return { x: w - progress * (w + width), width };
      };
      const hold = () => {
        flight?.pause();
        const { x, width } = spot(0);
        setCard({ x: Math.max(4, Math.min(x, w - 4 - CARD_W)), y: laneTop - 26 });
        return { x, width };
      };
      if (target && flight) {
        if (reduced) at(0, hold);
        else {
          at(HOLD - REACH - 700, () => move(w * .78, h * .96, 0));
          at(HOLD - REACH, () => { const { x, width } = spot(REACH); move(x + Math.min(width * .45, 44), laneTop + 12, REACH); });
          at(HOLD, hold);
          at(HOLD + 1600, () => { setCard(undefined); flight.play(); setCursor(old => ({ ...old, x: old.x + 10, y: h * .9, ms: 520 })); });
        }
      }
    }
    if (scene === 'chart') {
      const set = (patch: Partial<ChartState>) => setChart(old => ({ ...old, ...patch }));
      const entry = g.stage(g.entry), track = g.stage(g.track), tool = g.stage(g.trendTool), a = g.stage(g.mine[0]), b = g.stage(g.mine[1]);
      if (reduced) at(0, () => setChart(chartEnd));
      else {
        // A teammate's line arrives with their tag; you open the entry, turn on 共享给小队, pick the site's trend line and draw.
        at(250, () => set({ mate: true }));
        at(650, () => set({ tag: true }));
        at(900, () => move(w * .82, h * .92, 0));
        at(1000, () => move(entry.x + 2, entry.y + 2, 640));
        at(1720, () => move(entry.x + 2, entry.y + 2, 0, { down: true }));
        at(1840, () => { move(entry.x + 2, entry.y + 2, 0, { down: false }); set({ panel: true }); });
        at(2200, () => move(track.x, track.y, 480));
        at(2780, () => move(track.x, track.y, 0, { down: true }));
        at(2900, () => { move(track.x, track.y, 0, { down: false }); set({ on: true }); });
        at(3350, () => move(tool.x + 2, tool.y + 2, 520));
        // The press outside closes the panel, as on the page.
        at(3950, () => { move(tool.x + 2, tool.y + 2, 0, { down: true }); set({ panel: false }); });
        at(4070, () => { move(tool.x + 2, tool.y + 2, 0, { down: false }); set({ tool: true }); });
        at(4250, () => move(a.x, a.y, 480));
        // Past the rail the pointer is over the chart, where an armed tool shows the crosshair.
        at(4380, () => setCursor(old => ({ ...old, cross: true })));
        at(4820, () => { move(a.x, a.y, 0, { down: true }); set({ mine: 'start' }); });
        at(4900, () => { move(b.x, b.y, 820); set({ mine: 'drawing', ms: 820 }); });
        at(5760, () => { move(b.x, b.y, 0, { down: false }); set({ mine: 'done', tool: false }); });
        at(5900, () => set({ tag: false }));
        at(6050, () => move(b.x + 18, b.y + 22, 600));
      }
    }
    if (!reduced) at(LENGTH[scene], () => done.current());
    return () => { timers.forEach(clearTimeout); flights.forEach(flight => flight.cancel()); wheel?.cancel(); root.replaceChildren(); };
  }, [scene, reduced, slot, kind, mateKind, mateName, wheelKey]);

  return <div ref={stage} className={s.stage} aria-hidden="true">
    {geo && <ChartPage geo={geo} state={scene === 'chart' ? chart : chartStart} />}
    {scene === 'danmaku' && <DanmakuLayer card={card} />}
    <span ref={host} className={s.signals} />
    <svg className={s.cursor} viewBox="0 0 14 20" data-down={cursor.down || undefined} data-shown={cursor.shown || undefined} data-cross={cursor.cross || undefined}
      style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transitionDuration: `${cursor.ms}ms, 160ms, 120ms` }}>
      {cursor.cross ? <path className={s.cross} d="M1 -7 V9 M-7 1 H9" /> : <path d="M1 1 L1 15.6 L4.8 12.2 L7.6 18.6 L10.2 17.5 L7.5 11.3 L12.6 11.3 Z" />}
    </svg>
  </div>;
}
