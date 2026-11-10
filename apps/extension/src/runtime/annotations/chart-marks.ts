import { pageScopeUrl } from '../../domain/annotations/social.ts';
import { SIGNAL_CLOCK_SKEW } from './signals.ts';
import { readChartAxis,type ChartAxis } from './chart-drawings.ts';

/**
 * 共享画线's 激光笔: a moving pointer for "look here", sent once a stroke ends and gone seconds later. It sits on chart time and value,
 * so it replays on the same candles at any zoom. Marks match by page key, never across sites: two sites may plot different values
 * for one token. Lines that stay are drawings (`chart-drawings.ts`); a stroke carries its axis the same way, so a chart plotting
 * another value scales it.
 */
export const CHART_MARK_EVENT = 'com.palside.chart_mark';
/** A laser stroke replays its path with the time it was drawn in, then fades. */
export const CHART_LASER_MS = 6_000;
export const CHART_POINTS = 160;
/** One point: chart time in Unix seconds, chart value, and milliseconds since the stroke began. */
export type ChartPoint = [number, number, number];
export type ChartMarkPayload = { id: string; teamId: string; url: string; sentAt: number; points: ChartPoint[]; axis?: ChartAxis };
export type ReceivedChartMark = ChartMarkPayload & { personId: string; at: number };

/** Chart values span from fractions of a cent to market caps in the trillions. */
const value = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0 && item < 1e16;
/** From 2000 to 2100: any chart Palside can read. */
const time = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 946_684_800 && item <= 4_102_444_800;

/** The stroke a page may send: bounded points in time order. */
export function readChartStroke(points: unknown): ChartPoint[] | undefined {
  if (!Array.isArray(points) || !points.length || points.length > CHART_POINTS) return;
  const read: ChartPoint[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 3) return;
    const [t, v, d] = point as unknown[];
    if (!time(t) || !value(v) || typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > CHART_LASER_MS || d < (read.at(-1)?.[2] ?? 0)) return;
    read.push([t, v, d]);
  }
  return read;
}

export function readChartMark(input: unknown, now = Date.now()): ChartMarkPayload | undefined {
  if (!input || typeof input !== 'object') return;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(v.id) || typeof v.teamId !== 'string' || !v.teamId || v.teamId.length > 200 || typeof v.url !== 'string' || v.url.length > 4096 || pageScopeUrl(v.url) !== v.url || typeof v.sentAt !== 'number' || !Number.isFinite(v.sentAt) || Math.abs(now - v.sentAt) > SIGNAL_CLOCK_SKEW) return;
  const points = readChartStroke(v.points), axis = readChartAxis(v.axis);
  return points && { id: v.id, teamId: v.teamId, url: v.url, sentAt: v.sentAt, points, ...(axis ? { axis } : {}) };
}

/** A received list after one mark: a repeat changes nothing, the oldest go first. */
export function addChartMark(list: readonly ReceivedChartMark[], mark: ReceivedChartMark, limit = 64): ReceivedChartMark[] {
  if (list.some(item => item.personId === mark.personId && item.id === mark.id)) return [...list];
  return [...list, mark].slice(-limit);
}
export const chartMarkAlive = (mark: { at: number }, now = Date.now()) => mark.at + CHART_LASER_MS > now;
