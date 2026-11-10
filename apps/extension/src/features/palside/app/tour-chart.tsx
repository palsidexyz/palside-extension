'use client';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import s from './tour-chart.module.css';

/**
 * The 共享画线 scene of the tour demo: a token site's dark TradingView chart as the page layer meets it (page-layer/chart-marks.ts).
 * The Palside entry sits first in the chart's drawing rail with the teammates' shape count, its panel opens beside it, a teammate's
 * line carries their name tag, and your own line keeps TradingView's trend-line blue. Sizes are the real ones scaled to the stage.
 */

/** OHLC candles in price units: lows rise and highs fall into a triangle, so the two lines read as real analysis. */
const CANDLES: readonly (readonly [number, number, number, number])[] = [
  [30, 45, 22, 42], [42, 70, 40, 66], [66, 88, 60, 62], [62, 64, 30, 34], [34, 52, 32, 50], [50, 72, 48, 70], [70, 80, 66, 68],
  [68, 70, 44, 46], [46, 50, 38, 40], [40, 62, 39, 60], [60, 72, 58, 68], [68, 69, 52, 54], [54, 56, 44, 48], [48, 64, 47, 62],
  [60, 64, 58, 61], [61, 61, 54, 56], [56, 59, 53, 58], [58, 58, 55, 57], [57, 57, 55, 56], [56, 60, 55, 59],
];
const LOW = 18, HIGH = 92;
/** The page is laid out at twice the stage's size and shown at half (tour-chart.module.css). */
const K = 2;
/** In page pixels: interval bar height, rail width, price axis width, one rail row and the rule under the entry. */
const TOP = 40, RAIL = 56, AXIS = 60, ROW = 44, SEP = 10;
const LOGO = 'M38 33H90A4 4 0 0 1 94 37V75A4 4 0 0 1 90 79H59.333Q58 79 56.933 79.8L36.4 95.2Q34 97 34 94V37A4 4 0 0 1 38 33Z';
const TOOLS = {
  crosshair: <path d="M12 3v7M12 14v7M3 12h7M14 12h7" />,
  trendLine: <><circle cx="5.5" cy="18.5" r="1.8" /><circle cx="18.5" cy="5.5" r="1.8" /><path d="M6.8 17.2 17.2 6.8" /></>,
  fibLines: <><path d="M4 5h12M4 10h16M4 14h16M4 19h12" /><circle cx="18.5" cy="5" r="1.5" /><circle cx="18.5" cy="19" r="1.5" /></>,
  brush: <><path d="M4 20c1.4-.2 3.2-.9 3.9-2.6.6-1.5-.3-3-1.8-3-1.6 0-2.6 1.6-2.4 3.2.1 1.2-.2 2.1.3 2.4Z" /><path d="m9.4 14.4 10-9.8" /></>,
};
/** The panel's own icons (page-layer/chart-marks.ts). */
const PANEL_ICONS = {
  sync: <><path d="M5 19 13.5 10.5" /><circle cx="4" cy="20" r="1.5" /><circle cx="14.5" cy="9.5" r="1.5" /><path d="M17.6 6.4a4.4 4.4 0 0 1 0 6.2M19.8 4.2a7.5 7.5 0 0 1 0 10.6" /></>,
  mark: <><path d="M10 5.5 20 11l-4.4 1.3-1.4 4.5z" /><path d="M3.8 20.5c1.4-3 3.8-4.7 6.9-4.9" strokeDasharray="1.8 2.2" /></>,
  eye: <><path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.6" /></>,
};
const Icon = ({ paths }: { paths: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>;

export type Point = { x: number; y: number };
/**
 * Where things sit on a stage of this size, in page pixels: candle centres, the two lines, and the rail controls the pointer aims at.
 * `stage` turns a page point into the stage's pixels, where the pointer moves.
 */
export function chartGeometry(stageW: number, stageH: number) {
  const w = stageW * K, h = stageH * K;
  const left = RAIL + 2, right = w - AXIS, step = (right - left - 16) / CANDLES.length;
  const x = (i: number) => left + 8 + step * (i + .5);
  const y = (price: number) => TOP + 20 + (HIGH - price) / (HIGH - LOW) * (h - TOP - 44);
  const support = (i: number) => 30 + (44 - 30) / 9 * (i - 3);
  const railRow = (row: number) => ({ x: RAIL / 2, y: TOP + 8 + ROW * row + ROW / 2 + (row ? SEP : 0) });
  const panel = { x: RAIL + 8, y: TOP + 4 };
  return {
    w, h, x, y, step, right,
    stage: (p: Point) => ({ x: p.x / K, y: p.y / K }),
    mate: [{ x: x(3), y: y(support(3)) }, { x: x(17), y: y(support(17)) }] as const,
    mine: [{ x: x(2), y: y(88) }, { x: x(15), y: y(88 - 2 * 13) }] as const,
    entry: railRow(0), trendTool: railRow(2),
    /** The panel opens beside the entry, top-aligned with it; the switch ends its first row (236 wide, 12 inset, 40 track). */
    panel, track: { x: panel.x + 236 - 2 - 12 - 20, y: panel.y + 2 + 6 + 26 },
  };
}
export type ChartGeometry = ReturnType<typeof chartGeometry>;
/** What the scene shows at a moment: the teammate's line and tag, the panel, 共享给小队, the armed tool, and how far your line is drawn. */
export type ChartState = { mate: boolean; tag: boolean; panel: boolean; on: boolean; tool: boolean; mine: 'none' | 'start' | 'drawing' | 'done'; ms: number };
export const chartStart: ChartState = { mate: false, tag: false, panel: false, on: false, tool: false, mine: 'none', ms: 0 };
export const chartEnd: ChartState = { mate: true, tag: true, panel: false, on: true, tool: false, mine: 'done', ms: 0 };

const at = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

export function ChartPage({ geo, state }: { geo: ChartGeometry; state: ChartState }) {
  const t = useTranslations();
  const { w, h, x, y, step } = geo;
  const body = Math.max(3, Math.round(step * .62));
  const last = CANDLES.at(-1)!;
  const ticks = [80, 60, 40];
  return <div className={s.page} data-on={state.on || undefined}>
    <div className={s.top}><b>PALS</b><i /><span>1m</span><span>5m</span><span data-on>15m</span><span>1h</span><span>D</span></div>
    <div className={s.rail}>
      <span className={s.entry}>
        <svg viewBox="0 0 128 128" aria-hidden="true"><rect className={s.square} x="4" y="4" width="120" height="120" rx="32" /><path className={s.hole} d={LOGO} />
          <circle className={s.eye} cx="53" cy="56" r="5" /><circle className={s.eye} cx="75" cy="56" r="5" /></svg>
        {state.mate && <b className={s.badge}>1</b>}
      </span>
      <i className={s.sep} />
      {(Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map(name =>
        <span key={name} className={s.tool} data-on={(name === 'trendLine' && state.tool) || undefined}><Icon paths={TOOLS[name]} /></span>)}
    </div>
    <svg className={s.plot} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {ticks.map(price => <line key={price} className={s.grid} x1={RAIL + 2} x2={geo.right} y1={y(price)} y2={y(price)} />)}
      {CANDLES.map(([open, high, low, close], i) => {
        const up = close >= open, top = y(Math.max(open, close)), bottom = y(Math.min(open, close));
        return <g key={i} className={up ? s.up : s.down}>
          <line x1={x(i)} x2={x(i)} y1={y(high)} y2={y(low)} />
          <rect x={x(i) - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} />
        </g>;
      })}
      <path className={s.mate} data-shown={state.mate || undefined} pathLength={1} d={`M${at(geo.mate[0])}L${at(geo.mate[1])}`} />
      <path className={s.mine} data-mine={state.mine} pathLength={1} style={{ transitionDuration: `${state.ms}ms` }} d={`M${at(geo.mine[0])}L${at(geo.mine[1])}`} />
      {state.mine !== 'none' && <circle className={s.handle} cx={geo.mine[0].x} cy={geo.mine[0].y} r={6.4} />}
      {state.mine === 'done' && <circle className={s.handle} cx={geo.mine[1].x} cy={geo.mine[1].y} r={6.4} />}
    </svg>
    <div className={s.axis}>
      {ticks.map(price => <span key={price} style={{ top: y(price) - 12 }}>{(price / 1000).toFixed(3)}</span>)}
      <span className={s.last} style={{ top: y(last[3]) - 12 }}>{(last[3] / 1000).toFixed(3)}</span>
    </div>
    <span className={s.tag} data-shown={state.tag || undefined} style={{ left: geo.mate[1].x - 28, top: geo.mate[1].y + 10 }}>{t('extension.tour.demoMate')}</span>
    <div className={s.panel} data-open={state.panel || undefined} style={{ left: geo.panel.x, top: geo.panel.y }}>
      <span className={s.item}><Icon paths={PANEL_ICONS.sync} /><b>{t('extension.chart.sync')}</b><span className={s.track} /></span>
      <span className={s.item}><Icon paths={PANEL_ICONS.mark} /><b>{t('extension.chart.mark')}</b></span>
      <hr />
      <span className={s.head}><span>{t('extension.chart.members')}</span><span className={s.num}>1</span><Icon paths={PANEL_ICONS.eye} /></span>
      <span className={s.person}><span className={s.face}>{t('extension.tour.demoMate').slice(0, 1)}</span><span className={s.name}>{t('extension.tour.demoMate')}</span><span className={s.num}>1</span><Icon paths={PANEL_ICONS.eye} /></span>
    </div>
  </div>;
}
