/**
 * 共享画线's chart geometry, as the chart bridge reads it from TradingView: the main pane's box inside the chart frame, the
 * bars on screen as [open time, centre x] in pane pixels, the visible value range and whether the value axis is logarithmic.
 * A bar owns the time from its open to the next bar's open and the pixels between the midpoints with its neighbours, so a time
 * lands inside its own candle at every period, and gaps (weekends, missing candles) stay where TradingView draws them. Past
 * the first or last bar it extends at the median bar width.
 *
 * `axis` names what the value axis plots (`ChartAxis.key`), with the candles (`ref`) a 激光笔 drawn now carries.
 */
export type ChartGeometry = { box: [number, number, number, number]; bars: [number, number][]; values: [number, number]; log: boolean; axis?: { key: string; ref?: [number, number][] } };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const CHART_BRIDGE_EVENT = 'palside-chart';
/** Page layer → bridge, on the chart frame's element: the shapes that should be on this chart (`ChartShapes`). */
export const CHART_SHAPES_EVENT = 'palside-chart-shapes';
/**
 * Page layer → bridge: bring this drawing into view (`{ id, native? }` as JSON: a teammate's by its id, your own by the site's shape).
 * The bridge answers `CHART_SHOWN_EVENT` with `{ id, shown }`, and `outside` when the drawing is older than every candle the chart has.
 */
export const CHART_SHOW_EVENT = 'palside-chart-show';
export const CHART_SHOWN_EVENT = 'palside-chart-shown';
export type ChartShow = { id: string; native?: string };
/** A show request or its answer, which the page can forge: an id, and a native id or a yes/no. */
export function readChartShow(detail: unknown): (ChartShow & { shown?: boolean; outside?: boolean }) | undefined {
  if (typeof detail !== 'string' || detail.length > 300) return;
  let value: unknown;
  try { value = JSON.parse(detail); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id || v.id.length > 64) return;
  return { id: v.id, ...(typeof v.native === 'string' && v.native && v.native.length <= 64 ? { native: v.native } : {}), ...(typeof v.shown === 'boolean' ? { shown: v.shown } : {}), ...(v.outside === true ? { outside: true } : {}) };
}
/** Bridge → page layer, on the chart frame's element: what the member did with the site's own tools. */
export const CHART_DRAW_EVENT = 'palside-chart-draw';
/** The page layer, on a chart frame: tell me this chart's geometry again. A layer that came back finds the bridge already loaded and quiet. */
export const CHART_ASK_EVENT = 'palside-chart-ask';
/** Page layer → bridge, on a chart frame: this chart's own open on another axis's candle (`[time, value]` as JSON). */
export const CHART_VALUE_EVENT = 'palside-chart-value';
/** Bridge → page layer, on the frame: the answer (`ChartValue`), without `value` when no candle opens at that moment. */
export const CHART_VALUE_REPLY = 'palside-chart-value-reply';
export type ChartValue = { key: string; at: [number, number]; value?: number };
/**
 * One shape the bridge keeps on the chart, drawn with its author's own properties. `own` is your own line from another tab or device:
 * an equal site-saved shape takes its place, or it comes back as an ordinary line. `locked` keeps even your own line read-only: it
 * was drawn on another axis and shows here scaled. `group` tells one author's shapes from another's.
 */
export type ChartShapeOrder = { id: string; shape: string; points: [number, number][]; props?: Record<string, unknown>; own: boolean; locked?: boolean; group: number };
/**
 * While `solo` is set, only that group's shapes show: the list row under the pointer. `key` is the axis the points were scaled for:
 * a chart that has switched since keeps its shapes until orders for its new axis arrive.
 */
export type ChartShapes = { orders: ChartShapeOrder[]; solo?: number; key?: string };
export type ChartDraw = { op: 'create' | 'change'; native: string; shape: string; points: [number, number][]; props?: Record<string, unknown>; axis?: unknown } | { op: 'remove'; native: string } | { op: 'adopted'; native: string; id: string };

/** The bridge's report, which the page can forge: bounded and well formed. What it may send on is decided by the reader. */
export function readChartDraw(detail: unknown): ChartDraw | undefined {
  if (typeof detail !== 'string' || !detail || detail.length > 200_000) return;
  let value: unknown;
  try { value = JSON.parse(detail); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.native !== 'string' || !v.native || v.native.length > 64) return;
  if (v.op === 'remove') return { op: 'remove', native: v.native };
  if (v.op === 'adopted') return typeof v.id === 'string' && v.id.length <= 64 ? { op: 'adopted', native: v.native, id: v.id } : undefined;
  if (v.op !== 'create' && v.op !== 'change') return;
  if (typeof v.shape !== 'string' || !Array.isArray(v.points) || !v.points.length || v.points.length > 5000) return;
  if (!v.points.every(point => Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]))) return;
  const props = v.props && typeof v.props === 'object' && !Array.isArray(v.props) ? v.props as Record<string, unknown> : undefined;
  // The axis is read where the drawing is (`readChartDrawingGeometry`).
  return { op: v.op, native: v.native, shape: v.shape, points: v.points as [number, number][], ...(props ? { props } : {}), ...(v.axis !== undefined ? { axis: v.axis } : {}) };
}

