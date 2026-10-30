/** Sweep across the message, then the last grains finish drifting. */
const SWEEP_MS = 420;
const LIFE_MS = 460;
const DISSOLVE_MS = SWEEP_MS + LIFE_MS;
/** Room the grains drift into, up and toward the trailing side. */
const DRIFT = 44;

type Grain = { x: number; y: number; delay: number; vx: number; vy: number; size: number; color: string };
type Run = { finished: Promise<void>; cancel: () => void };

const transparent = (color: string) => color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' ')) || /\/\s*0\)$/.test(color);

/**
 * Turns a recalled message to dust: a soft edge sweeps across each of its surfaces (bubble, card, image) while grains
 * sampled from those surfaces drift off from the edge. One canvas in the chat's overlay layer draws every grain, so a
 * frame costs one 2D redraw and a mask move, never a filter repaint. `fading` (avatar, name, time) fade with the sweep.
 */
export function dissolve(stack: HTMLElement, layer: HTMLElement | null, fading: HTMLElement[], rtl: boolean): Run {
  const surfaces = [...stack.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.getBoundingClientRect().width > 0);
  const bounds = stack.getBoundingClientRect();
  const fades = fading.map(element => element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWEEP_MS, easing: 'ease-out', fill: 'forwards' }));
  if (!layer || !bounds.width || !surfaces.length) return fade(stack, fades);

  const area = layer.getBoundingClientRect();
  const left = bounds.left - area.left - DRIFT, top = bounds.top - area.top - DRIFT;
  const width = bounds.width + DRIFT * 2, height = bounds.height + DRIFT * 2;
  const ratio = Math.min(2, devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
  Object.assign(canvas.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, pointerEvents: 'none' });
  const context = canvas.getContext('2d');
  if (!context) return fade(stack, fades);
  context.scale(ratio, ratio);

  // The sweep edge crosses from -10% to 110% of the stack's width; a grain leaves when the edge reaches it.
  const reach = (x: number) => { const across = (x - bounds.left) / bounds.width; return ((rtl ? 1 - across : across) + .1) / 1.2 * SWEEP_MS; };
  const grains: Grain[] = [];
  for (const surface of surfaces) {
    const rect = surface.getBoundingClientRect(), style = getComputedStyle(surface);
    const color = transparent(style.backgroundColor) ? style.color : style.backgroundColor;
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.height / 2, rect.width / 2);
    // Larger surfaces sample more coarsely so a long message stays within a few thousand grains.
    const step = Math.max(2.5, Math.sqrt(rect.width * rect.height / 2400));
    for (let y = rect.top + step / 2; y < rect.bottom; y += step) for (let x = rect.left + step / 2; x < rect.right; x += step) {
      const cx = Math.max(rect.left + radius, Math.min(rect.right - radius, x)), cy = Math.max(rect.top + radius, Math.min(rect.bottom - radius, y));
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      grains.push({
        x: x - area.left - left, y: y - area.top - top, delay: reach(x) + Math.random() * 60,
        vx: (rtl ? -1 : 1) * (8 + Math.random() * 34), vy: -(10 + Math.random() * 34), size: step * (.55 + Math.random() * .5), color,
      });
    }
  }
  layer.append(canvas);

  const edge = rtl ? [{ maskPosition: '0% 0' }, { maskPosition: '100% 0' }] : [{ maskPosition: '100% 0' }, { maskPosition: '0% 0' }];
  const gradient = `linear-gradient(${rtl ? 270 : 90}deg, transparent 0 45%, #000 55% 100%)`;
  const previous = surfaces.map(surface => [surface.style.maskImage, surface.style.maskSize, surface.style.maskRepeat] as const);
  const sweeps = surfaces.map(surface => {
    Object.assign(surface.style, { maskImage: gradient, maskSize: '220% 100%', maskRepeat: 'no-repeat' });
    return surface.animate(edge, { duration: SWEEP_MS, easing: 'linear', fill: 'forwards' });
  });

  let frame = 0, resolve!: () => void, done = false;
  const finished = new Promise<void>(settle => { resolve = settle; });
  const started = performance.now();
  const end = () => { if (done) return; done = true; cancelAnimationFrame(frame); canvas.remove(); resolve(); };
  const draw = (time: number) => {
    const elapsed = time - started;
    context.clearRect(0, 0, width, height);
    for (const grain of grains) {
      const life = (elapsed - grain.delay) / LIFE_MS;
      if (life <= 0 || life >= 1) continue;
      const travel = 1 - (1 - life) ** 2;
      context.globalAlpha = (1 - life) ** 1.4;
      context.fillStyle = grain.color;
      const size = grain.size * (1 - life * .5);
      context.fillRect(grain.x + grain.vx * travel, grain.y + grain.vy * travel, size, size);
    }
    if (elapsed < DISSOLVE_MS + 60) frame = requestAnimationFrame(draw); else end();
  };
  frame = requestAnimationFrame(draw);
  return {
    finished,
    cancel: () => {
      for (const animation of [...sweeps, ...fades]) animation.cancel();
      surfaces.forEach((surface, index) => { const [image, size, repeat] = previous[index]!; Object.assign(surface.style, { maskImage: image, maskSize: size, maskRepeat: repeat }); });
      end();
    },
  };
}

/** Reduced motion, or nothing to sample: a short fade. */
export function fade(stack: HTMLElement, fades: Animation[] = []): Run {
  const animation = stack.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  return { finished: animation.finished.then(() => {}), cancel: () => { animation.cancel(); for (const item of fades) item.cancel(); } };
}
