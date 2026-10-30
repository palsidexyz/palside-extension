// Adapted from darrenprx/lolPing (MIT), c98806ae96a4dd83ca9c12be224878057f3d3ae7. See LICENSE.
import type { PingTag, SignalPing } from './manifest';
import { TAG_COLORS } from './room-colors';

/** Safety ceiling: past this many pings on screen the oldest go early, so a ping flood can't bog the overlay down. */
export const MAX_PINGS = 60;

export interface PingFxOptions {
  sizePx: number;
  durationS: number;
  /** A room member's name under the ping. */
  tag?: PingTag;
  /** Stays after its animation, until the caller removes it. */
  keep?: boolean;
}

function img(url: string): HTMLImageElement {
  const el = document.createElement('img');
  el.src = url;
  el.alt = '';
  el.draggable = false;
  return el;
}

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

/** Adds one animated ping at (x, y) and removes it when its animation ends, unless `opts.keep`. Returns its element. */
export function spawnPing(layer: HTMLElement, def: SignalPing, x: number, y: number, opts: PingFxOptions): HTMLElement {
  const root = div(opts.keep ? 'ping kept' : 'ping');
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
  root.style.setProperty('--c', def.color);
  root.style.setProperty('--size', `${opts.sizePx}px`);
  root.style.setProperty('--dur', `${opts.durationS}s`);
  root.append(div('ring'), div('ring r2'));

  const art = div('art');
  const pop = div('pop');
  pop.append(img(def.art));
  art.append(pop);
  root.append(art);
  if (opts.tag) {
    const tag = div('tag');
    tag.textContent = opts.tag.name; // never HTML: the name comes from another machine
    tag.style.setProperty('--tag', TAG_COLORS[opts.tag.color] ?? TAG_COLORS[0]);
    root.append(tag);
  }
  while (layer.childElementCount >= MAX_PINGS) layer.firstElementChild?.remove();
  layer.append(root);
  if (!opts.keep) setTimeout(() => root.remove(), opts.durationS * 1000 + 150);
  return root;
}
