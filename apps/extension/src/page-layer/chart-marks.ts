import { CHART_LASER_MS,CHART_POINTS,type ChartPoint } from '../runtime/annotations/chart-marks';
import { readChartDrawingGeometry,thinDrawingPoints,type ChartAxis } from '../runtime/annotations/chart-drawings';
import type { PageChartMark,PageDrawing,PageDrawingPerson,PageUp } from '../runtime/browser/page-protocol';
import { CHART_ASK_EVENT,CHART_BRIDGE_EVENT,CHART_DRAW_EVENT,CHART_SHAPES_EVENT,CHART_SHOW_EVENT,CHART_SHOWN_EVENT,CHART_VALUE_EVENT,CHART_VALUE_REPLY,chartScale,readChartBridge,readChartDraw,readChartShow,readChartValue,thinPath,type ChartGeometry,type ChartScale,type ChartShapeOrder,type ChartShapes,type ChartShow } from './chart-scale';
import { avatarTints,chartRim,chartTints,chartToolbar,paletteCss } from './palette';

/**
 * 共享画线 on a TradingView chart. Drawings are the site's own tools and real chart shapes: the bridge reports what you draw, and with
 * 共享给小队 on it goes to the squad; teammates' drawings come back as locked shapes that stay on the candles. The page layer's part is
 * one entry, the Palside logo as the first button of the site's drawing toolbar, made from the toolbar's own markup so it looks and
 * behaves like its neighbours, and the panel it opens (共享给小队, 激光笔, who drew). When the site collapses that toolbar the entry
 * follows into the site's own toolbar row right above the chart, after its first group (the intervals), and the panel opens downwards; with neither there is no entry.
 * The panel, name tags and 激光笔 strokes live in a closed root fixed to the chart frame's viewport. Synced is never shown before it
 * is true: a drawing that fails says so and stays yours.
 *
 * Drawings and strokes made on another axis (price against market cap, another quote currency) are scaled by this chart's own open on
 * the candle they carry, and stay off the chart until it is known: never in the wrong place.
 */
const TINTS = chartTints;
const TAG_MS = 5_000, TAIL_MS = 600, NOTE_MS = 3_000;
/** The first look's guide waits this long after the entry appears, so it lands on a settled chart. */
const GUIDE_MS = 800;
/** Until the entry is first opened, a small moment every 2.5–5 seconds: blinks, and every third time the pen draws a line. */
const IDLE_MS = 2_500, IDLE_SPREAD = 2_500;
const SPRING = 'cubic-bezier(.22,1.3,.36,1)';
/** A drawing counts as drawn only this soon after real input in the chart's frame: a site restoring its saved drawings never sends them. */
const INPUT_MS = 8_000;
/** A chart that had no candle for another axis's drawing is asked again after this long: it may have loaded more history. */
const OPEN_RETRY_MS = 10_000;
/** A drawing this fresh arrives with its author's name beside it; older ones are simply there. */
const FRESH_MS = 20_000;
/** Showing a drawing from the chat waits this long for its chart, asking again at this pace; the page's answer is due in 5 seconds. */
const REVEAL_WAIT_MS = 4_000, REVEAL_RETRY_MS = 300;
/** The bridge answers a show request at once; no answer means it has not loaded in that frame. */
const SHOW_ANSWER_MS = 400;
/** One show request to one chart frame: whether the bridge found the drawing there. */
function askShow(frame: HTMLIFrameElement, show: ChartShow) {
  return new Promise<'shown' | 'outside' | undefined>(resolve => {
    const done = (value: 'shown' | 'outside' | undefined) => { clearTimeout(timer); frame.removeEventListener(CHART_SHOWN_EVENT, answer); resolve(value); };
    const answer = (event: Event) => { const reply = readChartShow((event as CustomEvent).detail); if (reply?.id === show.id) done(reply.shown ? 'shown' : reply.outside ? 'outside' : undefined); };
    const timer = setTimeout(() => done(undefined), SHOW_ANSWER_MS);
    frame.addEventListener(CHART_SHOWN_EVENT, answer);
    frame.dispatchEvent(new CustomEvent(CHART_SHOW_EVENT, { detail: JSON.stringify(show) }));
  });
}
/** From this many people the list gets a search field. */
const SEARCH_FROM = 9;
const logoPath = 'M38 33H90A4 4 0 0 1 94 37V75A4 4 0 0 1 90 79H59.333Q58 79 56.933 79.8L36.4 95.2Q34 97 34 94V37A4 4 0 0 1 38 33Z';
/** The trend line the idle 画一笔 draws inside the bubble, with its two end points. */
const penPath = 'M46 69L58 58L67 63L83 45';
/**
 * The brand mark, filling the whole button (34px, the size of the site's hover plate): in colour while 共享给小队 is on; in the
 * toolbar's own ink, hole cut to its background, while off, the eyes still in the accent on dark charts so it reads as Palside.
 * The eyes and the hidden pen are the parts the idle moments move.
 */
