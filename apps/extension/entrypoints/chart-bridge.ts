import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { MINUTE_MS } from '@palside/shared/units';
import { readChartBridge, readChartShow, CHART_ASK_EVENT, CHART_BRIDGE_EVENT, CHART_DRAW_EVENT, CHART_SHAPES_EVENT, CHART_SHOW_EVENT, CHART_SHOWN_EVENT, CHART_VALUE_EVENT, CHART_VALUE_REPLY, type ChartDraw, type ChartGeometry, type ChartShapeOrder, type ChartShapes } from '../src/page-layer/chart-scale';

/**
 * 共享画线's chart bridge, loaded by the background into the main world of a 网页互动 page that shows a TradingView chart
 * (`chart-found`). TradingView's API lives in the chart frame's own JavaScript, which the isolated page layer cannot see.
 *
 * The bridge reads chart geometry, reports what the member draws with the site's own tools (name, points and the tool's own property
 * bag), and keeps teammates' drawings on the chart as locked shapes made from the same bag, which the site does not save. Everything passes as strings on the chart frame's element. It gets shapes and colours, never
 * names or accounts, and holds no extension API. The page can read or forge what passes here, and can read the shapes on its own
 * chart: the page layer validates what comes back (`readChartBridge`, `readChartDraw`) and only sends after real input.
 *
 * It also names the chart's axis (what the values are: price or market cap, in which currency) and reads the chart's own candle opens,
 * so a drawing made on another axis can be scaled (`ChartAxis`). Sites switch axes two ways: GeckoTerminal builds a new chart frame,
 * GMGN changes the symbol in place and TradingView keeps each symbol's shapes apart, bringing them back on the way back. Shapes made
 * here are therefore kept per axis too.
 */
