'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import p from './packet.module.css';

/*
 * 红包散开 · 落袋: as the flap lifts, PALS coins fan out of the seal, float while the result sheet rises, then fly one by one
 * into my amount, which rolls as they land. They live in one manual popover so they outlive the envelope dialog, and the
 * popover is raised again above the result sheet. Coins only follow a share the service has assigned; when no amount shows
 * in time (a slow refresh, no share), they fall away instead of pretending to land.
 */
const COUNT = 12, OUT = 380, FLOAT = 1600, IN = 360, STEP = 30, LAND = .88;
type Coin = { el: HTMLElement; dx: number; dy: number; r: number; s: number; d: number; done?: boolean };
export type PacketCoins = ReturnType<typeof usePacketCoins>;

const centre = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const at = (x: number, y: number, s: number, r: number) => `translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
/** Where a coin is drawn right now, read before its running animation is replaced. */
const current = (el: HTMLElement) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f }; };

export function usePacketCoins() {
  const layer = useRef<HTMLDivElement>(null);
  const coins = useRef<Coin[]>([]);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const settle = useCallback(() => {
    if (coins.current.some(coin => !coin.done)) return;
    coins.current = [];
    if (layer.current?.matches(':popover-open')) layer.current.hidePopover();
  }, []);
  const finish = useCallback((coin: Coin) => { coin.done = true; coin.el.remove(); settle(); }, [settle]);
  /** Coins still in the air fall and fade where they are. */
  const drop = useCallback(() => {
    for (const coin of coins.current) {
      if (coin.done || coin.el.dataset.flying) continue;
      const { x, y } = current(coin.el);
      coin.el.getAnimations().forEach(animation => animation.cancel());
      coin.el.animate([{ opacity: 1, transform: at(x, y, coin.s, coin.r) }, { opacity: 0, transform: at(x + coin.dx * .1, y + 90, coin.s, coin.r * 1.4) }],
        { duration: 460, easing: 'cubic-bezier(.4, 0, .9, .5)', fill: 'both' }).finished.then(() => finish(coin), () => {});
    }
  }, [finish]);
  const burst = useCallback((from: Element) => {
    const host = layer.current;
    if (!host) return;
    if (!host.matches(':popover-open')) host.showPopover();
    const { x, y } = centre(from), width = host.clientWidth;
    coins.current = Array.from({ length: COUNT }, (_, i) => {
      const angle = -Math.PI / 2 + (i - (COUNT - 1) / 2) * (2.5 / COUNT), distance = 110 + (i % 3) * 34;
      const el = document.createElement('span');
      el.className = p.coin ?? '';
      el.innerHTML = '<img src="/brand/palside.svg" alt="" draggable="false">';
      host.append(el);
      // Every coin stays inside the panel.
      const px = Math.max(26, Math.min(width - 26, x + Math.cos(angle) * distance)), py = Math.max(70, y + Math.sin(angle) * distance);
      const coin: Coin = { el, dx: px - x, dy: py - y, r: (i % 2 ? 1 : -1) * (90 + i * 23), s: .7 + (i % 3) * .15, d: Math.hypot(px - x, py - y) };
      el.animate([
        { opacity: 0, offset: 0, transform: at(x, y, .4, 0), easing: 'cubic-bezier(.2, .8, .3, 1)' },
        { opacity: 1, offset: OUT / (OUT + FLOAT), transform: at(px, py, coin.s, coin.r), easing: 'ease-out' },
        { opacity: 1, offset: 1, transform: at(px + coin.dx * .06, py + 18, coin.s, coin.r * 1.15) },
      ], { duration: OUT + FLOAT, fill: 'both' });
      return coin;
    });
    later(drop, OUT + FLOAT - 200);
  }, [drop]);
  /** The result sheet opened over the coins: bring their layer back on top. */
  const raise = useCallback(() => {
    const host = layer.current;
    if (!host?.matches(':popover-open')) return;
    host.hidePopover(); host.showPopover();
  }, []);
  /** Fly every floating coin into `target`, nearest first; `onLand` runs as each one arrives. Resolves after the last. */
  const pocket = useCallback((target: Element, onLand: (index: number) => void) => new Promise<void>(resolve => {
    const order = coins.current.filter(coin => !coin.done && !coin.el.dataset.flying).sort((a, b) => a.d - b.d);
    if (!order.length) { resolve(); return; }
    // Claimed for the flight at once, so the fall-away timer leaves the ones still waiting their turn alone.
    order.forEach(coin => { coin.el.dataset.flying = '1'; });
    order.forEach((coin, index) => later(() => {
      if (coin.done) return;
      const from = current(coin.el), to = centre(target);
      coin.el.getAnimations().forEach(animation => animation.cancel());
      coin.el.animate([
        { opacity: 1, offset: 0, transform: at(from.x, from.y, coin.s, coin.r * 1.15) },
        { opacity: 1, offset: LAND, transform: at(to.x, to.y, .42, coin.r * 1.5) },
        { opacity: 0, offset: 1, transform: at(to.x, to.y, .2, coin.r * 1.6) },
      ], { duration: IN, easing: 'cubic-bezier(.55, 0, .75, .3)', fill: 'both' }).finished.then(() => finish(coin), () => {});
      later(() => { onLand(index); if (index === order.length - 1) resolve(); }, IN * LAND);
    }, index * STEP));
  }), [finish]);
  const pending = useCallback(() => coins.current.some(coin => !coin.done && !coin.el.dataset.flying), []);
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    coins.current.forEach(coin => coin.el.getAnimations().forEach(animation => animation.cancel()));
    coins.current = [];
  }, []);
  const node = useMemo(() => <div ref={layer} popover="manual" className={p.coins} aria-hidden="true" />, []);
  return useMemo(() => ({ node, burst, raise, pocket, pending, drop }), [node, burst, raise, pocket, pending, drop]);
}
