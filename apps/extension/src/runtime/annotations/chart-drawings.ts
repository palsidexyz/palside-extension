import { pageScopeUrl } from '../../domain/annotations/social.ts';
import { assetKey } from '../../domain/annotations/interaction.ts';

/**
 * 共享画线: whatever a member draws with the site's own TradingView tools, shared with the squad. A drawing is an encrypted event in
 * the squad's room, so it lives as long as the squad's messages and reaches members who were away. Editing sends the same id again
 * and the newest event wins; deleting leaves a record without geometry. Points are chart time and value (price or market cap, whatever
 * the page plots), so they stay on the same candles at every zoom and interval. They match by page key, never across sites.
 *
 * Any tool travels the same way: its TradingView name, its points and its own property bag (`getProperties`), which a teammate's
 * chart takes back as overrides. Trend lines, Fibonacci, text, positions, brushes, emoji, stickers and icons all come back as drawn,
 * colours included, with no list of tools to keep up to date.
 *
 * One page can plot different values: GMGN and GeckoTerminal switch the same chart between price and market cap, or between quote
 * currencies. A drawing therefore carries its axis (`ChartAxis`): what the chart plotted, and a few candles' opens on it. A chart that
 * plots something else scales the drawing by the ratio of its own open on the first of those candles it has, and leaves the drawing
 * out while it has none.
 */
export const CHART_DRAWING_EVENT = 'com.palside.chart_drawing';
/** Longer freehand strokes are thinned to this many points before they leave the page. */
export const CHART_DRAWING_POINTS = 64;
/** The newest of each squad this device keeps. */
export const CHART_DRAWING_LIMIT = 200;
export const CHART_DRAWINGS_PER_MINUTE = 60;
export const CHART_TEXT_MAX = 280;
/** A Fibonacci retracement, the largest bag seen, is about 2.4 KB. */
export const CHART_PROPS_MAX = 8_000;
/** Chart time in Unix seconds, chart value. */
export type ChartDrawingPoint = [number, number];
export type ChartProp = string | number | boolean | null | ChartProp[] | { [key: string]: ChartProp };
export type ChartProps = Record<string, ChartProp>;
/**
 * What the value axis plots, as the chart names it (symbol and description), and candles on it as [open time, open value]: the
 * roundest near the drawing, then the latest whole day, four hours, hour and quarter, so a chart at any period up to a day that has
 * loaded either the drawing's time or the last hours finds one opening at the same moment.
 */
export type ChartAxis = { key: string; at: ChartDrawingPoint[] };
export const CHART_AXIS_KEY_MAX = 160;
export const CHART_AXIS_CANDLES = 6;
export type ChartDrawingGeometry = { shape: string; points: ChartDrawingPoint[]; props?: ChartProps; axis?: ChartAxis };
/**
 * What travels: the drawing's id and page, then its geometry, or nothing at all once deleted. `asset` is the token the author's page
 * was, so a pool page reads as its token in the chat before this device has looked the pool up.
 */
export type ChartDrawingPayload = { id: string; teamId: string; url: string; sentAt: number; asset?: string } & Partial<ChartDrawingGeometry>;
/**
 * What this device keeps: the newest event of one member's drawing. Without `shape` it records a deletion. `createdAt` is the earliest
 * event of it read so far, so the chat's line for a drawing stays where it was drawn while later edits replace the record.
 */
export type ChartDrawing = ChartDrawingPayload & { eventId: string; personId: string; timestamp: number; expiresAt: number; createdAt?: number };

/** TradingView's tool names: lower case words joined by underscores. */
const SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
/** Lock and visibility are each chart's own: a teammate's line is always locked and shows unless that person is hidden. */
const LOCAL_PROPS = new Set(['frozen', 'visible']);

