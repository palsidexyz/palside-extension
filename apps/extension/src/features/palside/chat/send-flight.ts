import { createContext } from 'react';

type Box = { left: number; top: number; width: number; height: number };
/** Where a sent text sat in the composer: its own box, the visible input box, and the composer surface it lifts off. */
type FlightSource = { text: Box; input: Box; long: boolean; background: string; radius: string };
type Armed = { source: FlightSource; follow: () => boolean; at: number; played?: boolean; shift?: number | null };

const box = (rect: DOMRect | Box): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatureSettings', 'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing', 'wordBreak', 'overflowWrap', 'textAlign', 'direction'] as const;
const FLIGHT_MS = 420;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const ARMED_FOR = 4000;

/** Measures the trimmed message where it sits inside the untrimmed draft, before the draft clears. */
export function captureComposer(input: HTMLTextAreaElement, surface: HTMLElement, text: string): FlightSource | undefined {
  const raw = input.value, start = raw.indexOf(text);
  if (!text || start < 0 || !input.isConnected) return;
  const rect = input.getBoundingClientRect(), style = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const key of MIRRORED) mirror.style[key] = style[key];
  Object.assign(mirror.style, { position: 'fixed', left: `${rect.left + input.clientLeft}px`, top: `${rect.top + input.clientTop - input.scrollTop}px`, width: `${input.clientWidth}px`, whiteSpace: 'pre-wrap', visibility: 'hidden', pointerEvents: 'none', contain: 'layout style' });
  mirror.textContent = raw;
  document.body.append(mirror);
  const range = document.createRange();
  range.setStart(mirror.firstChild!, start); range.setEnd(mirror.firstChild!, start + text.length);
  const rects = [...range.getClientRects()].filter(item => item.width > 0);
  mirror.remove();
  if (!rects.length) return;
  const left = Math.min(...rects.map(item => item.left)), top = Math.min(...rects.map(item => item.top));
  const textBox = { left, top, width: Math.max(...rects.map(item => item.right)) - left, height: Math.max(...rects.map(item => item.bottom)) - top };
  const lines = Math.round(textBox.height / (parseFloat(style.lineHeight) || 22));
  const surfaceStyle = getComputedStyle(surface);
  return {
    text: textBox,
    input: { left: rect.left + input.clientLeft, top: rect.top + input.clientTop, width: input.clientWidth, height: input.clientHeight },
    long: lines > 5 || input.scrollHeight > input.clientHeight + 1,
    background: surfaceStyle.backgroundColor,
    radius: `${Math.min(parseFloat(surfaceStyle.borderTopLeftRadius) || 12, 14)}px`,
  };
}

/** Flights armed by a send, keyed by the sent message's client ID; a row consumes its flight when it mounts. Retries never arm one. */
export class SendFlights {
  private armed = new Map<string, Armed>();
  private running = new Set<Animation>();
  private prune() { const now = performance.now(); for (const [id, entry] of this.armed) if (now - entry.at > ARMED_FOR) this.armed.delete(id); }
  arm(id: string, source: FlightSource, follow: () => boolean) { this.prune(); this.armed.set(id, { source, follow, at: performance.now() }); }
  peek(id: string) {
    this.prune();
    const entry = this.armed.get(id);
    if (entry?.played) { this.armed.delete(id); return; }
    return entry;
  }
  /** Follows the list to the sent row once, even when a StrictMode remount replays the effect; null when the reader had moved on. */
  follow(entry: Armed, list: HTMLElement) {
    if (entry.shift === undefined) { const before = list.scrollTop; entry.shift = entry.follow() ? list.scrollTop - before : null; }
    return entry.shift;
  }
  done(id: string) { const entry = this.armed.get(id); if (entry) entry.played = true; this.armed.delete(id); this.prune(); }
  track(animation: Animation) { this.running.add(animation); void animation.finished.catch(() => {}).finally(() => this.running.delete(animation)); }
  /** Reader input settles every flight at its destination at once. */
  finishAll() { this.prune(); for (const animation of [...this.running]) { try { animation.finish(); } catch { animation.cancel(); } } }
}

