import type { DanmakuArea } from '../runtime/browser/page-protocol';
export type { DanmakuArea, DanmakuSpeed, DanmakuSize, DanmakuSettings } from '../runtime/browser/page-protocol';

export type DanmakuAreaRect = { top: number; left: number; width: number; height: number };
export function fallbackDanmakuArea(width: number, height: number, area: DanmakuArea = 'top'): DanmakuAreaRect {
  if (area === 'full') return { top: 0, left: 0, width, height };
  return { top: 0, left: 0, width, height: height * 0.25 };
}
export type MediaClock = EventTarget & { currentTime: number; paused: boolean; playbackRate: number; play(): void; pause(): void };
export function createMediaClock(): MediaClock {
  const clock = new EventTarget() as MediaClock;
  clock.currentTime = 0;
  clock.paused = true;
  clock.playbackRate = 1;
  let frame = 0;
  let previous = performance.now();
  const tick = (now: number) => {
    if (clock.paused) {
      frame = 0;
      return;
    }
    if (!clock.paused) clock.currentTime += Math.max(0, now - previous) / 1000 * clock.playbackRate;
    previous = now;
    frame = requestAnimationFrame(tick);
  };
  clock.play = () => {
    if (!clock.paused) return;
    clock.paused = false;
    previous = performance.now();
    clock.dispatchEvent(new Event('play'));
    if (!frame) frame = requestAnimationFrame(tick);
  };
  clock.pause = () => {
    if (clock.paused) return;
    clock.paused = true;
    if (frame) globalThis.cancelAnimationFrame?.(frame);
    frame = 0;
    clock.dispatchEvent(new Event('pause'));
  };
  return clock;
}

/** The pinned DOM engine keeps emitted comments after they leave the screen. */
export function pruneDanmaku(engine: { comments: { time?: number }[]; _: { position: number } }, cutoff: number) {
  let count = 0;
  while (count < engine._.position && (engine.comments[count]?.time ?? Infinity) < cutoff) count += 1;
  count = Math.max(count, engine.comments.length - 256);
  if (count) {
    engine.comments.splice(0, count);
    engine._.position = Math.max(0, engine._.position - count);
  }
}

/** Include pending comments, so a paused or busy renderer cannot exceed the density limit. */
/** One emitted line as the engine keeps it: `time` on the media clock and `_utc` on the frame clock, both in seconds. */
export type Flight = { render?: () => HTMLElement; node?: HTMLElement; time?: number; _utc?: number };
type FlightEngine = { comments: Flight[]; _: { position: number; runningList: Flight[] } };
export function activeDanmaku(engine: FlightEngine) { return [...engine._.runningList, ...engine.comments.slice(engine._.position)]; }
export function removeDanmaku(engine: FlightEngine, remove: (flight: Flight) => boolean) {
  for (const flight of engine._.runningList.filter(remove)) flight.node?.remove();
  engine._.runningList = engine._.runningList.filter(flight => !remove(flight));
  const before = engine.comments.slice(0, engine._.position).filter(flight => !remove(flight)).length;
  engine.comments = engine.comments.filter(flight => !remove(flight));
  engine._.position = before;
}