/** A property bag as plain data: short strings, finite numbers, small nested objects and lists. Anything else is left out, not refused. */
export function readChartProps(input: unknown): ChartProps | undefined {
  const read = (value: unknown, depth: number): ChartProp | undefined => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return value.length <= CHART_TEXT_MAX ? value : undefined;
    if (depth >= 4 || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.length <= 64 ? value.map(item => read(item, depth + 1) ?? null) : undefined;
    const out: Record<string, ChartProp> = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (!KEY.test(key) || depth === 0 && LOCAL_PROPS.has(key) || ++count > 160) continue;
      const kept = read(item, depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const props = read(input, 0) as ChartProps;
  return Object.keys(props).length && JSON.stringify(props).length <= CHART_PROPS_MAX ? props : undefined;
}

/** Chart values span from fractions of a cent to market caps in the trillions. */
const value = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0 && item < 1e16;
/** From 2000 to 2100: any chart Palside can read. */
const time = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 946_684_800 && item <= 4_102_444_800;

/** An axis as plain data: a printable name and one candle. A malformed one is left out, and the drawing then shows unscaled. */
export function readChartAxis(input: unknown): ChartAxis | undefined {
  if (!input || typeof input !== 'object') return;
  const v = input as Record<string, unknown>, at = v.at;
  if (typeof v.key !== 'string' || !v.key || v.key.length > CHART_AXIS_KEY_MAX || /[\u0000-\u001f\u007f]/.test(v.key)) return;
  if (!Array.isArray(at) || !at.length || at.length > CHART_AXIS_CANDLES || !at.every(item => Array.isArray(item) && item.length === 2 && time(item[0]) && value(item[1]))) return;
  return { key: v.key, at: at.map(item => [item[0], item[1]] as ChartDrawingPoint) };
}

/** The geometry a page may send: a tool name and its points, bounded, its property bag when it is plain data, and its axis. */
export function readChartDrawingGeometry(shape: unknown, points: unknown, props?: unknown, axis?: unknown): ChartDrawingGeometry | undefined {
  if (typeof shape !== 'string' || shape.length > 48 || !SHAPE.test(shape) || !Array.isArray(points) || !points.length || points.length > CHART_DRAWING_POINTS) return;
  if (!points.every(point => Array.isArray(point) && point.length === 2 && time(point[0]) && value(point[1]))) return;
  const bag = props === undefined ? undefined : readChartProps(props), scale = readChartAxis(axis);
  return { shape, points: points.map(point => [point[0], point[1]] as ChartDrawingPoint), ...(bag ? { props: bag } : {}), ...(scale ? { axis: scale } : {}) };
}

export function readChartDrawing(input: unknown): ChartDrawingPayload | undefined {
  if (!input || typeof input !== 'object') return;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(v.id) || typeof v.teamId !== 'string' || !v.teamId || v.teamId.length > 200) return;
  if (typeof v.url !== 'string' || v.url.length > 4096 || pageScopeUrl(v.url) !== v.url || typeof v.sentAt !== 'number' || !Number.isFinite(v.sentAt)) return;
  const asset = typeof v.asset === 'string' && v.asset.indexOf(':') > 0 ? assetKey(v.asset.slice(0, v.asset.indexOf(':')), v.asset.slice(v.asset.indexOf(':') + 1)) : undefined;
  const base = { id: v.id, teamId: v.teamId, url: v.url, sentAt: v.sentAt, ...(asset ? { asset } : {}) };
  if (v.shape === undefined && v.points === undefined && v.props === undefined) return base;
  const geometry = readChartDrawingGeometry(v.shape, v.points, v.props, v.axis);
  return geometry && { ...base, ...geometry };
}

/**
 * The list after one more event, sorted by time. One record per member and drawing, whichever order the events are read in: history
 * can arrive after live events, so a deletion read first still beats an older drawing read later. The newest of each squad stay.
 */
export function addChartDrawing(list: readonly ChartDrawing[], record: ChartDrawing, limit = CHART_DRAWING_LIMIT): ChartDrawing[] {
  const same = (item: ChartDrawing) => item.teamId === record.teamId && item.personId === record.personId && item.id === record.id;
  const known = list.find(same), created = Math.min(createdAt(record), known ? createdAt(known) : Infinity);
  if (known && (known.timestamp > record.timestamp || known.timestamp === record.timestamp && known.eventId >= record.eventId)) {
    // An older event read late (history after live) still tells when the drawing was made.
    return created < createdAt(known) ? list.map(item => item === known ? { ...known, createdAt: created } : item) : [...list];
  }
  const next = created < record.timestamp ? { ...record, createdAt: created } : record;
  const sorted = [...list.filter(item => !same(item)), next].sort((a, b) => a.timestamp - b.timestamp);
  const counts = new Map<string, number>(), kept: ChartDrawing[] = [];
  for (const item of sorted.reverse()) {
    const count = counts.get(item.teamId) ?? 0;
    if (count >= limit) continue;
    counts.set(item.teamId, count + 1); kept.push(item);
  }
  return kept.reverse();
}

/** When a drawing was first made, as far as this device has read. */
export const createdAt = (record: Pick<ChartDrawing, 'timestamp' | 'createdAt'>) => Math.min(record.createdAt ?? record.timestamp, record.timestamp);

/** An even thinning that keeps both ends. */
export function thinDrawingPoints<T>(points: readonly T[], limit = CHART_DRAWING_POINTS): T[] {
  if (points.length <= limit) return [...points];
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * (points.length - 1) / (limit - 1))]!);
}