export default defineUnlistedScript(() => {
  const key = '__palsideChartBridge';
  const scope = window as Window & { [key]?: boolean };
  if (scope[key] || window.top !== window) return;
  scope[key] = true;

  type Api = { activeChart(): Chart; subscribe(event: 'drawing_event', listener: (id: string, type: string) => void): void };
  type Shape = { getPoints(): { time: number; price: number }[]; getProperties(): Record<string, unknown>; isSavingEnabled?(): boolean; setVisible?(on: boolean): void };
  type Exported = { schema: { type: string; plotTitle?: string }[]; data: ArrayLike<number>[] };
  type Subscription = { subscribe(scope: null, listener: () => void): void };
  type Chart = {
    onSymbolChanged?(): Subscription;
    onDataLoaded?(): Subscription;
    symbol?(): string;
    symbolExt?(): { description?: string } | null;
    exportData?(options: { includeTime: boolean; includeSeries: boolean; includedStudies: string[]; from: number; to: number }): Promise<Exported>;
    getTimeScale(): { width(): number; coordinateToTime(x: number): number | null; barSpacing?(): number; rightOffset?(): number };
    getPanes(): { getMainSourcePriceScale(): { getVisiblePriceRange(): { from: number; to: number } | null; getMode(): number } }[];
    getAllShapes(): { id: string; name: string }[];
    getShapeById(id: string): Shape;
    createMultipointShape(points: { time: number; price: number }[], options: Record<string, unknown>): Promise<string> | string;
    removeEntity(id: string): void;
    getVisibleRange(): { from: number; to: number };
    setVisibleRange(range: { from: number; to: number }): Promise<void> | void;
  };
  /**
   * What the page layer wants on this chart, for the axis `key`, and the locked shapes made for it. `made` is keyed by axis and order id:
   * a symbol switched away hides its shapes and brings the same ones back, so they wait under their own axis instead of being made twice.
   */
  type Made = { native: string; signature: string; group: number; shown: boolean };
  type Shapes = { wanted: Map<string, ChartShapeOrder>; key?: string; solo?: number; made: Map<string, Made>; making: Set<string>; failed: Set<string>; timers: Map<string, { op: 'create' | 'change'; timer: ReturnType<typeof setTimeout> }> };
  const shapes = new WeakMap<HTMLIFrameElement, Shapes>();
  const shapesOf = (frame: HTMLIFrameElement) => { let value = shapes.get(frame); if (!value) shapes.set(frame, value = { wanted: new Map(), made: new Map(), making: new Set(), failed: new Set(), timers: new Map() }); return value; };
  const signatureOf = (order: ChartShapeOrder) => JSON.stringify([order.shape, order.points, order.props, order.locked === true]);
  const madeKey = (key: string, id: string) => `${key}\n${id}`;
  /**
   * What the value axis plots: GMGN names it in the symbol (…/USD/MCAP), GeckoTerminal in the description (SOL/USD (Market Cap)).
   * DEX Screener's symbol is a few hundred hex digits: a long name keeps its start and a hash of the whole, so a difference anywhere
   * in it still reads as another axis.
   */
  function axisKey(chart: Chart) {
    let full: string;
    try { full = `${chart.symbol?.() ?? ''} · ${chart.symbolExt?.()?.description ?? ''}`.replace(/[\u0000-\u001f\u007f]/g, ' '); } catch { return ''; }
    return full.length <= 160 ? full : `${full.slice(0, 140)}#${hash(full)}`;
  }
  /** cyrb53: 53 bits in base 36, at most 11 characters. */
  function hash(text: string) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i += 1) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36);
  }
  const DAY = 86_400;
  /** Candle open times from the roundest down: a chart at another period has a candle opening at a whole day, four hours, an hour… */
  const ROUND = [86_400, 14_400, 3_600, 900, 300, 60];
  /**
   * Whether a chart's candles belong to its symbol. TradingView names the new symbol at once and keeps the old candles until the new
   * ones load, so from a switch until `onDataLoaded` an export would read one axis's values under another's name.
   */
  const loading = new WeakMap<Api, boolean>();
  function watch(api: Api) {
    try {
      const chart = api.activeChart();
      chart.onSymbolChanged?.().subscribe(null, () => loading.set(api, true));
      chart.onDataLoaded?.().subscribe(null, () => loading.set(api, false));
    } catch { /* an older library: candles are read as they are */ }
  }
  const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
  /** The candles the chart has loaded within a day of `time`, as [open time, open], from TradingView's own export; none mid-switch. */
  async function candles(api: Api, time: number): Promise<[number, number][]> {
    for (let waited = 0; loading.get(api) && waited < 5_000; waited += 100) await pause(100);
    const chart = api.activeChart(), key = axisKey(chart);
    if (loading.get(api) || typeof chart.exportData !== 'function') return [];
    const data = await chart.exportData({ includeTime: true, includeSeries: true, includedStudies: [], from: time - DAY, to: time + DAY });
    if (loading.get(api) || axisKey(chart) !== key) return [];
    const at = data.schema.findIndex(field => field.type === 'time'), open = data.schema.findIndex(field => field.type === 'value' && field.plotTitle === 'open');
    if (at < 0 || open < 0) return [];
    const rows: [number, number][] = [];
    for (const row of Array.from(data.data)) { const t = row[at]!, v = row[open]!; if (Number.isFinite(t) && Number.isFinite(v) && v > 0) rows.push([t, v]); }
    return rows.sort((a, b) => a[0] - b[0]);
  }
  /**
   * The candles a drawing near `time` carries (`ChartAxis`): the roundest open within a day of it, then the latest whole day, four
   * hours, hour and quarter the chart has. Another chart only takes a candle opening at the very same moment, whatever its period.
   */
  async function axisNear(api: Api, time: number) {
    const near = await candles(api, time), key = axisKey(api.activeChart());
    if (!key) return;
    const now = Date.now() / 1000;
    const rows = Math.abs(now - time) < DAY ? near : [...near, ...await candles(api, now)];
    let best: [number, number] | undefined, level = -1, gap = Infinity;
    for (const row of near) {
      const index = ROUND.findIndex(step => row[0] % step === 0), here = index < 0 ? 0 : ROUND.length - index, distance = Math.abs(row[0] - time);
      if (here > level || here === level && distance < gap) { best = row; level = here; gap = distance; }
    }
    const at = best ? [best] : [];
    for (const step of ROUND.slice(0, 4)) {
      const row = rows.findLast(item => item[0] % step === 0);
      if (row && !at.some(item => item[0] === row[0])) at.push(row);
    }
    return at.length && axisKey(api.activeChart()) === key ? { key, at } : undefined;
  }
  /** This chart's open on another axis's candle: only a candle opening at that very moment, so the scale is exact. */
  async function openAt(api: Api, time: number) {
    return (await candles(api, time)).find(row => row[0] === time)?.[1];
  }
  /** The candles a 激光笔 drawn now carries, per chart frame: found again when the axis changes, and once a minute. */
  type Ref = { key: string; ref?: [number, number][]; at: number; busy?: boolean };
  const refs = new WeakMap<HTMLIFrameElement, Ref>();
  function refOf(frame: HTMLIFrameElement, api: Api, chart: Chart, key: string) {
    const known = refs.get(frame), now = performance.now();
    if (known && known.key === key && (known.busy || now - known.at < MINUTE_MS)) return known.ref;
    const entry: Ref = { key, ref: known?.key === key ? known.ref : undefined, at: now, busy: true };
    refs.set(frame, entry);
    let last: number;
    try { last = chart.getVisibleRange().to; } catch { return entry.ref; }
    void axisNear(api, Math.min(last, Date.now() / 1000)).catch(() => undefined).then(found => {
      entry.busy = false; entry.at = performance.now();
      if (found && found.key === key && refs.get(frame) === entry) { entry.ref = found.at; quick.delete(frame); }
    });
    return entry.ref;
  }
  /** A teammate's shape: theirs as drawn, but locked here, kept out of the site's saves, its undo and its object list. */
  const LOCKED = { lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false };
  /** The bag as plain data: TradingView's own values are plain, and anything else would not survive the trip anyway. */
  const plain = (props: Record<string, unknown>) => { try { return JSON.parse(JSON.stringify(props)) as Record<string, unknown>; } catch { return undefined; } };
  /** TradingView keeps firing while a shape is dragged or still being placed: one report once it settles. */
  const SETTLE_MS = 600;
  const subscribed = new WeakSet<Api>();
  const sent = new WeakMap<HTMLIFrameElement, string>();
  /** A few cheap reads per frame; the full column scan runs only when they change. */
  const quick = new WeakMap<HTMLIFrameElement, string>();
  /** Since when a chart has given no geometry. Charts stop answering for a moment while they reload their data. */
  const missing = new WeakMap<HTMLIFrameElement, number>();
  const GONE_MS = 1_000;
  let frames: { frame: HTMLIFrameElement; api: Api }[] = [];
  let lastScan = 0;

  function scan() {
    frames = [];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const api = (frame.contentWindow as (Window & { tradingViewApi?: Api }) | null)?.tradingViewApi;
        if (api && typeof api.activeChart === 'function') {
          frames.push({ frame, api });
          if (!subscribed.has(api) && typeof api.subscribe === 'function') { subscribed.add(api); api.subscribe('drawing_event', (id, type) => drew(frame, api, id, type)); watch(api); }
        }
      } catch { /* another origin */ }
    }
  }
  /** The main pane is the frame's widest-then-tallest canvas as wide as the time scale. */
  function pane(frame: HTMLIFrameElement, width: number) {
    let best: DOMRect | undefined;
    for (const canvas of frame.contentDocument?.querySelectorAll('canvas') ?? []) {
      const box = canvas.getBoundingClientRect();
      if (Math.abs(box.width - width) < 3 && (!best || box.height > best.height)) best = box;
    }
    return best;
  }
  function measure(api: Api, frame: HTMLIFrameElement): ChartGeometry | 'same' | undefined {
    const chart = api.activeChart(), scale = chart.getTimeScale(), width = Math.floor(scale.width());
    const box = pane(frame, width), range = chart.getPanes()[0]?.getMainSourcePriceScale();
    const values = range?.getVisiblePriceRange();
    if (!box || !values || width < 40 || width > 8000) return;
    const key = axisKey(chart), ref = key ? refOf(frame, api, chart, key) : undefined;
    const probe = [width, scale.barSpacing?.(), scale.rightOffset?.(), scale.coordinateToTime(0), scale.coordinateToTime(width >> 2), scale.coordinateToTime(width >> 1), scale.coordinateToTime(width), values.from, values.to, range!.getMode(), box.left, box.top, box.width, box.height, key, ref?.flat()].join();
    if (quick.get(frame) === probe) return 'same';
    quick.set(frame, probe);
    // Columns that show one bar: [time, centre x]. The edge runs are bars cut off by the pane, so they are left out.
    const runs: [number, number][] = [];
    let last: number | null = null, start = 0;
    for (let x = 0; x <= width; x += 1) {
      const time = scale.coordinateToTime(x);
      if (time !== last) { if (last !== null) runs.push([last, (start + x - 1) / 2]); last = time; start = x; }
    }
    if (last !== null) runs.push([last, (start + width) / 2]);
    const bars = runs.length > 3 ? runs.slice(1, -1) : runs;
    return { box: [box.left, box.top, box.width, box.height], bars: bars.slice(0, 2000), values: [values.from, values.to], log: range!.getMode() === 1, ...(key ? { axis: { key, ...(ref ? { ref } : {}) } } : {}) };
  }
  const report = (frame: HTMLIFrameElement, draw: ChartDraw) => { frame.dispatchEvent(new CustomEvent(CHART_DRAW_EVENT, { detail: JSON.stringify(draw), bubbles: true, composed: true })); };
  /** A shape someone made with the site's tools. Ours are locked and unsaved, so they never report back. */
  function drew(frame: HTMLIFrameElement, api: Api, native: string, type: string) {
    const state = shapesOf(frame);
    if ([...state.made.values()].some(item => item.native === native)) return;
    const queued = state.timers.get(native);
    if (type === 'remove') {
      if (queued) { clearTimeout(queued.timer); state.timers.delete(native); if (queued.op === 'create') return; }
      report(frame, { op: 'remove', native });
      return;
    }
    if (type !== 'create' && type !== 'points_changed' && type !== 'properties_changed' && type !== 'move') return;
    if (queued) clearTimeout(queued.timer);
    const op = queued?.op === 'create' || type === 'create' ? 'create' : 'change';
    state.timers.set(native, { op, timer: setTimeout(() => {
      state.timers.delete(native);
      void (async () => {
        const chart = api.activeChart(), shape = chart.getShapeById(native);
        if (shape.isSavingEnabled?.() === false) return;
        const name = chart.getAllShapes().find(item => item.id === native)?.name, props = plain(shape.getProperties() ?? {});
        const points = shape.getPoints().map(point => [point.time, point.price] as [number, number]);
        if (!name || !points.length) return;
        const axis = await axisNear(api, points[0]![0]).catch(() => undefined);
        report(frame, { op, native, shape: name, points, ...(props ? { props } : {}), ...(axis ? { axis } : {}) });
      })().catch(() => { /* gone already */ });
    }, SETTLE_MS) });
  }
  /** Makes the chart match what the page layer wants. Sites reload their charts on their own, so this also runs on a timer. */
  function reconcile(frame: HTMLIFrameElement, api: Api) {
    const state = shapes.get(frame);
    if (!state) return;
    let chart: Chart, all: { id: string; name: string }[];
    try { chart = api.activeChart(); all = chart.getAllShapes(); } catch { return; }
    const key = axisKey(chart), prefix = madeKey(key, '');
    // Orders scaled for another axis wait for the page layer's next ones; shapes made for another axis wait for theirs to come back.
    const current = state.key === undefined || state.key === key;
    const live = new Set(all.map(item => item.id));
    for (const [slot, item] of state.made) {
      if (!slot.startsWith(prefix)) continue;
      const order = current ? state.wanted.get(slot.slice(prefix.length)) : undefined;
      if (!live.has(item.native)) { state.made.delete(slot); continue; }
      if (!current) continue;
      if (order && signatureOf(order) === item.signature) { item.group = order.group; show(chart, state, item); continue; }
      state.made.delete(slot);
      try { chart.removeEntity(item.native); } catch { /* gone already */ }
    }
    if (!current) return;
    const taken = new Set([...state.made.values()].map(item => item.native));
    for (const order of state.wanted.values()) {
      const signature = signatureOf(order), slot = madeKey(key, order.id);
      if (state.made.has(slot) || state.making.has(slot) || state.failed.has(signature)) continue;
      if (order.own && !order.locked) {
        const twin = all.find(item => item.name === order.shape && !taken.has(item.id) && sameShape(chart, item.id, order));
        if (twin) { taken.add(twin.id); state.wanted.delete(order.id); report(frame, { op: 'adopted', native: twin.id, id: order.id }); continue; }
      }
      state.making.add(slot);
      // Your own drawing, with no copy on this chart yet, is an ordinary one you can select and delete, unless it was drawn on another
      // axis. Teammates' are always locked.
      const ordinary = order.own && !order.locked;
      const text = typeof order.props?.text === 'string' ? { text: order.props.text } : {};
      const options = { shape: order.shape, ...(ordinary ? {} : LOCKED), ...text, ...(order.props ? { overrides: order.props } : {}) };
      void Promise.resolve().then(() => chart.createMultipointShape(order.points.map(([time, price]) => ({ time, price })), options)).then(native => {
        state.making.delete(slot);
        if (!native) { state.failed.add(signature); return; }
        const now = state.wanted.get(order.id);
        if (!now || signatureOf(now) !== signature || axisKey(chart) !== key) chart.removeEntity(native);
        else if (ordinary) { state.wanted.delete(order.id); report(frame, { op: 'adopted', native, id: order.id }); }
        else { const item = { native, signature, group: order.group, shown: true }; state.made.set(slot, item); show(chart, state, item); }
      }, () => { state.making.delete(slot); state.failed.add(signature); });
    }
  }
  /** A teammate's shape shows unless another author's row is under the pointer. */
  function show(chart: Chart, state: Shapes, item: Made) {
    const on = state.solo === undefined || state.solo === item.group;
    if (item.shown === on) return;
    item.shown = on;
    try { chart.getShapeById(item.native).setVisible?.(on); } catch { /* gone already */ }
  }
  /** Whether the chart has a candle at or before the drawing's last point. Without `exportData` it is taken to have one. */
  async function before(chart: Chart, native: string) {
    if (!chart.exportData) return true;
    const last = Math.max(...chart.getShapeById(native).getPoints().map(point => point.time));
    const data = await chart.exportData({ includeTime: true, includeSeries: true, includedStudies: [], from: 0, to: last });
    return data.data.length > 0;
  }
  /** Scrolls the chart so a drawing sits in the middle, keeping the zoom unless the drawing is wider than the screen. */
  function reveal(chart: Chart, native: string) {
    const times = chart.getShapeById(native).getPoints().map(point => point.time);
    const range = chart.getVisibleRange(), low = Math.min(...times), high = Math.max(...times);
    const span = Math.max(range.to - range.from, (high - low) * 1.4), middle = (low + high) / 2;
    void chart.setVisibleRange({ from: Math.round(middle - span / 2), to: Math.round(middle + span / 2) });
  }
  /** A shape the site saved for this member, equal to their record: the same points to a millionth. */
  function sameShape(chart: Chart, native: string, order: ChartShapeOrder) {
    try {
      const shape = chart.getShapeById(native);
      if (shape.isSavingEnabled?.() === false) return false;
      const points = shape.getPoints();
      return points.length === order.points.length && points.every((point, index) => {
        const [time, price] = order.points[index]!;
        return point.time === time && Math.abs(point.price - price) <= Math.abs(price) * 1e-6;
      });
    } catch { return false; }
  }
  document.addEventListener(CHART_SHAPES_EVENT, event => {
    const frame = event.target, detail = (event as CustomEvent).detail;
    if (!(frame instanceof HTMLIFrameElement) || typeof detail !== 'string') return;
    let value: ChartShapes;
    try { value = JSON.parse(detail) as ChartShapes; } catch { return; }
    if (!value || !Array.isArray(value.orders)) return;
    const state = shapesOf(frame);
    state.wanted = new Map(value.orders.map(order => [order.id, order]));
    state.key = typeof value.key === 'string' ? value.key : undefined;
    state.solo = typeof value.solo === 'number' ? value.solo : undefined;
    const entry = frames.find(item => item.frame === frame);
    if (entry) reconcile(frame, entry.api);
  }, true);

  document.addEventListener(CHART_SHOW_EVENT, event => {
    const frame = event.target, show = readChartShow((event as CustomEvent).detail);
    if (!(frame instanceof HTMLIFrameElement) || !show) return;
    const entry = frames.find(item => item.frame === frame);
    const answer = (shown: boolean, outside = false) => frame.dispatchEvent(new CustomEvent(CHART_SHOWN_EVENT, { detail: JSON.stringify({ id: show.id, shown, ...(outside ? { outside } : {}) }), bubbles: true, composed: true }));
    // A teammate's shape made here for this axis, or your own, which is the site's shape.
    let chart: Chart, native: string | undefined;
    try {
      chart = entry!.api.activeChart();
      const made = shapes.get(frame)?.made.get(madeKey(axisKey(chart), show.id))?.native;
      native = made ?? (show.native && chart.getAllShapes().some(item => item.id === show.native) ? show.native : undefined);
    } catch { answer(false); return; }
    if (!native) { answer(false); return; }
    // A chart only scrolls over candles it has: a drawing older than all of them cannot be brought into view at this period.
    void before(chart, native).then(found => { if (found) reveal(chart, native!); answer(found, !found); }, () => { reveal(chart, native!); answer(true); });
  }, true);

  document.addEventListener(CHART_VALUE_EVENT, event => {
    const frame = event.target, detail = (event as CustomEvent).detail;
    if (!(frame instanceof HTMLIFrameElement) || typeof detail !== 'string') return;
    let at: unknown;
    try { at = JSON.parse(detail); } catch { return; }
    // One candle per ask.
    const entry = frames.find(item => item.frame === frame);
    if (!entry || !Array.isArray(at) || at.length !== 2 || !at.every(item => typeof item === 'number' && Number.isFinite(item))) return;
    let chart: Chart;
    try { chart = entry.api.activeChart(); } catch { return; }
    const [time, value] = at as [number, number];
    void openAt(entry.api, time).catch(() => undefined).then(open => {
      // Named for the axis the candles were read on, so an answer that crossed a switch is not taken for the new one.
      const key = axisKey(chart);
      frame.dispatchEvent(new CustomEvent(CHART_VALUE_REPLY, { detail: JSON.stringify({ key, at: [time, value], ...(open ? { value: open } : {}) }), bubbles: true, composed: true }));
    });
  }, true);

  document.addEventListener(CHART_ASK_EVENT, event => {
    if (event.target instanceof HTMLIFrameElement) { sent.delete(event.target); quick.delete(event.target); }
  }, true);

  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    if (!frames.length || now - lastScan > 2_000) { if (now - lastScan > 1_000) { lastScan = now; scan(); for (const item of frames) reconcile(item.frame, item.api); } }
    for (const { frame, api } of frames) {
      let geometry: ChartGeometry | 'same' | undefined;
      try { geometry = measure(api, frame); } catch { geometry = undefined; }
      if (geometry === 'same') { missing.delete(frame); continue; }
      const detail = geometry && readChartBridge(JSON.stringify(geometry)) ? JSON.stringify(geometry) : '';
      if (detail) missing.delete(frame);
      else {
        // A failed read says nothing about the next one, however alike the chart looks: measure again, and let a brief gap pass unsaid.
        quick.delete(frame);
        const since = missing.get(frame) ?? now;
        missing.set(frame, since);
        if (now - since < GONE_MS) continue;
      }
      if (sent.get(frame) === detail) continue;
      sent.set(frame, detail);
      frame.dispatchEvent(new CustomEvent(CHART_BRIDGE_EVENT, { detail, bubbles: true, composed: true }));
    }
  }
  requestAnimationFrame(frame);
});