export const SendFlightContext = createContext<{ flights: SendFlights; layer: () => HTMLElement | null; list: () => HTMLElement | null } | null>(null);

/**
 * Lifts the composer text into its bubble: the surface reshapes from the composer to the bubble while a copy of the
 * bubble content travels from the composer's text position to its own. Earlier rows slide up by the space the row took.
 * Returns a cancel that restores the real bubble.
 */
export function playFlight({ layer, list, row, bubble, source, shift, track, onDone }: { layer: HTMLElement; list: HTMLElement; row: HTMLElement; bubble: HTMLElement; source: FlightSource; shift: number; track: (animation: Animation) => void; onDone: () => void }) {
  const text = bubble.querySelector<HTMLElement>('[data-message-text]');
  const area = layer.getBoundingClientRect(), to = bubble.getBoundingClientRect(), style = getComputedStyle(bubble);
  if (!text || !to.width) { onDone(); return () => {}; }
  const textRect = text.getBoundingClientRect();
  const pad = { left: parseFloat(style.paddingLeft), top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom) };
  // A short text lifts off as its own padded block; a long one leaves as the whole visible input box.
  const from = source.long
    ? { left: source.input.left - pad.left / 2, top: source.input.top - pad.top / 2, width: source.input.width + pad.left, height: source.input.height + pad.top }
    : { left: source.text.left - pad.left, top: source.text.top - pad.top, width: source.text.width + pad.left + pad.right, height: source.text.height + pad.top + pad.bottom };
  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true'); ghost.dataset.sendFlight = '';
  Object.assign(ghost.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', zIndex: '40', contain: 'layout paint' });
  const copy = bubble.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id'); copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.inert = true;
  Object.assign(copy.style, { position: 'absolute', left: '0', top: '0', width: `${to.width}px`, height: `${to.height}px`, margin: '0', background: 'transparent', visibility: 'visible', transform: 'none', boxShadow: 'none' });
  ghost.append(copy);
  layer.append(ghost);
  const dx = source.text.left - from.left - (textRect.left - to.left), dy = source.text.top - from.top - (textRect.top - to.top);
  const at = (rect: Box) => ({ left: `${rect.left - area.left}px`, top: `${rect.top - area.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const timing = { duration: FLIGHT_MS, easing: EASE, fill: 'both' as const };
  const jobs = [
    ghost.animate([{ ...at(box(from)), borderRadius: source.radius, backgroundColor: source.background }, { ...at(box(to)), borderRadius: style.borderRadius, backgroundColor: style.backgroundColor }], timing),
    copy.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], timing),
  ];
  // Cards that belong to the message (token, page, image) arrive once the words have landed.
  for (const sibling of bubble.parentElement?.children ?? []) if (sibling !== bubble) jobs.push((sibling as HTMLElement).animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], { duration: FLIGHT_MS + 120, easing: 'linear' }));
  if (shift > 0) {
    const content = list.firstElementChild;
    const moving = content ? [...content.children].flatMap(child => child.contains(row) ? [...child.children].filter(item => item !== row && !item.contains(row)) : [child]) : [];
    for (const element of moving) jobs.push(element.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: FLIGHT_MS, easing: EASE }));
  }
  bubble.style.visibility = 'hidden';
  jobs.forEach(track);
  let settled = false;
  const settle = (complete: boolean) => { if (settled) return; settled = true; ghost.remove(); bubble.style.visibility = ''; if (complete) onDone(); };
  void Promise.all(jobs.map(job => job.finished)).then(() => settle(true), () => settle(true));
  // Unmounting cancels without consuming the flight, so a remount within the arming window can still play it.
  return () => { settle(false); for (const job of jobs) job.cancel(); };
}