/** The bridge's message, which the page can forge: bounded, finite, bars in order, a usable value range. Empty means no chart. */
export function readChartBridge(detail: unknown): ChartGeometry | undefined {
  if (typeof detail !== 'string' || !detail || detail.length > 80_000) return;
  let value: unknown;
  try { value = JSON.parse(detail); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  const box = v.box as number[], bars = v.bars as [number, number][], values = v.values as number[];
  if (!Array.isArray(box) || box.length !== 4 || !box.every(finite) || box[2]! < 40 || box[3]! < 40 || box[2]! > 8000 || box[3]! > 8000) return;
  if (!Array.isArray(bars) || bars.length < 2 || bars.length > 2000) return;
  for (const [index, bar] of bars.entries()) {
    if (!Array.isArray(bar) || bar.length !== 2 || !finite(bar[0]) || !finite(bar[1])) return;
    if (index && (bar[0] <= bars[index - 1]![0] || bar[1] <= bars[index - 1]![1])) return;
  }
  if (!Array.isArray(values) || values.length !== 2 || !values.every(finite) || values[0] === values[1] || typeof v.log !== 'boolean') return;
  if (v.log && (values[0]! <= 0 || values[1]! <= 0)) return;
  return { box: box as ChartGeometry['box'], bars: bars as [number, number][], values: values as [number, number], log: v.log, ...readAxis(v.axis) };
}
/** The chart's axis from the bridge: a short printable name, and its candle when it is a real one. Anything else reads as no axis. */
function readAxis(input: unknown): Pick<ChartGeometry, 'axis'> {
  if (!input || typeof input !== 'object') return {};
  const v = input as Record<string, unknown>, ref = v.ref;
  if (typeof v.key !== 'string' || !v.key || v.key.length > 160 || /[\u0000-\u001f\u007f]/.test(v.key)) return {};
  const good = Array.isArray(ref) && ref.length > 0 && ref.length <= 6 && ref.every(item => Array.isArray(item) && item.length === 2 && finite(item[0]) && finite(item[1]) && item[1] > 0);
  return { axis: { key: v.key, ...(good ? { ref: (ref as [number, number][]).map(item => [item[0], item[1]] as [number, number]) } : {}) } };
}
/** The chart's answer to `CHART_VALUE_EVENT`, which the page can forge: it only ever scales drawings on this page's own chart. */
export function readChartValue(detail: unknown): ChartValue | undefined {
  if (typeof detail !== 'string' || detail.length > 1_000) return;
  let value: unknown;
  try { value = JSON.parse(detail); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>, at = v.at;
  if (typeof v.key !== 'string' || !v.key || v.key.length > 160 || !Array.isArray(at) || at.length !== 2 || !finite(at[0]) || !finite(at[1])) return;
  const found = finite(v.value) && v.value > 0;
  return { key: v.key, at: [at[0], at[1]], ...(found ? { value: v.value as number } : {}) };
}

export type ChartScale = { timeToX(time: number): number; xToTime(x: number): number; valueToY(value: number): number; yToValue(y: number): number };

export function chartScale(geometry: ChartGeometry): ChartScale {
  const bars = geometry.bars, height = geometry.box[3];
  const gaps = bars.slice(1).map((bar, index) => [bar[0] - bars[index]![0], bar[1] - bars[index]![1]] as const).sort((a, b) => a[0] - b[0]);
  const [seconds, pixels] = gaps[gaps.length >> 1]!;
  const rate = pixels / seconds;
  // Where each bar's time begins on screen; the last knot is where the last bar's time ends.
  const edges: [number, number][] = bars.map(([time, x], index) => [time, (x + (index ? bars[index - 1]![1] : 2 * x - bars[1]![1])) / 2]);
  edges.push([bars.at(-1)![0] + seconds, bars.at(-1)![1] + pixels / 2]);
  const n = edges.length;
  const search = (value: number, column: 0 | 1) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (edges[mid]![column] <= value) lo = mid; else hi = mid; }
    return lo;
  };
  const [low, high] = geometry.values;
  const span = geometry.log ? Math.log(high) - Math.log(low) : high - low;
  return {
    timeToX(time) {
      if (time <= edges[0]![0]) return edges[0]![1] - (edges[0]![0] - time) * rate;
      if (time >= edges[n - 1]![0]) return edges[n - 1]![1] + (time - edges[n - 1]![0]) * rate;
      const i = search(time, 0), [t0, x0] = edges[i]!, [t1, x1] = edges[i + 1]!;
      return x0 + (x1 - x0) * (time - t0) / (t1 - t0);
    },
    xToTime(x) {
      if (x <= edges[0]![1]) return edges[0]![0] - (edges[0]![1] - x) / rate;
      if (x >= edges[n - 1]![1]) return edges[n - 1]![0] + (x - edges[n - 1]![1]) / rate;
      const i = search(x, 1), [t0, x0] = edges[i]!, [t1, x1] = edges[i + 1]!;
      return t0 + (t1 - t0) * (x - x0) / (x1 - x0);
    },
    valueToY: value => geometry.log ? (Math.log(high) - Math.log(value)) / span * height : (high - value) / span * height,
    yToValue: y => geometry.log ? Math.exp(Math.log(high) - y / height * span) : high - y / height * span,
  };
}

/** A freehand path within `limit` points: drops points closer than `step` pixels, then thins evenly, keeping both ends. */
export function thinPath<T>(points: readonly T[], at: (point: T) => [number, number], limit: number, step = 2): T[] {
  const kept: T[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (!last || Math.hypot(at(point)[0] - at(last)[0], at(point)[1] - at(last)[1]) >= step) kept.push(point);
  }
  if (points.length && kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  if (kept.length <= limit) return kept;
  return Array.from({ length: limit }, (_, index) => kept[Math.round(index * (kept.length - 1) / (limit - 1))]!);
}
