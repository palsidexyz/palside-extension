import { privateSelector } from './adapters.ts';
import { normalizeQuoteWhitespace } from './text.ts';

/**
 * One walk of the page's public text, where signals find their anchors.
 *
 * A walk starts at the body and never enters a hidden or private subtree, so nothing inside one is read. Text is kept as
 * runs with whitespace collapsed: a hidden or private subtree ends a run, so no match spans it; layout boundaries invent
 * no separators, so text reads the way a native selection does. Each run maps back to DOM positions.
 */

/** A page past these sizes counts as not found; it cannot hold the main thread for seconds. */
const MAX_NODES = 250_000;
const MAX_TEXT = 4_000_000;
const NUMBER = /(?<![A-Za-z\d])\d[\d.,]*/gu;
const CLIPS = /hidden|clip|auto|scroll/;

/**
 * Text for a loose comparison. A standalone number of any length reads as one 0, so a ticking price still matches; a digit
 * straight after a Latin letter names something, so `Token1` and `Token2` stay different.
 */
export const textKey = (text: string) => normalizeQuoteWhitespace(text).replace(NUMBER, '0');

/** `textKey` of a run, with each key position's place in the run's text; one extra entry marks the end. */
function looseRun(text: string) {
  const places: number[] = [];
  let key = '', cursor = 0;
  const copy = (end: number) => { for (let at = cursor; at < end; at += 1) places.push(at); key += text.slice(cursor, end); };
  for (const number of text.matchAll(NUMBER)) {
    copy(number.index);
    places.push(number.index); key += '0';
    cursor = number.index + number[0].length;
  }
  copy(text.length);
  places.push(text.length);
  return { key, places };
}

function styleHides(style: CSSStyleDeclaration) {
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden';
}
const hasArea = (element: Element) => { const rect = element.getBoundingClientRect(); return Boolean(rect.width && rect.height); };

/** Own visibility only; walks start at the root and never enter a hidden or private subtree. */
export function shown(element: Element) {
  return !element.matches(privateSelector) && !styleHides(getComputedStyle(element));
}
/** The element and all its ancestors are public and visible. */
export function publicElement(element: Element | null): element is Element {
  if (!element || element.closest(privateSelector)) return false;
  for (let node: Element | null = element, depth = 0; node; node = node.parentElement) if (++depth > 64 || !shown(node)) return false;
  return true;
}
/** The element and its ancestors are public and visible, and the element itself takes up space. */
export function readable(element: Element | null): element is Element {
  if (!element || element.closest(privateSelector)) return false;
  for (let node: Element | null = element; node; node = node.parentElement) if (styleHides(getComputedStyle(node))) return false;
  return hasArea(element) || getComputedStyle(element).display === 'contents';
}
/** What a walk enters. A box with no area shows its children unless it clips them, as a collapsed panel does. */
function walkable(element: Element) {
  if (element.matches(privateSelector)) return false;
  const style = getComputedStyle(element);
  return !styleHides(style) && !(CLIPS.test(style.overflow ?? '') && !hasArea(element));
}

export type TextPoint = { node: Text; offset: number };
/** A stretch of collapsed text from one node. A collapsed whitespace run is one character and may end in a later node. */
type Segment = TextPoint & { at: number; length: number; last?: TextPoint };
type Run = { text: string; segments: Segment[]; loose?: ReturnType<typeof looseRun> };
type Snapshot = { elements: Element[]; runs: Run[] };

