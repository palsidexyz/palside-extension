import { SECOND_MS } from '@palside/shared/units';
import type { PagePerson,PageUp } from '../runtime/browser/page-protocol';
import { defaultSignalSettings,isEmote,normalizeSignalSettings,SIGNAL_TTL,type ReceivedSignal,type SignalKind,type SignalSettings,type SignalTarget } from '../runtime/annotations/signals';
import { Wheel,EmoteStage,spawnPing,signalArtCss,createSignalManifest,WHEEL } from '@palside/shared/signal-art';
import { scanning } from './page-text';
import { captureSignalTarget,resolveSignalSpot,spotAlive,type SignalSpot } from './signal-targets';
import { randomId } from './text.ts';
import { paletteCss } from './palette';

/** A shown signal is checked this often; one not found looks again only after the page changed. */
const RELOCATE_MS = 500;
/** Looking again takes at most one part in this many of the main thread. */
const SCAN_SHARE = 20;
/** Holding still this long opens the wheel; moving this far opens it at once. */
const HOLD_MS = 180;
const DRAG_PX = 8;
/** Fields keep their own Alt-drag. Anything else can start a signal, a chart canvas included: its anchors never read
 * the canvas, so a press there points at the chart area, or at the page when the chart is not known. */
/** A replayed signal on a page that just opened: it may still be rendering the spot, so wait this long before showing it at the edge. */
const REPLAY_WAIT_MS = 2_000, REPLAY_RETRY_MS = 250;
/** A replay was asked for, so it stays a little longer than a live signal. */
const REPLAY_SHOW_MS = 4_000;
const blockedStart = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],palside-page-layer';
const startable = (hit: Element | null): hit is Element => Boolean(hit && !hit.closest(blockedStart));

const sizes = { sm: 0.8, md: 1, lg: 1.2 };
/** x/y is the press point; cx/cy the drawn wheel centre, which picks measure from; still marks a hold-opened wheel the pointer has not left yet. */
type Gesture = { pointer: number; control: boolean; x: number; y: number; cx: number; cy: number; lx: number; ly: number; active: boolean; still: boolean };
type Effect = { root: HTMLElement; abort: AbortController; timer: ReturnType<typeof setTimeout>; spot?: SignalSpot; local?: { x: number; y: number }; target: SignalTarget; badge: HTMLButtonElement; emote: boolean; edge?: boolean; owner: string; clip?: IntersectionObserver; clipped?: boolean; offscreen?: boolean };