const logo = (on: boolean, hole: string, isDark: boolean) => {
  const accent = chartTints[0], mark = on || isDark ? accent : 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="34" height="34" aria-hidden="true" style="display:block;margin:-3px;overflow:visible">`
    + `<rect x="4" y="4" width="120" height="120" rx="32" fill="${on ? accent : 'currentColor'}"/><path d="${logoPath}" fill="${on ? chartToolbar.logoInk : hole}"/>`
    + `<g data-eyes><circle cx="53" cy="56" r="5" fill="${mark}"/><circle cx="75" cy="56" r="5" fill="${mark}"/></g>`
    + `<g data-pen opacity="0"><path d="${penPath}" fill="none" stroke="${mark}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>`
    + `<circle cx="46" cy="69" r="4.5" fill="${mark}" opacity="0"/><circle cx="83" cy="45" r="4.5" fill="${mark}" opacity="0"/></g></svg>`;
};
const icons = {
  sync: '<path d="M5 19 13.5 10.5"/><circle cx="4" cy="20" r="1.5"/><circle cx="14.5" cy="9.5" r="1.5"/><path d="M17.6 6.4a4.4 4.4 0 0 1 0 6.2M19.8 4.2a7.5 7.5 0 0 1 0 10.6"/>',
  mark: '<path d="M10 5.5 20 11l-4.4 1.3-1.4 4.5z"/><path d="M3.8 20.5c1.4-3 3.8-4.7 6.9-4.9" stroke-dasharray="1.8 2.2"/>',
  eye: '<path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4.5 4.5l15 15"/><path d="M9.2 6.3A9 9 0 0 1 12 5.8c5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.9 3.5M6 8a15.6 15.6 0 0 0-3.2 4s3.4 6.2 9.2 6.2c1 0 2-.2 2.9-.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  clear: '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/>',
};
const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const style = paletteCss + `
  :host { --bg: ${chartToolbar.dark.surface}; --fg: ${chartToolbar.dark.ink}; --line: ${chartToolbar.dark.line}; --hover: ${chartToolbar.dark.hover}; --font: system-ui, sans-serif; }
  * { box-sizing: border-box; }
  .plot { position: absolute; left: 0; top: 0; overflow: hidden; pointer-events: none; }
  .plot[data-tool] { pointer-events: auto; cursor: crosshair; touch-action: none; }
  canvas { position: absolute; left: 0; top: 0; pointer-events: none; }
  .tag { position: absolute; left: 0; top: 0; height: 18px; padding: 0 6px; border-radius: 999px; font: 600 11px/18px var(--font); color: var(--pl-chart-tag-ink); white-space: nowrap; pointer-events: none; transition: opacity .3s; }
  .tag[data-gone] { opacity: 0; }
  button, input { font: inherit; color: inherit; border: 0; background: transparent; padding: 0; margin: 0; }
  button { cursor: pointer; }
  button:focus-visible, .person:focus-visible { outline: 2px solid var(--pl-focus); outline-offset: -2px; }
  svg { display: block; flex: none; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .panel { position: absolute; width: max-content; min-width: 160px; max-width: 232px; padding: 4px 0; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px ${chartToolbar.shadow}; color: var(--fg); font: 400 14px/20px var(--font); pointer-events: auto; display: flex; flex-direction: column; opacity: 0; transform: translateX(-4px); visibility: hidden; transition: opacity .12s, transform .16s cubic-bezier(.2,.8,.2,1), visibility 0s .16s; }
  .panel[data-below]:not([data-on]), .note[data-below]:not([data-on]) { transform: translateY(-4px); }
  .panel[data-on] { opacity: 1; transform: none; visibility: visible; transition: opacity .12s, transform .16s cubic-bezier(.2,.8,.2,1); }
  .item { display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; text-align: start; transition: background-color .12s; }
  .item:hover, .item[aria-pressed="true"] { background: var(--hover); }
  .item b { flex: 1; min-width: 0; margin-right: 8px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { font-size: 12px; line-height: 16px; color: color-mix(in srgb, var(--fg) 58%, transparent); }
  .track { position: relative; flex: none; width: 30px; height: 18px; border-radius: 999px; background: var(--line); transition: background-color .16s; }
  .track::after { content: ''; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--fg); transition: transform .18s cubic-bezier(.2,.8,.2,1), background-color .16s; }
  [aria-checked="true"] > .track { background: var(--pl-accent); }
  [aria-checked="true"] > .track::after { transform: translateX(12px); background: var(--pl-on-accent); }
  hr { width: 100%; height: 1px; margin: 4px 0; border: 0; background: var(--line); flex: none; }
  .head { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 6px 0 12px; }
  .head .muted { flex: 1; }
  .num { flex: none; min-width: 16px; text-align: end; font-size: 12px; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--fg) 58%, transparent); transition: opacity .2s; }
  .eye { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 6px; color: var(--fg); transition: background-color .12s, color .12s; }
  .eye:hover { background: var(--hover); }
  .eye[aria-pressed="false"] { color: color-mix(in srgb, var(--fg) 45%, transparent); }
  .eye svg { width: 18px; height: 18px; }
  .find { display: flex; align-items: center; gap: 8px; height: 32px; margin: 2px 8px 4px; padding: 0 8px; border-radius: 6px; background: var(--hover); color: color-mix(in srgb, var(--fg) 58%, transparent); }
  .find svg { width: 16px; height: 16px; }
  .find input { flex: 1; min-width: 0; height: 100%; color: var(--fg); outline: none; caret-color: var(--fg); }
  .find input::placeholder { color: inherit; }
  .find input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
  .clear { display: grid; place-items: center; flex: none; width: 20px; height: 20px; margin-right: -2px; border-radius: 50%; opacity: 0; pointer-events: none; transition: opacity .12s, color .12s, background-color .12s; }
  .find[data-filled] .clear { opacity: 1; pointer-events: auto; }
  .clear:hover { color: var(--fg); background: var(--line); }
  .clear svg { width: 14px; height: 14px; stroke-width: 1.6; }
  .list { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .person { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 6px 0 12px; cursor: pointer; outline: none; transition: background-color .12s; }
  .person:hover { background: var(--hover); }
  .person .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: opacity .2s; }
  .person[data-hidden] .name, .person[data-hidden] .num, .person[data-hidden] .face { opacity: .45; }
  .person[data-hidden] .face { filter: grayscale(1); }
  .face { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; overflow: hidden; background-size: cover; background-position: center; color: var(--pl-chart-tag-ink); font: 600 11px/22px var(--font); transition: filter .2s, opacity .2s; }
  .note { position: absolute; max-width: 232px; padding: 6px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px ${chartToolbar.shadow}; color: var(--fg); font: 400 13px/18px var(--font); white-space: nowrap; pointer-events: none; opacity: 0; transform: translateX(-4px); transition: opacity .14s, transform .16s cubic-bezier(.2,.8,.2,1); }
  .note[data-on] { opacity: 1; transform: none; }
  .note[data-tone="error"] { color: var(--pl-error); }
  .guide { position: absolute; width: 232px; padding: 12px 12px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px ${chartToolbar.shadow}; color: var(--fg); font: 400 13px/19px var(--font); pointer-events: auto; opacity: 0; visibility: hidden; transform: translateX(-8px) scale(.96); transform-origin: 0 var(--arrow-y, 20px); transition: opacity .14s, transform .2s cubic-bezier(.2,.8,.2,1), visibility 0s .2s; }
  .guide[data-on] { opacity: 1; visibility: visible; transform: none; transition: opacity .18s, transform .36s cubic-bezier(.22,1.3,.36,1); }
  .guide[data-below] { transform-origin: var(--arrow-x, 20px) 0; }
  .guide[data-below]:not([data-on]) { transform: translateY(-8px) scale(.96); }
  .guide[data-below]::before { left: calc(var(--arrow-x, 20px) - 6px); top: -7px; border-bottom: 0; border-top: 1px solid var(--line); }
  .guide::before { content: ''; position: absolute; left: -7px; top: calc(var(--arrow-y, 20px) - 6px); width: 12px; height: 12px; background: var(--bg); border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
  .guide b { display: block; margin-bottom: 4px; font-size: 14px; line-height: 20px; font-weight: 600; }
  .guide p { margin: 0; color: color-mix(in srgb, var(--fg) 72%, transparent); text-wrap: pretty; }
  .guide .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px -4px 0 -6px; }
  .guide .foot button { height: 28px; padding: 0 12px; border-radius: 6px; font-weight: 600; transition: transform .12s, background-color .12s; }
  .guide .foot button:active { transform: scale(.96); }
  .guide .foot .quiet { padding: 0 6px; font-weight: 400; color: color-mix(in srgb, var(--fg) 58%, transparent); }
  .guide .foot .quiet:hover { background: var(--hover); }
  .guide .foot .done { background: var(--pl-accent); color: var(--pl-on-accent); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

type Stroke = { points: ChartPoint[]; startedAt: number };
type Pending = { requestId: string; points: ChartPoint[]; sentAt: number };
/** The toolbar button made from TradingView's own first button, and the parts that change. */
type Entry = { place: EntryPlace; group: HTMLElement; button: HTMLButtonElement; icon: HTMLElement; plate: HTMLElement; badge: HTMLSpanElement; drawn?: string };
/** `side`: first in the chart's drawing toolbar. `top`: in the site's toolbar row above the chart, while that toolbar is collapsed. */
type EntryPlace = 'side' | 'top';
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
/** The site's row above the chart: its bottom within this many pixels of the chart, at most this tall. */
const TOP_ROW_GAP = 24, TOP_ROW_HEIGHT = 64;
/** The entry in the site's row: a 28px button, the logo at 22px, plates in the chart toolbar's own hover tone. */
const topEntryStyle = `button { all: unset; position: relative; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; transition: background-color .12s; }
  button:hover { background: var(--hover); }
  button:focus-visible { outline: 2px solid var(--pl-focus); outline-offset: 1px; }
  span { position: relative; display: block; width: 22px; height: 22px; border-radius: 7px; }
  span svg { width: 22px !important; height: 22px !important; margin: 0 !important; }`;

/** One chart frame's overlay. */
class ChartOverlay {
  readonly frame: HTMLIFrameElement;
  readonly doc: Document;
  readonly host: HTMLElement;
  readonly plot: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly panel: HTMLDivElement;
  readonly note: HTMLDivElement;
  /** The first look's bubble beside the entry: what 共享画线 is, once per account. */
  readonly guide: HTMLDivElement;
  readonly tags = new Map<string, HTMLSpanElement>();
  entry?: Entry;
  geometry?: ChartGeometry;
  scale?: ChartScale;
  laser = false;
  drawing?: Stroke & { pointer: number };
  /** Native shape id → drawing id: this document's drawings that are synced. */
  readonly links = new Map<string, string>();
  /** When real input last happened in the chart's frame. */
  lastInput = -Infinity;
  /** Whether this page already said a drawing stayed unsynced. */
  told = false;
  /** The author whose row is under the pointer: only their drawings show. */
  solo?: number;
  /** This chart's own opens on other axes' candles ("time,value" → open, 0 while asked or missing), for its current axis. */
  readonly opens = new Map<string, { value: number; at: number }>();
  /** Some drawing waits for one of those opens; when the shapes were last pushed. */
  waiting = false;
  pushed = 0;
  /** The list's order while the panel is open, so rows never move under the pointer. */
  private order: string[] = [];
  private query = '';
  /** Which drawing a row jumped to last, so the next click goes one further back. */
  private readonly jumps = new Map<string, number>();
  private noteTimer?: ReturnType<typeof setTimeout>;
  private guideTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private idleCount = 0;
  private readonly mountTimer: ReturnType<typeof setInterval>;
  private readonly abort = new AbortController();
  private readonly marks: ChartMarks;
  constructor(frame: HTMLIFrameElement, doc: Document, marks: ChartMarks) {
    this.frame = frame; this.doc = doc; this.marks = marks;
    this.host = doc.createElement('palside-page-layer');
    this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;display:block!important;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const css = doc.createElement('style'); css.textContent = style;
    this.plot = doc.createElement('div'); this.plot.className = 'plot';
    this.canvas = doc.createElement('canvas');
    this.plot.append(this.canvas);
    this.panel = doc.createElement('div'); this.panel.className = 'panel'; this.panel.setAttribute('role', 'dialog');
    this.note = doc.createElement('div'); this.note.className = 'note'; this.note.setAttribute('role', 'status');
    this.guide = doc.createElement('div'); this.guide.className = 'guide'; this.guide.setAttribute('role', 'dialog');
    shadow.append(css, this.plot, this.panel, this.note, this.guide);
    (doc.body ?? doc.documentElement).append(this.host);
    const { signal } = this.abort;
    const input = (event: Event) => { if (event.isTrusted) this.lastInput = performance.now(); };
    for (const type of ['pointerdown', 'pointerup', 'keydown']) doc.addEventListener(type, input, { capture: true, passive: true, signal });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (this.guide.hasAttribute('data-on')) { event.stopPropagation(); this.marks.closeGuide(false); }
      if (this.laser) { event.stopPropagation(); this.pickLaser(false); }
      if (this.isOpen()) { event.stopPropagation(); this.open(false); }
    };
    // A press outside the panel and the entry closes the panel; inside a closed root it reads as its host. The page around the
    // chart counts too: the entry may sit there, and a press anywhere else on it is outside.
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== this.host && !(this.entry && target && this.entry.group.contains(target))) this.open(false);
    };
    for (const scope of new Set([doc, frame.ownerDocument])) {
      scope.addEventListener('keydown', escape, { capture: true, signal });
      scope.addEventListener('pointerdown', outside, { capture: true, passive: true, signal });
    }
    this.plot.addEventListener('pointerdown', event => this.down(event), { signal });
    this.plot.addEventListener('pointermove', event => this.move(event), { signal });
    this.plot.addEventListener('pointerup', event => this.up(event), { signal });
    this.plot.addEventListener('pointercancel', event => this.up(event), { signal });
    // The site re-renders its toolbar on its own (layout changes, theme, collapse): the entry goes back in when it is dropped.
    this.mountTimer = setInterval(() => this.mount(), 1_000);
  }
  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  /** The toolbar's ink and background, so the panel reads as the site's own menu. */
  private theme() {
    const bar = this.doc.querySelector<HTMLElement>('[class*="drawingToolbar"]') ?? this.doc.body;
    const view = this.doc.defaultView, css = bar && view ? view.getComputedStyle(bar) : undefined;
    const isDark = dark(this.doc), tone = isDark ? chartToolbar.dark : chartToolbar.light;
    const bg = css && !/rgba\(0, 0, 0, 0\)|transparent/.test(css.backgroundColor) ? css.backgroundColor : tone.surface, fg = css?.color || tone.ink;
    this.host.style.setProperty('--bg', bg);
    this.host.style.setProperty('--fg', fg);
    this.host.style.setProperty('--line', tone.line);
    this.host.style.setProperty('--hover', tone.hover);
    if (css?.fontFamily) this.host.style.setProperty('--font', css.fontFamily);
    return { bg, fg, tone, isDark };
  }
  /**
   * Puts the entry first in the chart's drawing toolbar, made from the toolbar's own first button. While the site has that toolbar
   * collapsed, the entry moves into the site's toolbar row above the chart, and back when the toolbar opens again.
   */
  mount() {
    if (!this.geometry) return;
    const first = this.doc.querySelector<HTMLElement>('[data-name="linetool-group-cursors"]');
    const place: EntryPlace = first && first.getBoundingClientRect().width > 0 ? 'side' : 'top';
    if (this.entry?.group.isConnected && this.entry.place === place) return;
    const entry = place === 'side' && first ? this.sideEntry(first) : this.topEntry();
    if (this.entry) { this.open(false); this.entry.group.remove(); }
    this.entry = entry;
    if (!entry) return;
    const { button, icon } = entry, { signal } = this.abort;
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', event => {
      event.stopPropagation(); event.preventDefault();
      if (!event.isTrusted) return;
      this.marks.closeGuide(false);
      this.marks.opened();
      this.open(!this.isOpen());
    }, { signal });
    icon.style.position = 'relative';
    this.paintEntry();
  }
  private sideEntry(first: HTMLElement): Entry | undefined {
    const group = first.closest<HTMLElement>('[class*="group-"]');
    if (!group?.parentElement) return;
    const shell = group.cloneNode(false) as HTMLElement, wrap = this.el('span'), copy = first.cloneNode(true) as HTMLElement;
    shell.setAttribute('data-palside-entry', '');
    copy.removeAttribute('data-name');
    copy.querySelectorAll('[class*="arrow"], [class*="Arrow"]').forEach(node => node.remove());
    // Older chart builds (DEX Screener) leave the icon span unmarked.
    const button = copy.querySelector('button'), icon = button?.querySelector<HTMLElement>('[role="img"]') ?? button?.querySelector<HTMLElement>('span[class*="icon"]');
    if (!button || !icon) return;
    button.className = button.className.split(/\s+/).filter(name => !name.startsWith('isActive')).join(' ');
    button.removeAttribute('aria-pressed');
    const plate = (icon.parentElement ?? icon) as HTMLElement;
    wrap.append(copy); shell.append(wrap);
    group.parentElement.insertBefore(shell, group);
    // The mark covers the site's hover plate, so hovering lifts the mark itself.
    button.addEventListener('pointerenter', () => { icon.style.filter = 'brightness(1.12)'; }, { signal: this.abort.signal });
    button.addEventListener('pointerleave', () => { icon.style.filter = ''; }, { signal: this.abort.signal });
    plate.style.borderRadius = '9px';
    return { place: 'side', group: shell, button, icon, plate, badge: this.badge() };
  }
  /**
   * The site's toolbar row right above the chart (a flex row about as wide as the chart, ending just over it) and the group at its
   * start. The entry goes right after that group: such rows scroll sideways, and only their start is sure to be in view.
   */
  private topRow() {
    const outer = this.frame.ownerDocument, view = outer.defaultView, box = this.frame.getBoundingClientRect();
    if (!view || box.width < 200 || box.top < 8) return;
    for (let y = box.top - 2; y >= Math.max(0, box.top - TOP_ROW_GAP - TOP_ROW_HEIGHT); y -= 6) {
      const hit = outer.elementFromPoint(box.left + 12, y);
      for (let node = hit; node && node !== outer.body; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (rect.height > TOP_ROW_HEIGHT || rect.bottom > box.top + 2) break;
        const css = view.getComputedStyle(node);
        if (!css.display.endsWith('flex') || css.flexDirection.startsWith('column') || rect.width < box.width * .6 || rect.bottom < box.top - TOP_ROW_GAP || node.children.length < 3) continue;
        const first = [...node.children].find(child => child.contains(hit)) ?? node.firstElementChild;
        return first ? { row: node as HTMLElement, first } : undefined;
      }
    }
  }
  private topEntry(): Entry | undefined {
    const found = this.topRow();
    if (!found) return;
    const outer = found.row.ownerDocument, group = outer.createElement('span'), { tone } = this.theme();
    group.setAttribute('data-palside-entry', '');
    group.style.cssText = 'all:initial;display:inline-flex!important;flex:none;align-items:center;';
    group.style.setProperty('--hover', tone.hover);
    const shadow = group.attachShadow({ mode: 'closed' }), css = outer.createElement('style'), button = outer.createElement('button'), icon = outer.createElement('span');
    css.textContent = paletteCss + topEntryStyle; button.type = 'button';
    button.append(icon); shadow.append(css, button);
    found.first.after(group);
    return { place: 'top', group, button, icon, plate: icon, badge: this.badge() };
  }
  private badge() {
    const badge = this.el('span');
    badge.style.cssText = 'position:absolute;right:-6px;bottom:-6px;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:8px;font:600 10px/15px system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums;pointer-events:none;';
    return badge;
  }
  /** The entry's box in the chart frame's viewport, wherever the entry sits. */
  private entryBox(): Box | undefined {
    const entry = this.entry;
    if (!entry) return;
    const box = entry.button.getBoundingClientRect();
    if (entry.place === 'side') return box;
    const frame = this.frame.getBoundingClientRect(), x = frame.left + this.frame.clientLeft, y = frame.top + this.frame.clientTop;
    return { left: box.left - x, top: box.top - y, right: box.right - x, bottom: box.bottom - y, width: box.width, height: box.height };
  }
  /** Colour while 共享给小队 is on; the number is the teammates' drawings on this chart; a plate while the panel is open or 激光笔 is armed. */
  paintEntry() {
    const entry = this.entry;
    if (!entry) return;
    const { share } = this.marks.drawings, l = this.marks.labels, { bg, fg, tone, isDark } = this.theme();
    // Drawn again only when it changes, so a running moment is not cut off.
    const drawn = logo(share, bg, isDark);
    if (entry.drawn !== drawn) { entry.drawn = drawn; entry.icon.innerHTML = drawn; }
    const count = this.marks.drawings.items.filter(item => !item.mine).length;
    entry.badge.textContent = count > 99 ? '99+' : String(count);
    entry.badge.style.background = fg;
    entry.badge.style.color = tone.badgeInk;
    entry.badge.style.boxShadow = `0 0 0 2px ${bg}`;
    if (count) entry.icon.append(entry.badge); else entry.badge.remove();
    const label = l.toolbar ?? '';
    entry.button.setAttribute('aria-label', label); entry.button.setAttribute('data-tooltip', label);
    // Pressed while the panel is open or 激光笔 is armed: a thin ring in the toolbar's ink around the mark.
    entry.plate.style.boxShadow = this.isOpen() || this.laser ? `0 0 0 1.5px ${fg}` : '';
    this.syncGuide();
    this.syncIdle();
  }
  /** The idle moments run until the entry is first opened on this account, and only while it can be seen and nothing else is going on. */
  private syncIdle() {
    const view = this.doc.defaultView;
    const want = !!this.entry && !this.marks.drawings.opened && !this.isOpen() && !this.laser && !view?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!want) { clearTimeout(this.idleTimer); this.idleTimer = undefined; return; }
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.doc.visibilityState === 'visible' && this.host.style.getPropertyValue('visibility') !== 'hidden') this.idle(this.idleCount++);
      this.syncIdle();
    }, IDLE_MS + Math.random() * IDLE_SPREAD);
  }
  /** One moment, at most 1.4 seconds: a blink, a double blink, or the pen drawing a line where the eyes were. */
  private idle(count: number) {
    const svg = this.entry?.icon.querySelector('svg'), eyes = svg?.querySelector<SVGGElement>('[data-eyes]'), pen = svg?.querySelector<SVGGElement>('[data-pen]');
    if (!svg || !eyes || !pen) return;
    const centred = (element: SVGElement) => { element.style.transformBox = 'fill-box'; element.style.transformOrigin = 'center'; return element; };
    if (count % 3 !== 2) {
      const twice = count % 3 === 1;
      const frames = twice
        ? [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)', offset: .14 }, { transform: 'scaleY(1)', offset: .3 }, { transform: 'scaleY(1)', offset: .5 }, { transform: 'scaleY(.1)', offset: .64 }, { transform: 'scaleY(1)', offset: .8 }, { transform: 'scaleY(1)' }]
        : [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)', offset: .45 }, { transform: 'scaleY(1)' }];
      for (const eye of eyes.querySelectorAll('circle')) centred(eye).animate(frames, { duration: twice ? 560 : 190, easing: 'ease-in-out' });
      return;
    }
    const duration = 1_400, line = pen.querySelector('path'), [start, end] = [...pen.querySelectorAll('circle')];
    if (!line || !start || !end) return;
    eyes.animate([{ opacity: 1 }, { opacity: 0, offset: .1 }, { opacity: 0, offset: .86 }, { opacity: 1 }], { duration });
    pen.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .78 }, { opacity: 0, offset: .9 }, { opacity: 0 }], { duration });
    centred(start).animate([{ opacity: 0, transform: 'scale(.2)', easing: SPRING }, { opacity: 1, transform: 'scale(1)', offset: .14 }, { opacity: 1 }], { duration });
    line.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 100, offset: .12, easing: 'cubic-bezier(.5,0,.2,1)' }, { strokeDashoffset: 0, offset: .55 }, { strokeDashoffset: 0 }], { duration });
    centred(end).animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(.2)', offset: .52, easing: SPRING }, { opacity: 1, transform: 'scale(1)', offset: .62 }, { opacity: 1 }], { duration });
  }
  /**
   * Shown on every page with a chart, after the entry settles, until the account chooses Don't show again. 知道了, the entry or Esc
   * close it for this page.
   */
  private syncGuide() {
    const want = !!this.entry && this.marks.guideWanted() && !this.isOpen() && !this.laser, shown = this.guide.hasAttribute('data-on');
    if (!want) {
      clearTimeout(this.guideTimer); this.guideTimer = undefined;
      if (shown) this.guide.removeAttribute('data-on');
      return;
    }
    if (shown) { this.placeGuide(); return; }
    if (this.guideTimer) return;
    this.guideTimer = setTimeout(() => {
      this.guideTimer = undefined;
      if (!this.entry || !this.marks.guideWanted() || this.isOpen()) return;
      const l = this.marks.labels, off = this.el('button', 'quiet', l.guideOff ?? ''), done = this.el('button', 'done', l.gotIt ?? ''), foot = this.el('div', 'foot');
      off.type = 'button'; done.type = 'button';
      off.addEventListener('click', event => { if (event.isTrusted) this.marks.closeGuide(true); });
      done.addEventListener('click', event => { if (event.isTrusted) this.marks.closeGuide(false); });
      foot.append(off, done);
      this.guide.replaceChildren(this.el('b', '', l.toolbar ?? ''), this.el('p', '', l.guide ?? ''), foot);
      this.guide.setAttribute('aria-label', l.toolbar ?? '');
      this.placeGuide();
      this.guide.setAttribute('data-on', '');
    }, GUIDE_MS);
  }
  /** To the right of the entry (below it in the site's row), its arrow on the entry's middle, kept inside the frame. */
  private placeGuide() {
    const box = this.entryBox();
    if (!box) return;
    const below = this.entry?.place === 'top';
    this.guide.toggleAttribute('data-below', below);
    if (below) {
      const center = box.left + box.width / 2, left = Math.max(8, Math.min(center - 24, this.doc.documentElement.clientWidth - 8 - this.guide.offsetWidth));
      Object.assign(this.guide.style, { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(8, box.bottom + 12))}px` });
      this.guide.style.setProperty('--arrow-x', `${Math.round(center - left)}px`);
      return;
    }
    const height = this.doc.documentElement.clientHeight, middle = box.top + box.height / 2;
    const top = Math.max(8, Math.min(middle - 20, height - 8 - this.guide.offsetHeight));
    Object.assign(this.guide.style, { left: `${Math.round(box.right + 12)}px`, top: `${Math.round(top)}px` });
    this.guide.style.setProperty('--arrow-y', `${Math.round(middle - top)}px`);
  }
  isOpen() { return this.panel.hasAttribute('data-on'); }
  open(on: boolean) {
    if (on && !this.entry) return;
    if (on && !this.isOpen()) { this.order = []; this.query = ''; this.solo = undefined; }
    if (!on && this.solo !== undefined) { this.solo = undefined; this.marks.solo(this); }
    this.panel.toggleAttribute('data-on', on);
    this.entry?.button.setAttribute('aria-expanded', String(on));
    if (on) { this.render(); this.place(); }
    this.paintEntry();
  }
  /** Beside the entry, like the site's own tool menus (below it in the site's row), kept inside the frame. */
  private place() {
    const box = this.entryBox();
    if (!box) return;
    const height = this.doc.documentElement.clientHeight, below = this.entry?.place === 'top';
    this.panel.toggleAttribute('data-below', below); this.note.toggleAttribute('data-below', below);
    if (below) {
      const width = this.doc.documentElement.clientWidth, top = Math.max(8, box.bottom + 6);
      const align = (element: HTMLElement) => `${Math.round(Math.max(8, Math.min(box.left, width - 8 - element.offsetWidth)))}px`;
      this.panel.style.maxHeight = `${height - top - 8}px`;
      Object.assign(this.panel.style, { left: align(this.panel), top: `${Math.round(top)}px` });
      Object.assign(this.note.style, { left: align(this.note), top: `${Math.round(top)}px` });
      return;
    }
    this.panel.style.maxHeight = `${height - 16}px`;
    const top = Math.max(8, Math.min(box.top - 6, height - 8 - this.panel.offsetHeight));
    Object.assign(this.panel.style, { left: `${Math.round(box.right + 1)}px`, top: `${Math.round(top)}px` });
    Object.assign(this.note.style, { left: `${Math.round(box.right + 8)}px`, top: `${Math.round(box.top + (box.height - this.note.offsetHeight) / 2)}px` });
  }
  labels() { this.render(); }
  /** The panel: the two tools, then who drew, newest first. A hidden person stays listed, greyed, so they can be brought back. */
  render() {
    this.paintEntry();
    if (!this.isOpen()) return;
    const { people, hideAll, share } = this.marks.drawings, l = this.marks.labels;
    const sync = this.el('button', 'item');
    sync.type = 'button'; sync.setAttribute('role', 'switch'); sync.setAttribute('aria-checked', String(share));
    sync.innerHTML = svg(icons.sync); sync.title = (share ? l.syncOn : l.syncOff) ?? '';
    sync.append(this.el('b', '', l.sync ?? ''), this.el('span', 'track'));
    sync.addEventListener('click', event => { if (event.isTrusted) this.marks.pref({ share: !share }); });
    const mark = this.el('button', 'item');
    mark.type = 'button'; mark.setAttribute('aria-pressed', String(this.laser));
    mark.innerHTML = svg(icons.mark); mark.title = l.markNote ?? '';
    mark.append(this.el('b', '', l.mark ?? ''));
    mark.addEventListener('click', event => { if (event.isTrusted) { this.open(false); this.pickLaser(!this.laser); } });
    const parts: HTMLElement[] = [sync, mark];
    if (people.length) {
      for (const person of people) if (!this.order.includes(person.id)) this.order.push(person.id);
      const total = people.reduce((sum, person) => sum + person.count, 0);
      const head = this.el('div', 'head');
      head.append(this.el('span', 'muted', l.members ?? ''), this.el('span', 'num', String(total)), this.eye(!hideAll, hideAll ? l.showAll : l.hideAll, () => this.marks.pref({ hideAll: !hideAll })));
      parts.push(this.el('hr'), head);
      if (people.length >= SEARCH_FROM) {
        const find = this.el('label', 'find'), field = this.el('input');
        find.innerHTML = svg(icons.search);
        field.type = 'search'; field.placeholder = l.search ?? ''; field.value = this.query; field.setAttribute('aria-label', l.search ?? '');
        // Typing here is not for the chart's own shortcuts.
        for (const type of ['keydown', 'keyup', 'keypress']) field.addEventListener(type, event => { if ((event as KeyboardEvent).key !== 'Escape') event.stopPropagation(); });
        const clear = this.el('button', 'clear');
        clear.type = 'button'; clear.innerHTML = svg(icons.clear); clear.title = l.clear ?? ''; clear.setAttribute('aria-label', l.clear ?? '');
        const filled = () => find.toggleAttribute('data-filled', !!field.value);
        field.addEventListener('input', () => { this.query = field.value; filled(); this.fillList(list); });
        clear.addEventListener('click', event => { event.stopPropagation(); field.value = ''; this.query = ''; filled(); this.fillList(list); field.focus(); });
        filled();
        find.append(field, clear);
        parts.push(find);
      }
      const list = this.el('div', 'list');
      this.fillList(list);
      parts.push(list);
      list.addEventListener('pointerleave', () => this.soloOn(undefined));
    }
    const focused = this.panel.querySelector('input') === this.doc.activeElement || this.panel.contains(this.panel.ownerDocument.activeElement);
    this.panel.replaceChildren(...parts);
    if (focused) this.panel.querySelector('input')?.focus();
    this.panel.setAttribute('aria-label', l.toolbar ?? '');
    // As wide as its content asks, then held while open: filtering the list never makes it jump.
    this.panel.style.width = '';
    this.panel.style.width = `${this.panel.offsetWidth}px`;
    this.place();
  }
  private eye(shown: boolean, label: string | undefined, toggle: () => void) {
    const eye = this.el('button', 'eye');
    eye.type = 'button'; eye.setAttribute('aria-pressed', String(shown)); eye.title = label ?? ''; eye.setAttribute('aria-label', label ?? '');
    eye.innerHTML = svg(shown ? icons.eye : icons.eyeOff);
    eye.addEventListener('click', event => { event.stopPropagation(); if (event.isTrusted) toggle(); });
    return eye;
  }
  private fillList(list: HTMLElement) {
    const { people, items, hideAll } = this.marks.drawings, l = this.marks.labels;
    const query = this.query.trim().toLocaleLowerCase();
    const shown = people.filter(person => !query || person.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => this.order.indexOf(a.id) - this.order.indexOf(b.id));
    list.replaceChildren(...shown.map(person => {
      const row = this.el('div', 'person');
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = person.name;
      row.toggleAttribute('data-hidden', person.hidden);
      row.append(this.face(person), this.el('span', 'name', person.name), this.el('span', 'num', String(person.count)),
        this.eye(!person.hidden, `${person.hidden ? l.show ?? '' : l.hide ?? ''} ${person.name}`, () => { if (!hideAll || person.hidden) this.marks.pref(hideAll ? { hideAll: false } : { hide: { id: person.id, hidden: !person.hidden } }); }));
      row.addEventListener('pointerenter', () => this.soloOn(person.hidden ? undefined : this.marks.group(person.id)));
      const jump = () => {
        const theirs = items.filter(item => item.owner === person.id).sort((a, b) => b.at - a.at);
        if (!theirs.length) return;
        const next = ((this.jumps.get(person.id) ?? -1) + 1) % theirs.length;
        this.jumps.set(person.id, next);
        this.frame.dispatchEvent(new CustomEvent(CHART_SHOW_EVENT, { detail: JSON.stringify({ id: theirs[next]!.id }) }));
      };
      row.addEventListener('click', event => { if (event.isTrusted) jump(); });
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); jump(); } });
      return row;
    }));
    const rows = Math.min(shown.length, 8) + (shown.length > 8 ? .5 : 0);
    list.style.maxHeight = `${rows * 36}px`;
  }
  private soloOn(group: number | undefined) {
    if (this.solo === group) return;
    this.solo = group;
    this.marks.solo(this);
  }
  private face(person: PageDrawingPerson) {
    const face = this.el('span', 'face');
    if (person.avatar) face.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, '')}")`;
    else { face.style.background = avatarTints[person.tint % avatarTints.length]!; face.textContent = [...person.name][0]?.toUpperCase() ?? ''; }
    return face;
  }
  pickLaser(on: boolean) {
    this.laser = on; this.drawing = undefined;
    if (on) this.plot.dataset.tool = 'laser'; else delete this.plot.dataset.tool;
    this.paintEntry();
  }
  update(geometry: ChartGeometry) {
    this.geometry = geometry; this.scale = chartScale(geometry);
    const [left, top, width, height] = geometry.box;
    Object.assign(this.plot.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const ratio = this.doc.defaultView?.devicePixelRatio ?? 1;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
      Object.assign(this.canvas.style, { width: `${width}px`, height: `${height}px` });
    }
    this.mount();
    this.paintEntry();
    if (this.isOpen()) this.place();
  }
  /** A short word beside the entry: a drawing that failed, or one drawn while 共享给小队 is off. */
  say(text: string, tone: 'error' | 'info') {
    if (!this.entry || !text) return;
    this.marks.closeGuide(false);
    this.note.textContent = text; this.note.dataset.tone = tone;
    this.place();
    this.note.setAttribute('data-on', '');
    clearTimeout(this.noteTimer); this.noteTimer = setTimeout(() => this.note.removeAttribute('data-on'), NOTE_MS);
  }
  private point(event: PointerEvent, startedAt: number): ChartPoint | undefined {
    if (!this.scale) return;
    const box = this.plot.getBoundingClientRect(), time = this.scale.xToTime(event.clientX - box.left), value = this.scale.yToValue(event.clientY - box.top);
    return Number.isFinite(time) && Number.isFinite(value) && value > 0 ? [Math.round(time), value, Math.min(CHART_LASER_MS, Math.round(performance.now() - startedAt))] : undefined;
  }
  private down(event: PointerEvent) {
    if (!this.laser || !event.isTrusted || event.button !== 0 || this.drawing) return;
    event.preventDefault(); event.stopPropagation();
    const startedAt = performance.now(), first = this.point(event, startedAt);
    if (!first) return;
    this.plot.setPointerCapture(event.pointerId);
    this.drawing = { points: [first], startedAt, pointer: event.pointerId };
    this.marks.draw();
  }
  private move(event: PointerEvent) {
    const stroke = this.drawing;
    if (!stroke || !event.isTrusted || event.pointerId !== stroke.pointer) return;
    const next = this.point(event, stroke.startedAt);
    if (!next) return;
    if (next[2] < CHART_LASER_MS && stroke.points.length < CHART_POINTS * 8) stroke.points.push(next);
    this.marks.draw();
  }
  private up(event: PointerEvent) {
    const stroke = this.drawing;
    if (!stroke || event.pointerId !== stroke.pointer) return;
    this.drawing = undefined;
    const points = this.thin(stroke.points);
    const axis = this.geometry?.axis;
    if (points.length) this.marks.send(points, axis?.ref?.length ? { key: axis.key, at: axis.ref } : undefined);
    // One stroke per pick: 激光笔 puts itself away, so the chart is the site's own again.
    this.pickLaser(false);
    this.marks.draw();
  }
  private thin(points: ChartPoint[]) {
    const scale = this.scale;
    return scale ? thinPath(points, point => [scale.timeToX(point[0]), scale.valueToY(point[1])], CHART_POINTS) : [];
  }
  tag(id: string, name: string, tint: string, x: number, y: number, gone: boolean) {
    let tag = this.tags.get(id);
    if (!tag) {
      tag = this.doc.createElement('span'); tag.className = 'tag'; tag.textContent = name; tag.style.background = tint;
      this.plot.append(tag); this.tags.set(id, tag);
    }
    tag.style.transform = `translate(${Math.round(x + 6)}px,${Math.round(y - 22)}px)`;
    tag.toggleAttribute('data-gone', gone);
  }
  dropTags(keep: Set<string>) { for (const [id, tag] of this.tags) if (!keep.has(id)) { tag.remove(); this.tags.delete(id); } }
  dispose() { this.abort.abort(); clearTimeout(this.noteTimer); clearTimeout(this.guideTimer); clearTimeout(this.idleTimer); clearInterval(this.mountTimer); this.entry?.group.remove(); this.host.remove(); }
}

