// Adapted from darrenprx/lolPing (MIT), c98806ae96a4dd83ca9c12be224878057f3d3ae7. See LICENSE.
import type { PingTag } from './manifest';
const EMOTE_DURATION_S = 3;
import { TAG_COLORS } from './room-colors';

export interface EmoteOptions {
  /** How wide the emote's art appears. */
  sizePx: number;
  /** A room member's name under the emote. */
  tag?: PingTag;
  /** Called once the art has loaded, or given way to the placeholder. */
  onReady?: () => void;
}

interface Live {
  root: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  image: HTMLImageElement;
  gone: boolean;
}

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

/** What stands in for an emote whose file is missing. */
function bubble(): HTMLDivElement {
  const b = div('bubble');
  b.textContent = '?';
  return b;
}

/** The emotes on this overlay: at most one per owner ('self', 'preview' or a room member's id), each gone after EMOTE_DURATION_S. */
export class EmoteStage {
  private readonly live = new Map<string, Live>();

  constructor(private readonly layer: HTMLElement) {}

  /** Shows the still at `url` centred on (x, y) in the CSS envelope, replacing the owner's emote if it has one on screen. */
  spawn(owner: string, url: string, x: number, y: number, opts: EmoteOptions): void {
    this.clear(owner);
    const root = div('emote');
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.setProperty('--size', `${opts.sizePx}px`);
    root.style.setProperty('--dur', `${EMOTE_DURATION_S}s`);
    const fx = div('fx');
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    fx.append(img);
    root.append(fx);
    // The envelope's clock starts when the art can show; until then a slow load is given up after 10 s.
    const live: Live = { root, image: img, gone: false, timer: setTimeout(() => this.end(owner, live), 10_000) };
    this.live.set(owner, live);
    const ready = () => {
      if (live.gone) return;
      img.onload = null; img.onerror = null;
      clearTimeout(live.timer);
      live.timer = setTimeout(() => this.end(owner, live), EMOTE_DURATION_S * 1000 + 150);
      fx.style.animationName = '';
      opts.onReady?.();
    };
    fx.style.animationName = 'none';
    img.onload = ready;
    img.onerror = () => { if (!live.gone) { img.replaceWith(bubble()); ready(); } };
    img.src = url;

    if (opts.tag) {
      const tag = div('tag');
      tag.textContent = opts.tag.name; // never HTML: the name comes from another machine
      tag.style.setProperty('--tag', TAG_COLORS[opts.tag.color] ?? TAG_COLORS[0]);
      root.append(tag);
    }
    this.layer.append(root);
  }

  /** Release timers and image requests when the overlay is removed. */
  dispose(): void {
    for (const owner of this.live.keys()) this.clear(owner);
  }

  /** Removes the owner's emote at once, if it has one. */
  clear(owner: string): void {
    const live = this.live.get(owner);
    if (live) this.end(owner, live);
  }

  private end(owner: string, live: Live): void {
    if (live.gone) return;
    live.gone = true;
    clearTimeout(live.timer);
    live.root.remove();
    live.image.onload = null; live.image.onerror = null;
    live.image.removeAttribute('src');
    if (this.live.get(owner) === live) this.live.delete(owner);
  }
}
