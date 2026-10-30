import type { PagePerson,PageUp } from '../runtime/browser/page-protocol';
import { defaultSignalSettings,isEmote,normalizeSignalSettings,SIGNAL_TTL,type ReceivedSignal,type SignalKind,type SignalSettings,type SignalTarget } from '../runtime/annotations/signals';
import { Wheel,EmoteStage,spawnPing,signalArtCss,createSignalManifest,WHEEL } from '@palside/shared/signal-art';
import { captureSignalTarget,resolveSignalTarget,resolveSignalElement } from './signal-targets';
import { readable } from './targets';
import { isTradeElement,privateSelector } from './adapters';
import { normalizeQuoteWhitespace } from './text';
import { paletteCss } from './palette';

const sizes = { sm: 0.8, md: 1, lg: 1.2 };
type Gesture = { pointer: number; control: boolean; x: number; y: number; dx: number; dy: number; active: boolean; target: SignalTarget; url: string };
type Effect = { root: HTMLElement; abort: AbortController; timer: ReturnType<typeof setTimeout>; range?: Range; element?: Element; local?: { x: number; y: number }; target: SignalTarget; badge: HTMLButtonElement; emote: boolean; edge?: boolean; owner: string; url: string };

export function createSignals(send: (message: PageUp) => void, base: string) {
  const manifest = createSignalManifest(base);
  const host = document.createElement('palside-page-layer');
  host.setAttribute('data-signals', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = paletteCss + signalArtCss + `
    :host { color-scheme: dark; --ui-text-secondary:var(--ui-dark-text-secondary); }
    button, .notice { font: 12px/18px system-ui,sans-serif; color: var(--pl-signal-ink); background: var(--pl-signal-surface); border:0; border-radius:var(--ui-radius-s);corner-shape:var(--ui-corner-shape); padding: 3px 8px; }
    .anchor-label { position: absolute; left: 0; top: 64px; transform: translateX(-50%); white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .anchor-label.locate { pointer-events: auto; cursor: pointer; }
    button:focus-visible { outline:var(--ui-focus-width) solid var(--ui-text-secondary);outline-offset:var(--ui-focus-offset); }
    .notice { position: fixed; right: 16px; top: 16px; width: 24px; height: 24px; padding: 0; text-align: center; line-height: 24px; pointer-events: auto; }
    .static-art { position: absolute; width: var(--size); height: var(--size); left: calc(var(--size) * -.5); top: calc(var(--size) * -.5); object-fit: contain; }
    .page-signal .art { width: 32px; height: 32px; left: -16px; top: -16px; }
    .page-signal .ring { display: none; }
    .page-signal .anchor-label { top: 20px; }
    .page-signal .tag { top: 46px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } .ping .ring { display:none; } .ping .art, .ping .pop, .ping .tag, .ping .art img { opacity: 1 !important; transform: none !important; translate: none !important; } }
  `;
  const layer = document.createElement('div'); layer.id = 'pings';
  const emotes = document.createElement('div'); emotes.id = 'emotes';
  const notice = document.createElement('div'); notice.className = 'notice'; notice.hidden = true; notice.setAttribute('role', 'status');
  const makeWheel = (id: string) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = id; svg.setAttribute('viewBox', '-300 -300 600 600'); svg.setAttribute('aria-hidden', 'true');
    return svg;
  };
  const wheelSvg = makeWheel('wheel');
  shadow.append(style, layer, emotes, wheelSvg, notice);
  document.documentElement.append(host);
  function syncHostZoom() {
    // CSS zoom on the root scales fixed descendants too. Pointer coordinates and
    // innerWidth already use browser CSS pixels; never compensate devicePixelRatio.
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
    host.style.setProperty('zoom', String(Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1), 'important');
  }
  syncHostZoom();
  const listeners = new AbortController();
  const stage = new EmoteStage(emotes);
  let settings: SignalSettings = { ...defaultSignalSettings };
  let labels: Record<string, string> = {};
  let enabled = false, suspended = false, disposed = false;
  let gesture: Gesture | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;
  let audio: HTMLAudioElement | undefined;
  let lastSound = -Infinity;
  const effects: Effect[] = [];
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const seen = new Map<string, number>();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const text = (key: string) => labels[key] ?? '';
  const available = () => enabled && !suspended && !disposed && document.visibilityState === 'visible' && document.hasFocus();
  const stopAudio = () => { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = undefined; } };
  function sound(url: string, vary = true) {
    if (!settings.sound || settings.volume === 0 || performance.now() - lastSound < 100) return;
    lastSound = performance.now(); stopAudio();
    try {
      audio = new Audio(url); audio.volume = settings.volume / 100;
      // A ±3% pitch offset keeps repeats from sounding stamped.
      if (vary) { audio.preservesPitch = false; audio.playbackRate = 1 + (Math.random() * 2 - 1) * 0.03; }
      void audio.play().catch(() => {});
    } catch { /* Playback can be denied by the host. */ }
  }
  function centerText(key: string) {
    const label = wheelSvg.querySelector('.centerTxt');
    if (label) label.textContent = text(key);
    const back = wheelSvg.querySelector('.backTxt');
    if (back) back.textContent = text('cancel');
  }
  /** One wheel: each slot holds the signal or emote the user put there. */
  const wheel = new Wheel(wheelSvg, '', index => {
    const entry = settings.wheel[index];
    if (entry) centerText(isEmote(entry) ? labels[`emote_${entry}`] ? `emote_${entry}` : 'emote' : entry);
    sound(manifest.tickSound, false);
  });
  const icon = (entry: string) => (isEmote(entry) ? manifest.emotes : manifest.pings).find(item => item.id === entry)?.icon ?? '';
  const fill = () => wheel.setItems(settings.wheel.map(entry => ({ key: entry, icon: icon(entry) })));
  fill();
  function cancel() { gesture = undefined; wheel.cancel(); }
  function toast(key: string) {
    clearTimeout(noticeTimer); notice.textContent = '!'; notice.title = text(key); notice.setAttribute('aria-label', text(key)); notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 2200);
  }
  function remove(effect: Effect) {
    if (!effects.includes(effect)) return;
    effect.abort.abort(); clearTimeout(effect.timer);
    if (effect.emote) stage.clear(effect.owner);
    effect.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    effect.root.remove(); effects.splice(effects.indexOf(effect), 1);
    if (effect.edge) stackEdge();
  }
  function validRange(effect: Effect): Range | undefined {
    const range = effect.range;
    if (!range || effect.target.kind !== 'quote') return;
    if (!range.startContainer.isConnected || !range.endContainer.isConnected ||
      !readable(range.startContainer.parentElement) || !readable(range.endContainer.parentElement) ||
      normalizeQuoteWhitespace(range.toString()) !== normalizeQuoteWhitespace(effect.target.exact)) {
      effect.range = undefined; return;
    }
    return range;
  }
  function position(effect: Effect) {
    if (effect.url !== location.href) { remove(effect); return; }
    if (effect.local) {
      effect.root.style.left = `${effect.local.x}px`; effect.root.style.top = `${effect.local.y}px`;
      return;
    }
    if (effect.emote) {
      const size = 110 * sizes[settings.emoteSize];
      effect.root.style.left = `${Math.max(size / 2, innerWidth - size / 2 - 24)}px`;
      effect.edge = true; stackEdge();
      return;
    }
    if (effect.element && !effect.element.isConnected) effect.element = undefined;
    const range = validRange(effect);
    const rect = effect.element?.getBoundingClientRect() ?? range?.getBoundingClientRect();
    const located = rect && rect.width > 0 && rect.height > 0;
    const relative = effect.target.kind === 'element' ? effect.target : { x: 0.5, y: 0.5 };
    const px = located ? rect.left + rect.width * relative.x : 0;
    const py = located ? rect.top + rect.height * relative.y : 0;
    const offscreen = located && (px < 0 || py < 0 || px > innerWidth || py > innerHeight);
    effect.root.classList.toggle('page-signal', !located);
    effect.root.style.left = `${located ? Math.max(32, Math.min(innerWidth - 32, px)) : innerWidth - 32}px`;
    if (located) effect.root.style.top = `${Math.max(32, Math.min(innerHeight - 64, py))}px`;
    const wasEdge = effect.edge; effect.edge = !located;
    if (!located || wasEdge) stackEdge();
    effect.badge.textContent = offscreen ? '↗' : '';
    effect.badge.title = text('locate'); effect.badge.setAttribute('aria-label', text('locate'));
    effect.badge.hidden = !offscreen;
    effect.badge.disabled = !offscreen;
    effect.badge.classList.toggle('locate', Boolean(offscreen));
  }
  /** Signals with no place on the page stack down the right edge in arrival order, each below the one before. */
  function stackEdge() {
    let offset = 0;
    for (const effect of effects) {
      if (!effect.edge || effect.local) continue;
      if (effect.emote) {
        const size = 110 * sizes[settings.emoteSize];
        effect.root.style.top = `${Math.min(innerHeight - size / 2 - 24, 90 + offset)}px`;
        offset += size + 38;
      } else {
        effect.root.style.top = `${48 + offset}px`;
        offset += 76 * sizes[settings.size];
      }
    }
  }
  function play(kind: SignalKind, target: SignalTarget, emote: string | undefined, author: PagePerson, duration = 3000, local?: { x: number; y: number }) {
    if (!available()) return;
    syncHostZoom();
    const emoteDef = emote ? manifest.emotes.find(item => item.id === emote) : undefined;
    if (emote && !emoteDef) return;
    const ping = manifest.pings.find(item => item.id === kind);
    if (!ping) return;
    while (effects.length >= 3) remove(effects[0]!);
    const owner = crypto.randomUUID();
    let root: HTMLElement;
    if (emoteDef) {
      const size = 110 * sizes[settings.emoteSize];
      // A received emote starts at the top of the edge; position() moves it into the stack.
      const x = local?.x ?? Math.max(size / 2, innerWidth - size / 2 - 24), y = local?.y ?? 90;
      if (!motion.matches) {
        stage.spawn(owner, emoteDef.image, x, y, { sizePx: size, tag: { name: author.name, color: 0 }, onReady: () => {
          // Local playback gets its full visible lifetime; received signals retain their TTL cap.
          if (local && !effect.abort.signal.aborted) {
            clearTimeout(effect.timer); effect.timer = setTimeout(() => remove(effect), duration);
          }
        } });
        root = emotes.lastElementChild as HTMLElement;
      } else {
        root = document.createElement('div'); root.className = 'emote';
        root.style.left = `${x}px`; root.style.top = `${y}px`; root.style.setProperty('--size', `${size}px`);
        const img = document.createElement('img'); img.className = 'static-art'; img.src = emoteDef.image; img.alt = text('emote');
        const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = author.name;
        root.append(img, tag); emotes.append(root);
      }
      sound(emoteDef.sound);
    } else {
      root = spawnPing(layer, ping, local?.x ?? innerWidth - 32, local?.y ?? 48, { sizePx: 110 * sizes[settings.size], durationS: duration / 1000, keep: true, tag: { name: author.name, color: 0 } });
      sound(ping.sound);
    }
    const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'anchor-label'; badge.hidden = true; root.append(badge);
    const abort = new AbortController();
    const effect: Effect = { root, abort, timer: setTimeout(() => remove(effect), local && emoteDef && !motion.matches ? 10_000 : duration), local, target, badge, emote: Boolean(emoteDef), owner, url: location.href };
    effects.push(effect); position(effect);
    badge.addEventListener('click', event => {
      if (event.isTrusted === false) return;
      event.preventDefault(); event.stopPropagation();
      position(effect);
      const anchor = effect.element ?? validRange(effect)?.startContainer.parentElement;
      anchor?.scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' });
    }, { signal: abort.signal });
    if (!local && !emoteDef && target.kind !== 'page') {
      let resolution: AbortController | undefined;
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const resolve = () => {
        resolution?.abort();
        const scan = new AbortController(); resolution = scan;
        const resolved = target.kind === 'element' ? resolveSignalElement(target, { signal: scan.signal }) : resolveSignalTarget(target, { signal: scan.signal });
        void resolved.then(anchor => {
          if (scan.signal.aborted || abort.signal.aborted || !available()) return;
          if (target.kind === 'element') effect.element = anchor as Element | undefined;
          else effect.range = anchor as Range | undefined;
          position(effect);
        }).catch(() => { /* Keep the compact edge projection when no anchor is available. */ });
      };
      abort.signal.addEventListener('abort', () => { resolution?.abort(); clearTimeout(debounce); }, { once: true });
      if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(records => {
          if (!records.some(record => record.target !== host)) return;
          // Live pages tick constantly; a quote that still reads the same keeps its anchor.
          if (effect.range && validRange(effect)) return;
          resolution?.abort();
          effect.element = undefined; effect.range = undefined; position(effect);
          // Throttle, not debounce: a page that never stops changing must still get a retry.
          debounce ??= setTimeout(() => { debounce = undefined; resolve(); }, 50);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
        abort.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
      }
      resolve();
    }
  }
  /** The shortcut is the exact set of modifiers held: Alt alone and Alt + Shift are different shortcuts. */
  function held(event: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const key = settings.key;
    return !event.metaKey && event.altKey === key.includes('Alt') && event.shiftKey === key.includes('Shift') && event.ctrlKey === key.includes('Control');
  }
  function armClickSuppression() {
    suppressClick = true; clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { suppressClick = false; }, 0);
  }
  document.addEventListener('pointerdown', event => {
    if (event.isTrusted === false) return;
    if (!available() || (event.button !== 0 && !(event.button === 2 && event.ctrlKey)) || !event.isPrimary || event.pointerType === 'touch') return;
    syncHostZoom();
    if (!held(event) || event.composedPath().includes(host)) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const publicHit: boolean = readable(hit);
    if (!publicHit) {
      // Canvas has no quote text, but a public chart can still send a page signal.
      // Test its own attributes without the generic canvas exclusion, then its real ancestors.
      if (!hit || hit.tagName !== 'CANVAS' || !readable(hit.parentElement) || hit.matches(privateSelector.split(',').filter(selector => selector !== 'canvas').join(','))) return;
      const probe = document.createElement('span');
      for (const name of ['id', 'class', 'aria-label', 'data-testid']) {
        const value = hit.getAttribute(name); if (value) probe.setAttribute(name, value);
      }
      if (isTradeElement(probe)) return;
    }
    // Reserve native drag/context-menu handling while the recognized gesture is pending.
    cancel();
    gesture = { pointer: event.pointerId, control: event.ctrlKey, x: event.clientX, y: event.clientY, dx: 0, dy: 0, active: false, target: captureSignalTarget(event.clientX, event.clientY), url: location.href };
  }, { signal: listeners.signal, capture: true });
  document.addEventListener('pointermove', event => {
    if (event.isTrusted === false) return;
    const g = gesture;
    if (!g || event.pointerId !== g.pointer) return;
    if (!available() || g.url !== location.href || !held(event) || !(event.buttons & (event.ctrlKey ? 3 : 1))) { cancel(); return; }
    if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 8) return;
    if (!g.active) {
      g.active = true;
      const size = Math.min(WHEEL.size * sizes[settings.wheelSize], Math.max(1, Math.min(innerWidth, innerHeight) - 16) * WHEEL.size / (WHEEL.outerR * 2));
      const radius = WHEEL.outerR * size / WHEEL.size;
      const x = Math.max(radius + 8, Math.min(innerWidth - radius - 8, g.x));
      const y = Math.max(radius + 8, Math.min(innerHeight - radius - 8, g.y));
      g.dx = x - g.x; g.dy = y - g.y;
      wheel.setSize(size); wheel.open(x, y);
    }
    event.preventDefault(); event.stopImmediatePropagation();
    wheel.move(event.clientX + g.dx, event.clientY + g.dy);
    const scale = parseFloat(wheelSvg.style.width) / WHEEL.size;
    if (Math.hypot(event.clientX - g.x, event.clientY - g.y) < WHEEL.innerR * scale) centerText('cancel');
  }, { signal: listeners.signal, capture: true, passive: false });
  document.addEventListener('pointerup', event => {
    if (event.isTrusted === false) return;
    const g = gesture;
    if (!g || event.pointerId !== g.pointer) return;
    if (!g.active) { cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); armClickSuppression();
    if (!available() || g.url !== location.href || !held(event)) { cancel(); return; }
    const selection = wheel.release(event.clientX + g.dx, event.clientY + g.dy);
    cancel(); if (!selection) return;
    const emote = isEmote(selection.key) ? selection.key : undefined;
    const kind = emote ? 'attention' : selection.key as SignalKind;
    const requestId = crypto.randomUUID();
    play(kind, g.target, emote, { name: '' }, 3000, { x: g.x, y: g.y });
    const timer = setTimeout(() => { pending.delete(requestId); if (available()) toast('failed'); }, 10_000);
    pending.set(requestId, timer);
    try { send({ type: 'signal-send', requestId, kind, target: g.target, ...(emote ? { emote } : {}) }); }
    catch { result(requestId, false); }
  }, { signal: listeners.signal, capture: true, passive: false });
  document.addEventListener('click', event => {
    if (event.isTrusted === false) return;
    if (!suppressClick) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, { signal: listeners.signal, capture: true });
  document.addEventListener('contextmenu', event => {
    if (event.isTrusted === false) return;
    if (!gesture?.active && !gesture?.control && !suppressClick) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, { signal: listeners.signal, capture: true });
  document.addEventListener('keydown', event => { if (event.isTrusted === false) return; if (event.key === 'Escape') cancel(); }, { signal: listeners.signal, capture: true });
  document.addEventListener('keyup', event => { if (event.isTrusted === false) return; if (gesture && !held(event)) cancel(); }, { signal: listeners.signal, capture: true });
  document.addEventListener('pointercancel', event => { if (event.isTrusted === false) return; cancel(); }, { signal: listeners.signal, capture: true });
  document.addEventListener('dragstart', event => { if (event.isTrusted === false) return; if (gesture) { event.preventDefault(); event.stopImmediatePropagation(); } }, { signal: listeners.signal, capture: true });
  document.addEventListener('selectstart', event => { if (event.isTrusted === false) return; if (gesture) event.preventDefault(); }, { signal: listeners.signal, capture: true });
  const reposition = () => { cancel(); syncHostZoom(); for (const effect of [...effects]) { if (effect.local) remove(effect); else position(effect); } };
  window.addEventListener('scroll', reposition, { signal: listeners.signal, capture: true, passive: true });
  window.addEventListener('resize', reposition, { signal: listeners.signal });
  window.addEventListener('blur', clear, { signal: listeners.signal });
  window.addEventListener('pagehide', clear, { signal: listeners.signal });
  window.addEventListener('popstate', clear, { signal: listeners.signal });
  window.addEventListener('hashchange', clear, { signal: listeners.signal });
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigate', clear, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') clear(); }, { signal: listeners.signal });
  motion.addEventListener('change', clear, { signal: listeners.signal });

  function clear() {
    cancel(); for (const effect of [...effects]) remove(effect);
    stage.dispose(); stopAudio();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear(); seen.clear(); clearTimeout(noticeTimer); clearTimeout(clickTimer); suppressClick = false; notice.hidden = true;
  }
  function result(requestId: string, ok: boolean, error?: string) {
    // Only the background's localized, bounded message may accompany a failed receipt.
    const timer = pending.get(requestId); if (timer === undefined) return;
    clearTimeout(timer); pending.delete(requestId);
    if (!ok && available()) {
      toast('failed');
      if (typeof error === 'string' && error.trim()) { notice.title = error.slice(0, 200); notice.setAttribute('aria-label', notice.title); }
    }
  }
  return {
    configure(on: boolean, next: SignalSettings, nextLabels: Record<string, string>) {
      if (disposed) return;
      cancel(); enabled = on; settings = normalizeSignalSettings(next); labels = nextLabels;
      fill(); centerText('send');
      if (!on) clear();
      if (!settings.sound) stopAudio();
    },
    receive(item: ReceivedSignal, author: PagePerson) {
      const now = Date.now(), age = now - item.sentAt;
      if (!available() || !Number.isFinite(age) || age >= SIGNAL_TTL || age < -1000) return;
      for (const [id, time] of seen) if (now - time > SIGNAL_TTL) seen.delete(id);
      if (seen.has(item.id)) return;
      seen.set(item.id, now);
      play(item.kind, item.target, item.emote, author, Math.max(1, Math.min(3000, SIGNAL_TTL - age)));
    },
    result,
    suspend(on: boolean) { suspended = on; if (on) clear(); },
    clear,
    dispose() { if (disposed) return; disposed = true; clear(); listeners.abort(); host.remove(); },
  };
}