/** TradingView's frame background: dark charts get the dark toolbar. */
function dark(doc: Document) {
  const rgb = (doc.defaultView?.getComputedStyle(doc.body ?? doc.documentElement).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
  return rgb.length >= 3 && (rgb.length < 4 || rgb[3]! > 0) && rgb[0]! * .299 + rgb[1]! * .587 + rgb[2]! * .114 < 128;
}

/** `intro`: the account chose Don't show again for the guide. `opened`: it has opened the entry, which ends the idle moments. */
type DrawingList = { items: PageDrawing[]; people: PageDrawingPerson[]; share: boolean; hideAll: boolean; intro: boolean; opened: boolean };
type ChartMarks = {
  readonly labels: Record<string, string>;
  readonly drawings: DrawingList;
  send(points: ChartPoint[], axis?: ChartAxis): void;
  pref(change: Omit<Extract<PageUp, { type: 'chart-pref' }>, 'type'>): void;
  /** Whether the guide should show on this page. */
  guideWanted(): boolean;
  /** The guide closes on every chart of this page; `forever` is Don't show again, for the account. */
  closeGuide(forever: boolean): void;
  /** The entry was opened: the idle moments end for the account. */
  opened(): void;
  /** The number that tells one author's shapes from another's on the bridge, which never learns who they are. */
  group(owner: string): number;
  /** The overlay's row under the pointer changed. */
  solo(overlay: ChartOverlay): void;
  draw(): void;
};

/** How long a chart-found request waits for the bridge's first word before the page asks again. */
const BRIDGE_RETRY_MS = 6_000;

export function createChartMarks(send: (message: PageUp) => void) {
  /** When this page last asked for the bridge; a request no bridge answered may be asked again after `BRIDGE_RETRY_MS`. */
  let on = false, suspended = false, requestedAt = 0;
  /** The bridge's last word per chart frame, so an overlay can come back without waiting for the chart to move. */
  const lastDetail = new WeakMap<HTMLIFrameElement, string>();
  let labels: Record<string, string> = {};
  let marks: PageChartMark[] = [];
  // No guide until the account's settings say it was never put away.
  let list: DrawingList = { items: [], people: [], share: false, hideAll: false, intro: true, opened: true };
  /** What this page already decided, so a list that left before the change arrives cannot bring it back. */
  let guideClosed = false, introHere = false, openedHere = false;
  const groups = new Map<string, number>();
  /** When this page first drew each mark: lasers replay from it. */
  const seen = new Map<string, number>();
  /** When this page first saw each line that arrived fresh: its author's name shows for a few seconds. */
  const arrived = new Map<string, number>();
  const pending: Pending[] = [];
  const overlays = new Map<HTMLIFrameElement, ChartOverlay>();
  let frameId = 0, detectTimer: ReturnType<typeof setInterval> | undefined, counter = 0;
  const request = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

  const api: ChartMarks = {
    get labels() { return labels; },
    get drawings() { return list; },
    send(points, axis) {
      const requestId = request('mark');
      pending.push({ requestId, points, sentAt: performance.now() });
      send({ type: 'mark-send', points, ...(axis ? { axis } : {}), requestId });
    },
    pref(change) { send({ type: 'chart-pref', ...change }); },
    guideWanted() { return !list.intro && !guideClosed; },
    closeGuide(forever) {
      if (guideClosed && (!forever || list.intro)) return;
      guideClosed = true;
      if (forever && !list.intro) { introHere = true; list = { ...list, intro: true }; send({ type: 'chart-pref', intro: true }); }
      for (const overlay of overlays.values()) overlay.paintEntry();
    },
    opened() {
      if (list.opened) return;
      openedHere = true;
      list = { ...list, opened: true };
      send({ type: 'chart-pref', opened: true });
      for (const overlay of overlays.values()) overlay.paintEntry();
    },
    group(owner) { let value = groups.get(owner); if (value === undefined) groups.set(owner, value = groups.size + 1); return value; },
    solo(overlay) { pushShapes(overlay); },
    draw() { if (!frameId) frameId = requestAnimationFrame(render); },
  };

  /** Whether something drawn on `axis` sits on this chart as drawn: the same axis, or an axis either side cannot name. */
  const sameAxis = (overlay: ChartOverlay, axis?: ChartAxis) => !axis || !overlay.geometry?.axis || axis.key === overlay.geometry.axis.key;
  /**
   * What scales a value drawn on `axis` to this chart: 1 on the same axis, else this chart's open over the drawing's on the first of its
   * candles that opens here too. Undefined while none is known: the bridge is asked, and an answer pushes the shapes again.
   */
  function ratioFor(overlay: ChartOverlay, axis?: ChartAxis) {
    if (sameAxis(overlay, axis)) return 1;
    const now = performance.now();
    for (const candle of axis!.at) {
      const known = overlay.opens.get(candle.join());
      if (known?.value) return known.value / candle[1];
    }
    for (const candle of axis!.at) {
      const id = candle.join(), known = overlay.opens.get(id);
      if (known && now - known.at < OPEN_RETRY_MS) continue;
      overlay.opens.set(id, { value: 0, at: now });
      overlay.frame.dispatchEvent(new CustomEvent(CHART_VALUE_EVENT, { detail: JSON.stringify(candle) }));
    }
    overlay.waiting = true;
    return undefined;
  }
  /**
   * What the bridge should keep on this chart: everyone's visible drawings, scaled to its axis, without your own that are the site's
   * drawings here. Your own from another axis shows locked: the site keeps the editable one on the axis it was drawn on.
   */
  function pushShapes(overlay: ChartOverlay) {
    const linked = new Set(overlay.links.values()), orders: ChartShapeOrder[] = [];
    overlay.waiting = false; overlay.pushed = performance.now();
    for (const item of list.items) {
      const same = sameAxis(overlay, item.axis), ratio = ratioFor(overlay, item.axis);
      if (ratio === undefined || item.mine && same && linked.has(item.id)) continue;
      const points = same ? item.points : item.points.map(([time, value]) => [time, value * ratio] as [number, number]);
      orders.push({ id: item.id, shape: item.shape, points, ...(item.props ? { props: item.props } : {}), own: item.mine, ...(item.mine && !same ? { locked: true } : {}), group: item.mine ? 0 : api.group(item.owner) });
    }
    const key = overlay.geometry?.axis?.key;
    const detail: ChartShapes = { orders, ...(key ? { key } : {}), ...(overlay.solo !== undefined ? { solo: overlay.solo } : {}) };
    overlay.frame.dispatchEvent(new CustomEvent(CHART_SHAPES_EVENT, { detail: JSON.stringify(detail) }));
  }
  /** The bridge's answer for one candle: kept for this chart's axis, and the drawings waiting on it come back. */
  function valued(event: Event) {
    const frame = event.target;
    if (!(frame instanceof HTMLIFrameElement) || frame.ownerDocument !== document) return;
    const overlay = overlays.get(frame), answer = readChartValue((event as CustomEvent).detail);
    if (!overlay || !answer || answer.key !== overlay.geometry?.axis?.key) return;
    overlay.opens.set(answer.at.join(), { value: answer.value ?? 0, at: performance.now() });
    if (answer.value) { pushShapes(overlay); api.draw(); }
  }
  document.addEventListener(CHART_VALUE_REPLY, valued, true);
  /** What the member did with the site's tools. Only after real input, and a new drawing only with 共享给小队 on. */
  function drawn(event: Event) {
    const frame = event.target;
    if (!(frame instanceof HTMLIFrameElement) || frame.ownerDocument !== document) return;
    const overlay = overlays.get(frame), draw = readChartDraw((event as CustomEvent).detail);
    if (!overlay || !draw) return;
    if (draw.op === 'adopted') { overlay.links.set(draw.native, draw.id); return; }
    if (performance.now() - overlay.lastInput > INPUT_MS) return;
    const known = overlay.links.get(draw.native);
    if (draw.op === 'remove') {
      if (!known) return;
      overlay.links.delete(draw.native);
      send({ type: 'drawing-send', id: known, requestId: request('drawing') });
      return;
    }
    if (!known && draw.op === 'create' && !list.share && !overlay.told) { overlay.told = true; overlay.say(labels.unsynced ?? '', 'info'); }
    if (!known && (draw.op !== 'create' || !list.share)) return;
    const geometry = readChartDrawingGeometry(draw.shape, thinDrawingPoints(draw.points), draw.props, draw.axis);
    if (!geometry) return;
    const id = known ?? crypto.randomUUID();
    overlay.links.set(draw.native, id);
    send({ type: 'drawing-send', id, ...geometry, requestId: request('drawing') });
  }
  document.addEventListener(CHART_DRAW_EVENT, drawn, true);

  /**
   * A chart frame on this page: same origin, with TradingView's chart table inside. The bridge is asked for once it answers; a
   * request the background turned down (the panel not open yet, the site still being granted) is asked again a little later.
   */
  function detect() {
    if (!on || known.length || requestedAt && performance.now() - requestedAt < BRIDGE_RETRY_MS) return;
    for (const frame of document.querySelectorAll('iframe')) {
      let doc: Document | null = null;
      try { doc = frame.contentDocument; } catch { continue; }
      if (doc?.querySelector('.chart-markup-table, .chart-container')) { requestedAt = performance.now(); send({ type: 'chart-found' }); frame.dispatchEvent(new CustomEvent(CHART_ASK_EVENT)); return; }
    }
  }
  function bridge(event: Event) {
    const frame = event.target;
    if (!(frame instanceof HTMLIFrameElement) || frame.ownerDocument !== document) return;
    const detail = (event as CustomEvent).detail;
    if (typeof detail === 'string') { lastDetail.set(frame, detail); if (!known.includes(frame)) known.push(frame); }
    if (on) apply(frame, detail);
  }
  const known: HTMLIFrameElement[] = [];
  /** Overlays for every chart frame the bridge has spoken for, after a switch turned back on or another page cleared them. */
  function revive() {
    for (const frame of known.splice(0)) if (frame.isConnected) { known.push(frame); if (!overlays.has(frame)) apply(frame, lastDetail.get(frame)); }
  }
  function apply(frame: HTMLIFrameElement, detail: unknown) {
    const geometry = readChartBridge(detail);
    let overlay = overlays.get(frame);
    if (!geometry) { overlay?.dispose(); overlays.delete(frame); return; }
    if (!overlay) {
      let doc: Document | null = null;
      try { doc = frame.contentDocument; } catch { return; }
      if (!doc) return;
      overlay = new ChartOverlay(frame, doc, api);
      overlays.set(frame, overlay);
      overlay.update(geometry);
      pushShapes(overlay);
    }
    const before = overlay.geometry?.axis?.key;
    overlay.update(geometry);
    // The chart switched what it plots: opens read for the old axis mean nothing now, and every drawing is scaled again.
    if (geometry.axis?.key !== before) { overlay.opens.clear(); pushShapes(overlay); }
    // Drawings from another axis whose candles this chart had not loaded: scrolling back may have brought them.
    else if (overlay.waiting && performance.now() - overlay.pushed > OPEN_RETRY_MS) pushShapes(overlay);
    api.draw();
  }
  document.addEventListener(CHART_BRIDGE_EVENT, bridge, true);

  function render() {
    frameId = 0;
    if (suspended) return;
    const now = performance.now();
    let busy = false;
    for (const [frame, overlay] of overlays) {
      if (!frame.isConnected || overlay.doc !== frame.contentDocument) { overlay.dispose(); overlays.delete(frame); continue; }
      const scale = overlay.scale, geometry = overlay.geometry;
      if (!scale || !geometry) continue;
      const ctx = overlay.canvas.getContext('2d');
      if (!ctx) continue;
      const ratio = overlay.canvas.width / geometry.box[2];
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, geometry.box[2], geometry.box[3]);
      const at = (point: readonly [number, number, ...number[]], ratio = 1): [number, number] => [scale.timeToX(point[0]), scale.valueToY(point[1] * ratio)];
      const keep = new Set<string>();
      for (const mark of marks) {
        // Your own laser was drawn as you moved; a teammate's replays with its own timing.
        if (mark.tint === 0) continue;
        const first = seen.get(mark.id) ?? now, tint = TINTS[mark.tint % TINTS.length]!;
        const elapsed = now - first, end = (mark.points.at(-1)?.[2] ?? 0) + TAIL_MS;
        if (elapsed > end) continue;
        busy = true;
        // A stroke from another axis waits for its scale; asking keeps the frame loop running until the answer.
        const ratio = ratioFor(overlay, mark.axis);
        if (ratio === undefined) continue;
        laser(ctx, mark.points.filter(point => point[2] <= elapsed && elapsed - point[2] < TAIL_MS).map(point => at(point, ratio)), mark.points.filter(point => point[2] <= elapsed).length === mark.points.length ? (end - elapsed) / TAIL_MS : 1, tint);
        if (elapsed < TAG_MS) {
          const last = at(mark.points.at(-1)!, ratio);
          overlay.tag(mark.id, mark.author.name, tint, last[0], last[1], elapsed > TAG_MS - 400);
          keep.add(mark.id);
        }
      }
      for (const item of list.items) {
        const first = arrived.get(item.id);
        if (first === undefined || item.mine || now - first > TAG_MS) continue;
        const person = list.people.find(value => value.id === item.owner), ratio = ratioFor(overlay, item.axis);
        if (ratio === undefined) continue;
        const last = at(item.points.at(-1)!, ratio);
        if (person) { overlay.tag(item.id, person.name, TINTS[item.tint % TINTS.length]!, last[0], last[1], now - first > TAG_MS - 400); keep.add(item.id); busy = true; }
      }
      // Your strokes waiting for the squad list: they fade on their own.
      for (const item of pending) if (now - item.sentAt < TAIL_MS * 2) { busy = true; laser(ctx, item.points.slice(-12).map(point => at(point)), 1 - (now - item.sentAt) / (TAIL_MS * 2), TINTS[0]); }
      const live = overlay.drawing;
      if (live) { busy = true; laser(ctx, live.points.filter(point => now - live.startedAt - point[2] < TAIL_MS).map(point => at(point)), 1, TINTS[0]); }
      overlay.dropTags(keep);
    }
    if (busy) api.draw();
  }

  return {
    configure(next: boolean, nextLabels: Record<string, string>) {
      on = next; labels = nextLabels;
      for (const overlay of overlays.values()) overlay.labels();
      this.refresh();
    },
    /** Starts or stops looking for charts as the switch turns on or off. */
    refresh() {
      clearInterval(detectTimer); detectTimer = undefined;
      if (!on) { this.clear(); return; }
      revive(); detect(); detectTimer = setInterval(detect, 2_000);
      api.draw();
    },
    setMarks(items: PageChartMark[]) {
      const now = performance.now(), ids = new Set(items.map(item => item.id));
      for (const item of items) if (!seen.has(item.id)) {
        seen.set(item.id, now);
        if (item.tint === 0) pending.shift();
      }
      for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id);
      marks = items;
      api.draw();
    },
    setDrawings(items: PageDrawing[], people: PageDrawingPerson[], share: boolean, hideAll: boolean, intro: boolean, opened: boolean) {
      const now = performance.now(), wall = Date.now(), known = new Set(list.items.map(item => item.id));
      for (const item of items) if (!known.has(item.id) && !item.mine && wall - item.at < FRESH_MS) arrived.set(item.id, now);
      const ids = new Set(items.map(item => item.id));
      for (const id of arrived.keys()) if (!ids.has(id)) arrived.delete(id);
      // 共享给小队 off took back what you shared: your drawings here are the site's own again, and later edits stay yours.
      if (list.share && !share) for (const overlay of overlays.values()) overlay.links.clear();
      list = { items, people, share, hideAll, intro: intro || introHere, opened: opened || openedHere };
      for (const overlay of overlays.values()) { overlay.render(); pushShapes(overlay); }
      api.draw();
    },
    result(requestId: string, ok: boolean, error?: string) {
      if (ok) return;
      const index = pending.findIndex(item => item.requestId === requestId);
      if (index >= 0) pending.splice(index, 1);
      if (error) for (const overlay of overlays.values()) overlay.say(error, 'error');
      api.draw();
    },
    /**
     * From a drawing's line in the chat: brings the chart to it, a teammate's with their name beside it for a moment. A page that just
     * opened may still be loading its chart, so it keeps asking for a few seconds.
     */
    async reveal(id: string): Promise<'shown' | 'missing' | 'blocked' | 'outside'> {
      const deadline = performance.now() + REVEAL_WAIT_MS;
      for (;;) {
        if (!on) return 'blocked';
        for (const [frame, overlay] of overlays) {
          const native = [...overlay.links].find(([, value]) => value === id)?.[0];
          const answer = await askShow(frame, { id, ...(native ? { native } : {}) });
          if (answer === 'outside') return answer;
          if (!answer) continue;
          if (list.items.some(item => item.id === id && !item.mine)) { arrived.set(id, performance.now()); api.draw(); }
          return 'shown';
        }
        if (performance.now() >= deadline) return 'missing';
        await new Promise(resolve => setTimeout(resolve, REVEAL_RETRY_MS));
      }
    },
    /** A drawing that did not go out says so; it stays on your chart either way. */
    drawingResult(ok: boolean, error?: string) {
      if (ok) return;
      for (const overlay of overlays.values()) overlay.say(error || labels.failed || '', 'error');
    },
    suspend(value: boolean) {
      suspended = value;
      for (const overlay of overlays.values()) {
        overlay.host.style.setProperty('visibility', value ? 'hidden' : 'visible', 'important');
        overlay.entry?.group.style.setProperty('visibility', value ? 'hidden' : 'visible', 'important');
        if (value) { overlay.pickLaser(false); overlay.open(false); }
      }
      if (!value) api.draw();
    },
    /** Another page, or the feature off: nothing of the squad stays on the chart. The bridge, once loaded, keeps its document. */
    clear() {
      marks = []; pending.length = 0; seen.clear(); arrived.clear();
      list = { items: [], people: [], share: list.share, hideAll: list.hideAll, intro: list.intro, opened: list.opened };
      for (const overlay of overlays.values()) { pushShapes(overlay); overlay.dispose(); }
      overlays.clear();
      // The chart frame often outlives the page change (single-page sites): its overlay comes back empty.
      if (on) revive();
    },
    dispose() {
      on = false;
      this.clear();
      clearInterval(detectTimer);
      cancelAnimationFrame(frameId);
      document.removeEventListener(CHART_BRIDGE_EVENT, bridge, true);
      document.removeEventListener(CHART_DRAW_EVENT, drawn, true);
      document.removeEventListener(CHART_VALUE_REPLY, valued, true);
    },
  };
}

function laser(ctx: CanvasRenderingContext2D, points: [number, number][], fade: number, tint: string) {
  if (!points.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = tint;
  for (let index = 1; index < points.length; index += 1) {
    const k = index / points.length;
    ctx.globalAlpha = Math.max(0, fade) * .9 * k; ctx.lineWidth = 2 + 4 * k;
    ctx.beginPath(); ctx.moveTo(...points[index - 1]!); ctx.lineTo(...points[index]!); ctx.stroke();
  }
  const head = points.at(-1)!;
  ctx.globalAlpha = Math.max(0, Math.min(1, fade)); ctx.fillStyle = tint;
  ctx.beginPath(); ctx.arc(head[0], head[1], 5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha *= .35; ctx.strokeStyle = chartRim; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
}