export function createSignals(send: (message: PageUp) => void, base: string, onPageChange: (listener: () => void) => () => void) {
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
    .page-signal .tag { top: 22px; }
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
  let frame: number | undefined, relocating: ReturnType<typeof setTimeout> | undefined;
  let pageChanged = false, searchAllowedAt = 0;
  const stopWatching = onPageChange(() => { pageChanged = true; });
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const seen = new Map<string, number>();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const text = (key: string) => labels[key] ?? '';
  // Visible is enough: the page only gains focus after pointerdown, and typing in the side panel blurs it while
  // the page stays in view. The background still requires the focused window's active tab for every send and delivery.
  const showable = () => !suspended && !disposed && document.visibilityState === 'visible';
  const pressable = () => enabled && showable();
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
    effect.abort.abort(); clearTimeout(effect.timer); effect.clip?.disconnect();
    if (effect.emote) stage.clear(effect.owner);
    effect.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    effect.root.remove(); effects.splice(effects.indexOf(effect), 1);
    if (effect.edge) stackEdge();
  }
  function position(effect: Effect) {
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
    const spot = effect.spot, rect = spot?.box.getBoundingClientRect();
    const located = spot && rect && rect.width > 0 && rect.height > 0;
    const px = located ? rect.left + rect.width * spot.x : 0;
    const py = located ? rect.top + rect.height * spot.y : 0;
    const offscreen = Boolean(located && (effect.clipped || px < 0 || py < 0 || px > innerWidth || py > innerHeight));
    effect.root.classList.toggle('page-signal', !located);
    effect.root.style.left = `${located ? Math.max(32, Math.min(innerWidth - 32, px)) : innerWidth - 32}px`;
    if (located) effect.root.style.top = `${Math.max(32, Math.min(innerHeight - 64, py))}px`;
    const wasEdge = effect.edge; effect.edge = !located;
    if (wasEdge !== effect.edge) stackEdge();
    if (effect.offscreen === offscreen) return;
    effect.offscreen = offscreen;
    effect.badge.textContent = offscreen ? '↗' : '';
    effect.badge.title = text('locate'); effect.badge.setAttribute('aria-label', text('locate'));
    effect.badge.hidden = !offscreen;
    effect.badge.disabled = !offscreen;
    effect.badge.classList.toggle('locate', offscreen);
  }
  /** Set a received signal's spot. A spot scrolled out of an inner list counts as off screen, whatever its coordinates. */
  function place(effect: Effect, spot: SignalSpot | undefined) {
    effect.spot = spot; effect.clipped = false; effect.clip?.disconnect(); effect.clip = undefined;
    let box = spot && ('tagName' in spot.box ? spot.box : spot.box.startContainer.parentElement);
    while (box && !box.getBoundingClientRect().width) box = box.parentElement;
    if (!box) return;
    effect.clip = new IntersectionObserver(entries => { effect.clipped = !entries.at(-1)!.isIntersecting; });
    effect.clip.observe(box);
  }
  const received = () => effects.filter(effect => !effect.local && !effect.emote && effect.target.kind !== 'page');
  /** Layout moves without any event a page script can hear, so a shown signal is measured every frame. It lives seconds. */
  function follow() {
    frame = undefined;
    const list = received();
    if (!list.length || !showable()) return;
    for (const effect of list) position(effect);
    frame = requestAnimationFrame(follow);
  }
  /** Spots that went away, and spots not found while the page changes, within the search budget. */
  function relocate() {
    relocating = undefined;
    const list = received();
    if (!list.length || !showable()) return;
    for (const effect of list) if (effect.spot && !spotAlive(effect.spot)) { place(effect, undefined); pageChanged = true; }
    const lost = list.filter(effect => !effect.spot), now = performance.now();
    if (lost.length && pageChanged && now >= searchAllowedAt) {
      pageChanged = false;
      scanning(() => { for (const effect of lost) place(effect, resolveSignalSpot(effect.target)); });
      const end = performance.now();
      searchAllowedAt = end + (end - now) * SCAN_SHARE;
    }
    relocating = setTimeout(relocate, RELOCATE_MS);
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
    if (!showable()) return;
    syncHostZoom();
    const emoteDef = emote ? manifest.emotes.find(item => item.id === emote) : undefined;
    if (emote && !emoteDef) return;
    const ping = manifest.pings.find(item => item.id === kind);
    if (!ping) return;
    while (effects.length >= 3) remove(effects[0]!);
    const owner = randomId();
    let root: HTMLElement;
    if (emoteDef) {
      const size = 110 * sizes[settings.emoteSize];
      // A received emote starts at the top of the edge; position() moves it into the stack.
      const x = local?.x ?? Math.max(size / 2, innerWidth - size / 2 - 24), y = local?.y ?? 90;
      if (!motion.matches) {
        stage.spawn(owner, emoteDef.image, x, y, { sizePx: size, tag: author.name ? { name: author.name, color: 0 } : undefined, onReady: () => {
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
        root.append(img); emotes.append(root);
        if (author.name) { const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = author.name; root.append(tag); }
      }
      sound(emoteDef.sound);
    } else {
      root = spawnPing(layer, ping, local?.x ?? innerWidth - 32, local?.y ?? 48, { sizePx: 110 * sizes[settings.size], durationS: duration / SECOND_MS, keep: true, tag: author.name ? { name: author.name, color: 0 } : undefined });
      sound(ping.sound);
    }
    const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'anchor-label'; badge.hidden = true; root.append(badge);
    const abort = new AbortController();
    const effect: Effect = { root, abort, timer: setTimeout(() => remove(effect), local && emoteDef && !motion.matches ? 10_000 : duration), local, target, badge, emote: Boolean(emoteDef), owner };
    effects.push(effect);
    // A new signal is the one search that does not wait for the budget.
    if (!local && !emoteDef && target.kind !== 'page') place(effect, resolveSignalSpot(target));
    position(effect);
    badge.addEventListener('click', event => {
      if (event.isTrusted === false) return;
      event.preventDefault(); event.stopPropagation();
      reveal(effect);
    }, { signal: abort.signal });
    if (received().includes(effect)) {
      frame ??= requestAnimationFrame(follow);
      relocating ??= setTimeout(relocate, RELOCATE_MS);
    }
    return effect;
  }
  function reveal(effect: Effect) {
    position(effect);
    const box = effect.spot?.box;
    const anchor = box && ('tagName' in box ? box : box.startContainer.parentElement);
    anchor?.scrollIntoView({ block: 'center', behavior: motion.matches ? 'instant' : 'smooth' });
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
    if (!pressable()) { cancel(); return; }
    const selection = g.still ? null : wheel.release(x, y);
    cancel(); if (!selection) return;
    const emote = isEmote(selection.key) ? selection.key : undefined;
    const kind = emote ? 'attention' : selection.key as SignalKind;
    const requestId = randomId();
    // Read the page once, at release: the wheel is closed and the press point still shows what was meant.
    const target = captureSignalTarget(g.x, g.y);
    play(kind, target, emote, { name: '' }, 3000, { x: g.x, y: g.y });
    const timer = setTimeout(() => { pending.delete(requestId); if (pressable()) toast('failed'); }, 10_000);
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
    const g: Gesture = { pointer: event.pointerId, control: event.ctrlKey, x: event.clientX, y: event.clientY, cx: event.clientX, cy: event.clientY, lx: event.clientX, ly: event.clientY, active: false, still: false };
    gesture = g;
    // Holding still opens the wheel too, so the choices are visible before picking a direction.
    holdTimer = setTimeout(() => { if (gesture === g && !g.active && pressable()) activate(g, true); }, HOLD_MS);
  }, early);
  window.addEventListener('pointermove', event => {
    if (event.isTrusted === false) return;
    const g = gesture;
    if (swallow === event.pointerId && !g) { consume(event); return; }
    if (!g || event.pointerId !== g.pointer) return;
    if (!pressable()) { abandon(); return; }
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
  const removeLocal = () => { for (const effect of [...effects]) if (effect.local) remove(effect); };
  // Live pages scroll their own lists all the time; a local effect stays for those, and goes when the page itself scrolls.
  window.addEventListener('scroll', event => { if (event.target === document || event.target === document.documentElement || event.target === window) removeLocal(); }, { signal: listeners.signal, capture: true, passive: true });
  window.addEventListener('resize', () => {
    cancel(); syncHostZoom(); removeLocal(); pageChanged = true;
    for (const effect of effects) position(effect);
    stackEdge();
  }, { signal: listeners.signal });
  // Focus moving to the side panel blurs the page; shown signals stay, only a gesture in progress ends.
  window.addEventListener('blur', () => abandon(), { signal: listeners.signal });
  window.addEventListener('pagehide', clear, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') clear(); }, { signal: listeners.signal });
  motion.addEventListener('change', clear, { signal: listeners.signal });

  function clear() {
    cancel(); for (const effect of [...effects]) remove(effect);
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(relocating); frame = relocating = undefined; pageChanged = false; searchAllowedAt = 0;
    stage.dispose(); stopAudio();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear(); seen.clear(); clearTimeout(noticeTimer); clearTimeout(clickTimer); suppressClick = menuSwallow = false; swallow = undefined; notice.hidden = true;
  }
  function result(requestId: string, ok: boolean, error?: string) {
    // Only the background's localized, bounded message may accompany a failed receipt.
    const timer = pending.get(requestId); if (timer === undefined) return;
    clearTimeout(timer); pending.delete(requestId);
    if (!ok && pressable()) {
      toast('failed');
      if (typeof error === 'string' && error.trim()) { notice.title = error.slice(0, 200); notice.setAttribute('aria-label', notice.title); }
    }
  }
  return {
    configure(on: boolean, next: SignalSettings, nextLabels: Record<string, string>) {
      if (disposed) return;
      const was = enabled;
      cancel(); enabled = on; settings = normalizeSignalSettings(next); labels = nextLabels;
      fill(); centerText('');
      // Only turning off clears: a page where signals stay off may be showing a replay the user just asked for.
      if (!on && was) clear();
      if (!settings.sound) stopAudio();
    },
    receive(item: ReceivedSignal, author: PagePerson) {
      // Lifetime counts from arrival on this device; members' clocks may disagree.
      const now = Date.now(), age = now - item.at;
      if (!pressable() || !Number.isFinite(age) || age >= SIGNAL_TTL || age < -SECOND_MS) return;
      for (const [id, time] of seen) if (now - time > SIGNAL_TTL) seen.delete(id);
      if (seen.has(item.id)) return;
      seen.set(item.id, now);
      play(item.kind, item.target, item.emote, author, Math.max(1, Math.min(3000, SIGNAL_TTL - age)));
    },
    /** Asked for from the chat, on any site, whether or not it shows live signals. */
    async replay(kind: SignalKind, target: SignalTarget, author: PagePerson): Promise<'shown' | 'unavailable'> {
      const deadline = performance.now() + REPLAY_WAIT_MS;
      while (showable() && target.kind !== 'page' && !resolveSignalSpot(target) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, REPLAY_RETRY_MS));
      if (!showable()) return 'unavailable';
      const effect = play(kind, target, undefined, author, REPLAY_SHOW_MS);
      if (!effect) return 'unavailable';
      if (effect.offscreen) reveal(effect);
      return 'shown';
    },
    result,
    suspend(on: boolean) { suspended = on; if (on) clear(); },
    clear,
    dispose() { if (disposed) return; disposed = true; clear(); stopWatching(); listeners.abort(); host.remove(); },
  };
}