/** Undefined past the size caps. */
function walk(): Snapshot | undefined {
  const root = document.body;
  if (!root) return;
  const elements: Element[] = [], runs: Run[] = [];
  let parts: string[] = [], segments: Segment[] = [], at = 0, total = 0, space: (TextPoint & { last: TextPoint }) | undefined;
  const closeSpace = () => {
    if (!space) return;
    parts.push(' '); segments.push({ ...space, at, length: 1 });
    at += 1; total += 1; space = undefined;
  };
  const closeRun = () => {
    closeSpace();
    if (at) runs.push({ text: parts.join(''), segments });
    parts = []; segments = []; at = 0;
  };
  const addText = (node: Text) => {
    const data = node.data, spaces = /\s+/gu;
    let cursor = 0;
    const word = (end: number) => {
      if (end <= cursor) return;
      closeSpace();
      parts.push(data.slice(cursor, end)); segments.push({ node, offset: cursor, at, length: end - cursor });
      at += end - cursor; total += end - cursor;
    };
    for (let found = spaces.exec(data); found; found = spaces.exec(data)) {
      word(found.index);
      const last = { node, offset: found.index + found[0].length - 1 };
      if (space) space.last = last; else space = { node, offset: found.index, last };
      cursor = found.index + found[0].length;
    }
    word(data.length);
  };
  let parent: Element | null = null, parentHasBox = false;
  const inBox = (node: Text) => {
    if (node.parentElement !== parent) {
      parent = node.parentElement;
      parentHasBox = Boolean(parent && (hasArea(parent) || getComputedStyle(parent).display === 'contents'));
    }
    return parentHasBox;
  };
  let node: Node | null = root.firstChild, visited = 0;
  while (node) {
    if (++visited > MAX_NODES) return;
    let enter = false;
    if (node.nodeType === Node.TEXT_NODE) {
      if (inBox(node as Text)) { addText(node as Text); if (total > MAX_TEXT) return; }
      else closeRun();
    } else if (node.nodeType === 1) {
      if (walkable(node as Element)) { elements.push(node as Element); enter = Boolean(node.firstChild); }
      else closeRun();
    }
    if (enter) { node = node.firstChild; continue; }
    while (node && node !== root && !node.nextSibling) node = node.parentNode;
    if (!node || node === root) break;
    node = node.nextSibling;
  }
  closeRun();
  return { elements, runs };
}

let scan: { snapshot?: Snapshot | null } | undefined;
/** Everything inside `work` reads one walk of the page, taken on first use. Outside it, every lookup walks afresh. */
export function scanning<T>(work: () => T): T {
  if (scan) return work();
  scan = {};
  try { return work(); } finally { scan = undefined; }
}
function snapshot(): Snapshot | undefined {
  if (!scan) return walk();
  if (scan.snapshot === undefined) scan.snapshot = walk() ?? null;
  return scan.snapshot ?? undefined;
}

/** The page's public elements in document order; undefined when the page is too large to tell. */
export function pageElements() { return snapshot()?.elements; }

export type TextMatch = { run: Run; head: number; tail: number };
/**
 * Every place `prefix + exact + suffix` reads the same, overlapping ones included, stopping past `limit`. Loose compares
 * through `textKey`, so a match's own text may differ in its numbers. Undefined when the page is too large to tell.
 */
export function findText(query: { prefix: string; exact: string; suffix: string }, limit: number, loose = false): TextMatch[] | undefined {
  const page = snapshot();
  if (!page) return;
  const key = loose ? textKey : normalizeQuoteWhitespace;
  const before = key(query.prefix), through = key(query.prefix + query.exact), search = key(query.prefix + query.exact + query.suffix);
  const out: TextMatch[] = [];
  for (const run of page.runs) {
    const mapped = loose ? run.loose ??= looseRun(run.text) : undefined, text = mapped?.key ?? run.text;
    for (let index = text.indexOf(search); index >= 0; index = text.indexOf(search, index + 1)) {
      const head = index + before.length, end = index + through.length;
      out.push(mapped ? { run, head: mapped.places[head]!, tail: mapped.places[end]! - 1 } : { run, head, tail: end - 1 });
      if (out.length > limit) return out;
    }
  }
  return out;
}

function segmentAt(run: Run, index: number) {
  let low = 0, high = run.segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (run.segments[middle]!.at <= index) low = middle; else high = middle - 1;
  }
  return run.segments[low]!;
}
export function matchStart(match: TextMatch): TextPoint {
  const segment = segmentAt(match.run, match.head);
  return { node: segment.node, offset: segment.offset + match.head - segment.at };
}
export function matchRange(match: TextMatch) {
  const start = matchStart(match), segment = segmentAt(match.run, match.tail);
  const end = segment.last ?? { node: segment.node, offset: segment.offset + match.tail - segment.at };
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}
