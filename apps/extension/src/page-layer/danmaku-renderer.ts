import { SECOND_MS, MINUTE_MS } from '@palside/shared/units';
import { LIKE_THUMB_PATHS } from '@palside/shared/like-art';
import Danmaku from 'danmaku/dist/esm/danmaku.dom.js';
import type { PageDanmaku,PageUp,DanmakuSettings } from '../runtime/browser/page-protocol';
import { defaultDanmakuSettings,normalizeDanmakuSettings,danmakuLimits } from '../runtime/browser/page-protocol';
import { danmakuAreaRect,createMediaClock,pruneDanmaku,activeDanmaku,removeDanmaku } from './danmaku-helpers';
import type { DanmakuAreaRect,Flight } from './danmaku-helpers';
import type { OverlayHost } from './overlay-host';
import { face } from './overlay-host';

const SVG = 'http://www.w3.org/2000/svg';
export function measureDanmakuArea(area: DanmakuSettings['area'] = 50): DanmakuAreaRect {
  return danmakuAreaRect(innerWidth, innerHeight, area);
}
export function createDanmakuRenderer(context: OverlayHost, send: (message: PageUp) => void) {
  const { host, stage, motion, later } = context;
  let danmakuSettings = { ...defaultDanmakuSettings };
  const media = createMediaClock();
  const danmakuArea = document.createElement('div');
  danmakuArea.className = 'danmaku-area';
  stage.append(danmakuArea);
  const liveArea = document.createElement('div');
  liveArea.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  danmakuArea.append(liveArea);
  const danmaku = new Danmaku({ container: liveArea, media: media as unknown as HTMLMediaElement, engine: 'dom', speed: danmakuSettings.speed });
  const staticArea = document.createElement('div');
  staticArea.className = 'static-dm';
  danmakuArea.append(staticArea);
  // Who said the hovered line: one card, moved to the line it belongs to.
  const card = document.createElement('div');
  card.className = 'dm-card';
  card.hidden = true;
  danmakuArea.append(card);
  const arrivals = new Map<string, number>();
  /** Replayed lines the screen has no room for yet; they fly as lines finish. A full screen simply skips live lines. */
  let waiting: PageDanmaku[] = [];
  const renders = new Map<() => HTMLElement, string>();
  let areaFrame: number | undefined;
  function relativeTime(data: PageDanmaku) {
    if (!data.timestamp) return '';
    const minutes = Math.round((data.timestamp - Date.now()) / MINUTE_MS);
    const format = new Intl.RelativeTimeFormat(context.labels.locale, { numeric: 'auto' });
    return Math.abs(minutes) < 60 ? format.format(minutes, 'minute') : format.format(Math.round(minutes / 60), 'hour');
  }

  /** A line's 点赞: the solid thumb and the count after the words, at the words' own size, ink and stroke. */
  function likesMark(count: number) {
    const mark = document.createElement('span');
    mark.className = 'dm-likes';
    const svg = document.createElementNS(SVG, 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    for (const d of LIKE_THUMB_PATHS) { const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.append(path); }
    mark.append(svg, String(count));
    return mark;
  }

  /** Text only, as on video sites; who said it waits for hover. Teammates are tinted and your own line is framed. */
  function line(data: PageDanmaku) {
    const element = document.createElement('div');
    element.className = 'dm';
    // The engine measures this line, including padding and margins, before allocating its lane.
    element.dataset.size = danmakuSettings.size;
    element.dataset.id = data.id;
    if (data.replay) element.dataset.replay = '';
    if (data.self) element.dataset.self = '';
    else if (data.mate) element.dataset.mate = '';
    if (data.packet) {
      // A 红包: the envelope, then “Kai 的红包”; a click opens its envelope in the side panel.
      element.dataset.packet = '';
      const envelope = document.createElement('span');
      envelope.className = 'dm-envelope';
      envelope.setAttribute('aria-hidden', 'true');
      const name = data.self ? context.labels.you : data.author.name || context.labels.member || '';
      const words = document.createElement('span');
      words.textContent = (context.labels.packetFrom ?? '{name}').replace('{name}', name);
      element.append(envelope, words);
    } else {
      element.textContent = data.text;
      if (data.likes) element.append(likesMark(data.likes));
    }
    element.addEventListener('click', event => { if (event.isTrusted === false) return; send({ type: 'open-room', key: data.key, ...(data.packet ? { packet: data.id } : {}) }); });
    return element;
  }

  function showCard(element: HTMLElement, data: PageDanmaku) {
    const avatar = face(data.author);
    const name = document.createElement('b');
    name.textContent = data.self ? context.labels.you : data.author.name || context.labels.member || '';
    const parts: HTMLElement[] = [avatar, name];
    if (data.mate && !data.self && context.labels.mate) { const tag = document.createElement('span'); tag.className = 'dm-tag'; tag.textContent = context.labels.mate; parts.push(tag); }
    const when = relativeTime(data);
    if (when) { const time = document.createElement('time'); time.textContent = when; parts.push(time); }
    card.replaceChildren(...parts);
    card.toggleAttribute('data-mate', Boolean(data.mate && !data.self));
    card.removeAttribute('data-on');
    card.hidden = false;
    // Above the line, or under it when the line runs along the top edge; never past either side.
    const area = danmakuArea.getBoundingClientRect(), rect = element.getBoundingClientRect();
    const left = Math.max(6, Math.min(rect.left - area.left, area.width - card.offsetWidth - 6));
    const above = rect.top - area.top - card.offsetHeight - 6;
    card.style.transform = '';
    card.style.left = `${left}px`;
    card.style.top = `${above >= 0 ? above : rect.bottom - area.top + 6}px`;
    requestAnimationFrame(() => { if (hovered?.element === element) card.setAttribute('data-on', ''); });
  }
  function hideCard() { card.removeAttribute('data-on'); card.hidden = true; }

  // A hovered line alone stands still: its start moves with the clock, so the engine keeps drawing it in place while the rest fly on.
  let hovered: { element: HTMLElement; flight?: Flight; last: number; frame: number } | undefined;
  function hold(now: number) {
    if (!hovered) return;
    const step = (now - hovered.last) / SECOND_MS;
    hovered.last = now;
    if (!media.paused && hovered.flight) { hovered.flight.time! += step; hovered.flight._utc! += step; }
    hovered.frame = requestAnimationFrame(hold);
  }
  function release() {
    if (!hovered) return;
    cancelAnimationFrame(hovered.frame);
    hovered.element.parentElement?.removeAttribute('data-held');
    hovered = undefined;
    hideCard();
  }
  function resumeDanmaku() {
    if (danmakuSettings.enabled && !context.reducedMotion) media.play();
  }

  function danmakuComment(data: PageDanmaku, time: number) {
    return {
      mode: 'rtl' as const,
      time,
      render: () => {
        const element = line(data);
        element.addEventListener('mouseenter', event => {
          // A line catching up in the same lane passes under the held one, which stays on top and keeps the pointer.
          if (event.isTrusted === false || (hovered && hovered.element !== element && hovered.element.matches(':hover'))) return;
          release();
          const flight = activeDanmaku(danmaku).find(item => item.node?.firstElementChild === element);
          element.parentElement?.setAttribute('data-held', '');
          hovered = { element, flight, last: performance.now(), frame: requestAnimationFrame(hold) };
          showCard(element, data);
        });
        element.addEventListener('mouseleave', event => { if (event.isTrusted === false) return; if (hovered?.element === element) release(); });
        return element;
      },
    };
  }

  function removeFlights(ids: string[]) {
    const removed = new Set(ids);
    removeDanmaku(danmaku, flight => Boolean(flight.render && removed.has(renders.get(flight.render)!)));
    for (const [render, id] of renders) if (removed.has(id)) renders.delete(render);
    for (const element of staticArea.querySelectorAll<HTMLElement>('[data-id]')) if (removed.has(element.dataset.id!)) element.remove();
    waiting = waiting.filter(item => !removed.has(item.id));
    if (hovered && !hovered.element.isConnected) release();
  }
  function trimFlights() {
    const active = new Set(activeDanmaku(danmaku).map(flight => flight.render));
    for (const render of renders.keys()) if (!active.has(render)) renders.delete(render);
    const excess = [...renders.values()].slice(0, Math.max(0, renders.size - danmakuLimits[danmakuSettings.density]));
    removeFlights(excess);
    while (staticArea.childElementCount > danmakuLimits[danmakuSettings.density]) staticArea.firstElementChild?.remove();
  }

  function enqueue(items: PageDanmaku[]) {
    if (!items.length || !danmakuSettings.enabled) return;
    trimFlights();
    const now = Date.now();
    for (const [id, expiry] of arrivals) if (expiry <= now) arrivals.delete(id);
    for (const item of items) {
      if (arrivals.has(item.id)) continue;
      arrivals.set(item.id, now + MINUTE_MS);
      if (arrivals.size > 256) arrivals.delete(arrivals.keys().next().value!);
      if (!screenFull()) fly(item);
      else if (item.replay) waiting.push(item);
    }
    resumeDanmaku();
  }
  const screenFull = () => (context.reducedMotion ? staticArea.childElementCount : activeDanmaku(danmaku).length) >= danmakuLimits[danmakuSettings.density];
  function fly(item: PageDanmaku) {
    if (context.reducedMotion) {
      const element = line(item);
      element.addEventListener('mouseenter', event => { if (event.isTrusted === false) return; release(); hovered = { element, last: performance.now(), frame: 0 }; showCard(element, item); });
      element.addEventListener('mouseleave', event => { if (event.isTrusted === false) return; if (hovered?.element === element) release(); });
      staticArea.append(element);
      later(() => element.remove(), 5_000);
    } else { const comment = danmakuComment(item, media.currentTime); renders.set(comment.render, item.id); danmaku.emit(comment); }
  }

  function syncMotion() {
    const next = motion.matches;
    if (next === context.reducedMotion) return;
    context.reducedMotion = next;
    host.toggleAttribute('data-reduced', next);
    danmaku.clear();
    release();
    danmaku.comments.length = 0;
    danmaku._.position = 0;
    renders.clear();
    waiting = [];
    staticArea.replaceChildren();
    if (context.reducedMotion) media.pause();
    else resumeDanmaku();
  }
  motion.addEventListener('change', syncMotion);
  const pruneTimer = window.setInterval(() => {
    const cutoff = media.currentTime - Math.max(1, danmakuArea.clientWidth / danmakuSettings.speed) - 1;
    pruneDanmaku(danmaku, cutoff);
    trimFlights();
    for (const [id, expiry] of arrivals) if (expiry <= Date.now()) arrivals.delete(id);
    if (waiting.length && !screenFull() && danmakuSettings.enabled) { fly(waiting.shift()!); resumeDanmaku(); }
    // Nothing left to draw: the frame loops stop until the next line.
    else if (!waiting.length && !hovered && !activeDanmaku(danmaku).length) media.pause();
  }, SECOND_MS);

  function syncDanmakuArea() {
    const rect = measureDanmakuArea(danmakuSettings.area);
    danmakuArea.style.left = `${rect.left}px`;
    danmakuArea.style.top = `${rect.top}px`;
    danmakuArea.style.width = `${rect.width}px`;
    danmakuArea.style.height = `${rect.height}px`;
    // Only the lines fade; the card stays readable.
    danmakuArea.style.setProperty('--dm-opacity', `${danmakuSettings.opacity / 100}`);
    danmaku.resize();
  }

  function scheduleDanmakuArea() {
    if (areaFrame !== undefined) return;
    areaFrame = requestAnimationFrame(() => {
      areaFrame = undefined;
      syncDanmakuArea();
    });
  }

  window.addEventListener('resize', scheduleDanmakuArea, { passive: true });
  syncDanmakuArea();


  return { area: danmakuArea,
    setDanmakuSettings(value: DanmakuSettings) {
      danmakuSettings = normalizeDanmakuSettings(value);
      danmaku.speed = danmakuSettings.speed;
      trimFlights();
      if (danmakuSettings.enabled) {
        danmaku.show();
        resumeDanmaku();
      } else {
        media.pause();
        release();
        danmaku.hide();
        danmaku.comments.length = 0; danmaku._.position = 0;
        staticArea.replaceChildren();
        renders.clear();
        waiting = [];
      }
      syncDanmakuArea();
    },
    update: enqueue, remove: removeFlights,
    clear() {
      renders.clear();
      arrivals.clear();
      waiting = [];
      release();
      danmaku.comments.length = 0;
      danmaku._.position = 0;
      staticArea.replaceChildren();
      danmaku.clear();
      media.pause();
    },
    dispose() {
      window.clearInterval(pruneTimer);
      if (areaFrame !== undefined) cancelAnimationFrame(areaFrame);
      motion.removeEventListener('change', syncMotion);
      window.removeEventListener('resize', scheduleDanmakuArea);
      release(); media.pause(); danmaku.destroy();
    },
  };
}
