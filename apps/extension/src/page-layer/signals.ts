import { SECOND_MS } from '@palside/shared/units';
import type { PagePerson,PageUp } from '../runtime/browser/page-protocol';
import { defaultSignalSettings,isEmote,normalizeSignalSettings,SIGNAL_TTL,type ReceivedSignal,type SignalKind,type SignalSettings,type SignalTarget } from '../runtime/annotations/signals';
import { Wheel,EmoteStage,spawnPing,signalArtCss,createSignalManifest,WHEEL } from '@palside/shared/signal-art';
import { captureSignalTarget,resolveSignalSpot,spotAlive,type SignalSpot } from './signal-targets';
import { paletteCss } from './palette';

/** A signal not yet found on this page looks again this often while it shows. */
const RELOCATE_MS = 500;
/** Holding still this long opens the wheel; moving this far opens it at once. */
const HOLD_MS = 180;
const DRAG_PX = 8;
/** Fields keep their own Alt-drag. Anything else can start a signal, a chart canvas included: its anchors never read
 * the canvas, so a press there points at the chart area, or at the page when the chart is not known. */
const blockedStart = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],palside-page-layer';
const startable = (hit: Element | null): hit is Element => Boolean(hit && !hit.closest(blockedStart));

const sizes = { sm: 0.8, md: 1, lg: 1.2 };
/** x/y is the press point; cx/cy the drawn wheel centre, which picks measure from; still marks a hold-opened wheel the pointer has not left yet. */
type Gesture = { pointer: number; control: boolean; x: number; y: number; cx: number; cy: number; lx: number; ly: number; active: boolean; still: boolean; url: string };
type Effect = { root: HTMLElement; abort: AbortController; timer: ReturnType<typeof setTimeout>; spot?: SignalSpot; local?: { x: number; y: number }; target: SignalTarget; badge: HTMLButtonElement; emote: boolean; edge?: boolean; owner: string; url: string };

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
  let suppressClick = false, menuSwallow = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let swallow: number | undefined;
  let audio: HTMLAudioElement | undefined;
  let tick: HTMLAudioElement | undefined;
  let lastSound = -Infinity, lastTick = -Infinity;
  const effects: Effect[] = [];
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const seen = new Map<string, number>();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const text = (key: string) => labels[key] ?? '';
  // Visible is enough: the page only gains focus after pointerdown, and typing in the side panel blurs it while
  // the page stays in view. The background still requires the focused window's active tab for every send and delivery.
  const pressable = () => enabled && !suspended && !disposed && document.visibilityState === 'visible';
  const shown = pressable;
  const wheelScale = () => parseFloat(wheelSvg.style.width) / WHEEL.size;
  const release = (item: HTMLAudioElement | undefined) => { if (item) { item.pause(); item.removeAttribute('src'); item.load(); } };
  const stopAudio = () => { release(audio); release(tick); audio = tick = undefined; };
  function sound(url: string, vary = true) {
    if (!settings.sound || settings.volume === 0) return;
    // Hover ticks and signal sounds play on separate channels, so a tick never swallows the signal.
    const now = performance.now();
    if (now - (vary ? lastSound : lastTick) < 100) return;
    if (vary) { lastSound = now; release(audio); release(tick); tick = undefined; } else { lastTick = now; release(tick); }
    try {
      const item = new Audio(url); item.volume = settings.volume / 100;
      // A ±3% pitch offset keeps repeats from sounding stamped.
      if (vary) { item.preservesPitch = false; item.playbackRate = 1 + (Math.random() * 2 - 1) * 0.03; audio = item; } else tick = item;
      void item.play().catch(() => {});
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
  function cancel() { gesture = undefined; clearTimeout(holdTimer); wheel.cancel(); }
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
    if (effect.spot && !spotAlive(effect.spot)) effect.spot = undefined;
    const spot = effect.spot, rect = spot?.box.getBoundingClientRect();
    const located = spot && rect && rect.width > 0 && rect.height > 0;
    const px = located ? rect.left + rect.width * spot.x : 0;
    const py = located ? rect.top + rect.height * spot.y : 0;
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
    if (!shown()) return;
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
      root = spawnPing(layer, ping, local?.x ?? innerWidth - 32, local?.y ?? 48, { sizePx: 110 * sizes[settings.size], durationS: duration / SECOND_MS, keep: true, tag: { name: author.name, color: 0 } });
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
      const box = effect.spot?.box;
      const anchor = box && ('tagName' in box ? box : box.startContainer.parentElement);
      anchor?.scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' });
    }, { signal: abort.signal });
    if (!local && !emoteDef && target.kind !== 'page') {
      // One synchronous walk per attempt; a found spot is only measured again, never searched again while it lasts.
      let retry: ReturnType<typeof setTimeout> | undefined;
      const locate = () => {
        retry = undefined;
        if (abort.signal.aborted || !shown()) return;
        if (!effect.spot || !spotAlive(effect.spot)) { effect.spot = resolveSignalSpot(target); position(effect); }
        retry = setTimeout(locate, RELOCATE_MS);
      };
      abort.signal.addEventListener('abort', () => clearTimeout(retry), { once: true });
      locate();
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
  /**
   * Opens the wheel on the press point. Near an edge only the centre core is kept on screen and the ring may run
   * past the edge, so a drag toward the page still leaves the core right away. Picks are measured from the centre
   * that is drawn, so the highlighted slice is always the one in the pointer's direction on screen.
   */
  function activate(g: Gesture, held: boolean) {
    g.active = true; g.still = held; clearTimeout(holdTimer);
    const size = Math.min(WHEEL.size * sizes[settings.wheelSize], Math.max(1, Math.min(innerWidth, innerHeight) - 16) * WHEEL.size / (WHEEL.outerR * 2));
    const core = WHEEL.innerR * size / WHEEL.size + 8;
    g.cx = Math.max(core, Math.min(innerWidth - core, g.x));
    g.cy = Math.max(core, Math.min(innerHeight - core, g.y));
    centerText(''); wheel.setSize(size); wheel.open(g.cx, g.cy);
    // A hold near an edge opens with the pointer off-centre; nothing is picked until it moves.
    if (!held) track(g, g.lx, g.ly);
  }
  function track(g: Gesture, x: number, y: number) {
    g.lx = x; g.ly = y;
    if (g.still && Math.hypot(x - g.x, y - g.y) >= DRAG_PX) g.still = false;
    const px = g.still ? g.cx : x, py = g.still ? g.cy : y;
    wheel.move(px, py);
    if (Math.hypot(px - g.cx, py - g.cy) < WHEEL.innerR * wheelScale()) centerText('');
  }
  /** Ends the gesture but keeps swallowing this press, so its release cannot fall through as a modified click. */
  function abandon() {
    if (gesture?.active) swallow = gesture.pointer;
    cancel();
  }
  /** Sends what the wheel shows at x/y; the centre sends nothing. */
  function commit(g: Gesture, x: number, y: number) {
    armClickSuppression();
    if (!pressable() || g.url !== location.href) { cancel(); return; }
    const selection = g.still ? null : wheel.release(x, y);
    cancel(); if (!selection) return;
    const emote = isEmote(selection.key) ? selection.key : undefined;
    const kind = emote ? 'attention' : selection.key as SignalKind;
    const requestId = crypto.randomUUID();
    // Read the page once, at release: the wheel is closed and the press point still shows what was meant.
    const target = captureSignalTarget(g.x, g.y);
    play(kind, target, emote, { name: '' }, 3000, { x: g.x, y: g.y });
    const timer = setTimeout(() => { pending.delete(requestId); if (shown()) toast('failed'); }, 10_000);
    pending.set(requestId, timer);
    try { send({ type: 'signal-send', requestId, kind, target, ...(emote ? { emote } : {}) }); }
    catch { result(requestId, false); }
  }
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  // Window capture runs before any listener the page puts on the document or its elements,
  // so a page that stops pointer events for its own drag handling cannot starve the wheel.
  const early = { signal: listeners.signal, capture: true, passive: true };
  const blocking = { signal: listeners.signal, capture: true, passive: false };
  window.addEventListener('pointerdown', event => {
    if (event.isTrusted === false) return;
    if (!pressable() || (event.button !== 0 && !(event.button === 2 && event.ctrlKey)) || !event.isPrimary || event.pointerType === 'touch') return;
    syncHostZoom();
    if (!held(event) || event.composedPath().includes(host)) return;
    if (!startable(document.elementFromPoint(event.clientX, event.clientY))) return;
    // Reserve native drag/context-menu handling while the recognized gesture is pending.
    cancel(); swallow = undefined;
    const g: Gesture = { pointer: event.pointerId, control: event.ctrlKey, x: event.clientX, y: event.clientY, cx: event.clientX, cy: event.clientY, lx: event.clientX, ly: event.clientY, active: false, still: false, url: location.href };
    gesture = g;
    // Holding still opens the wheel too, so the choices are visible before picking a direction.
    holdTimer = setTimeout(() => { if (gesture === g && !g.active && pressable() && g.url === location.href) activate(g, true); }, HOLD_MS);
  }, early);
  window.addEventListener('pointermove', event => {
    if (event.isTrusted === false) return;
    const g = gesture;
    if (swallow === event.pointerId && !g) { consume(event); return; }
    if (!g || event.pointerId !== g.pointer) return;
    if (!pressable() || g.url !== location.href) { abandon(); return; }
    if (!(event.buttons & (g.control ? 3 : 1))) {
      // The release happened where this page could not see it (the side panel, outside the window): it still
      // counts as a release, at the last position the wheel saw.
      if (g.active) { consume(event); commit(g, g.lx, g.ly); } else cancel();
      return;
    }
    // The modifier only starts the gesture; once the wheel is open, letting go of it early must not lose the pick.
    if (!g.active && !held(event)) { cancel(); return; }
    // A second button during a left-button gesture cancels, as right-click does on a game ping wheel.
    if (!g.control && event.buttons & 2) { menuSwallow = true; abandon(); consume(event); return; }
    if (!g.active && Math.hypot(event.clientX - g.x, event.clientY - g.y) < DRAG_PX) return;
    g.lx = event.clientX; g.ly = event.clientY;
    if (!g.active) activate(g, false);
    consume(event);
    track(g, event.clientX, event.clientY);
  }, blocking);
  window.addEventListener('pointerup', event => {
    if (event.isTrusted === false) return;
    const g = gesture;
    if (swallow === event.pointerId && !g) { swallow = undefined; consume(event); armClickSuppression(); return; }
    if (!g || event.pointerId !== g.pointer) return;
    if (!g.active) { cancel(); return; }
    consume(event);
    track(g, event.clientX, event.clientY);
    commit(g, g.still ? g.cx : event.clientX, g.still ? g.cy : event.clientY);
  }, blocking);
  window.addEventListener('click', event => {
    if (event.isTrusted === false) return;
    if (!suppressClick) return;
    suppressClick = false; consume(event);
  }, blocking);
  window.addEventListener('contextmenu', event => {
    if (event.isTrusted === false) return;
    if (!gesture?.active && !gesture?.control && !suppressClick && !menuSwallow) return;
    menuSwallow = false; consume(event);
  }, blocking);
  window.addEventListener('keydown', event => { if (event.isTrusted === false) return; if (event.key === 'Escape' && gesture) abandon(); }, early);
  window.addEventListener('keyup', event => { if (event.isTrusted === false) return; if (gesture && !gesture.active && !held(event)) cancel(); }, early);
  window.addEventListener('pointercancel', event => { if (event.isTrusted === false) return; cancel(); }, early);
  window.addEventListener('dragstart', event => { if (event.isTrusted === false) return; if (gesture) consume(event); }, blocking);
  window.addEventListener('selectstart', event => { if (event.isTrusted === false) return; if (gesture) event.preventDefault(); }, blocking);
  const reposition = (page = true) => { syncHostZoom(); for (const effect of [...effects]) { if (effect.local && page) remove(effect); else if (!effect.local) position(effect); } };
  // Live pages scroll their own lists all the time; the open wheel is fixed to the viewport and keeps its pick.
  window.addEventListener('scroll', event => reposition(event.target === document || event.target === document.documentElement || event.target === window), { signal: listeners.signal, capture: true, passive: true });
  window.addEventListener('resize', () => { cancel(); reposition(); }, { signal: listeners.signal });
  // Focus moving to the side panel blurs the page; shown signals stay, only a gesture in progress ends.
  window.addEventListener('blur', () => abandon(), { signal: listeners.signal });
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
    pending.clear(); seen.clear(); clearTimeout(noticeTimer); clearTimeout(clickTimer); suppressClick = menuSwallow = false; swallow = undefined; notice.hidden = true;
  }
  function result(requestId: string, ok: boolean, error?: string) {
    // Only the background's localized, bounded message may accompany a failed receipt.
    const timer = pending.get(requestId); if (timer === undefined) return;
    clearTimeout(timer); pending.delete(requestId);
    if (!ok && shown()) {
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
      // Lifetime counts from arrival on this device; members' clocks may disagree.
      const now = Date.now(), age = now - item.at;
      if (!shown() || !Number.isFinite(age) || age >= SIGNAL_TTL || age < -SECOND_MS) return;
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
