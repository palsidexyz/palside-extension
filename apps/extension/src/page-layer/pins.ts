import type { PageSticky } from '../runtime/browser/page-protocol';
import { noteHighlight } from './palette.ts';

/** Reference outlines and sticky pin drawing helpers. */
/** Pins whose points are closer than this merge into one pin with a count. */
export const PIN_MERGE = 28;

/** A pin sits on the top-right corner of what it is stuck to, kept inside the box when the box is small. */
export function pinPoint(rect: { left: number; top: number; width: number; height: number }) {
  return { x: rect.left + Math.max(rect.width - 6, rect.width / 2), y: rect.top + Math.min(6, rect.height / 2) };
}

/** Groups points that overlap, keeping input order inside each group; the first point is the group's position. */
export function mergePins<T>(items: readonly { item: T; x: number; y: number }[], distance = PIN_MERGE) {
  const groups: { x: number; y: number; items: T[] }[] = [];
  for (const { item, x, y } of items) {
    const group = groups.find(other => Math.hypot(other.x - x, other.y - y) < distance);
    if (group) group.items.push(item);
    else groups.push({ x, y, items: [item] });
  }
  return groups;
}

export function relativeTime(timestamp: number, locale?: string, now = Date.now()) {
  const minutes = Math.round((timestamp - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? format.format(hours, 'hour') : format.format(Math.round(hours / 24), 'day');
}

/** The hover card: one note per block, newest first, each with face, name and time over the text. */
export function stickyCard(items: readonly PageSticky[], face: (sticky: PageSticky) => HTMLElement, name: (sticky: PageSticky) => string, locale?: string) {
  const card = document.createElement('div');
  card.className = 'sticky-card';
  card.setAttribute('role', 'tooltip');
  for (const sticky of items) {
    const note = document.createElement('div');
    note.className = 'sticky-note';
    const head = document.createElement('div');
    head.className = 'sticky-head';
    const who = document.createElement('b');
    who.textContent = name(sticky);
    const when = document.createElement('span');
    when.textContent = relativeTime(sticky.timestamp, locale);
    head.append(face(sticky), who, when);
    const text = document.createElement('p');
    text.textContent = sticky.text;
    note.append(head, text);
    card.append(note);
  }
  return card;
}

/** Highlights belong to the page's stylesheet, not to the closed overlay shadow. */
export function createStickyHighlight(doc: Document = document, registry = CSS.highlights, HighlightClass = Highlight) {
  const name = `palside-sticky-${crypto.randomUUID()}`;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`::highlight(${name}){background-color:${noteHighlight};color:inherit}`);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  let current: Range[] = [];
  return {
    update(ranges: Range[]) {
      if (ranges.length === current.length && ranges.every((range, index) => range === current[index])) return;
      current = [...ranges];
      if (ranges.length) registry.set(name, new HighlightClass(...ranges));
      else registry.delete(name);
    },
    dispose() {
      registry.delete(name);
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(item => item !== sheet);
    },
  };
}
