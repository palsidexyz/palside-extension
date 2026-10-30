/** Highlights painted with the CSS Custom Highlight API, so React-owned text nodes are never split or rewritten. */

/** Case-insensitive occurrences of a needle, as [start, end) offsets into the text. */
export function matchOffsets(text: string, needle: string): [number, number][] {
  const query = needle.trim().toLocaleLowerCase();
  if (!query) return [];
  const haystack = text.toLocaleLowerCase();
  const found: [number, number][] = [];
  // Lower-casing can change lengths for a few scripts; only exact-length folds keep offsets aligned.
  if (haystack.length !== text.length) return found;
  for (let at = haystack.indexOf(query); at >= 0; at = haystack.indexOf(query, at + query.length)) found.push([at, at + query.length]);
  return found;
}

/**
 * A search result's text split into plain and hit segments. When the first hit sits deep in the text, the snippet starts
 * shortly before it so the hit survives the result row's two-line clamp.
 */
export function hitSegments(text: string, needle: string, lead = 24): { text: string; hit: boolean }[] {
  const hits = matchOffsets(text, needle);
  if (!hits.length) return [{ text, hit: false }];
  let start = hits[0]![0] > lead * 1.5 ? hits[0]![0] - lead : 0;
  // Never split a surrogate pair, and back up to the start of a nearby space-separated word.
  for (let limit = start - 12; start > 0 && start > limit && /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}]/u.test(text[start - 1]!);) start--;
  if (/[\uDC00-\uDFFF]/.test(text[start] ?? '')) start--;
  const segments: { text: string; hit: boolean }[] = start ? [{ text: '…', hit: false }] : [];
  let at = start;
  for (const [from, to] of hits) { if (from > at) segments.push({ text: text.slice(at, from), hit: false }); segments.push({ text: text.slice(from, to), hit: true }); at = to; }
  if (at < text.length) segments.push({ text: text.slice(at), hit: false });
  return segments;
}

function textNodes(element: Element) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function spanRanges(nodes: Text[], spans: [number, number][]) {
  const locate = (offset: number): [Text, number] => {
    for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    const last = nodes[nodes.length - 1]!; return [last, last.length];
  };
  return spans.map(([start, end]) => { const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end)); return range; });
}

/** Ranges over an element's text for each occurrence of the needle, crossing link and mention boundaries; the whole text without a needle. */
export function textRanges(element: Element, needle?: string): Range[] {
  const nodes = textNodes(element);
  if (!nodes.length) return [];
  const text = nodes.map(node => node.data).join('');
  return spanRanges(nodes, needle === undefined ? (text.trim() ? [[0, text.length]] : []) : matchOffsets(text, needle));
}

/** One range over [start, end) of an element's text, or none when the element no longer shows `expected` exactly. */
export function offsetRange(element: Element, start: number, end: number, expected: string): Range[] {
  const nodes = textNodes(element);
  if (nodes.map(node => node.data).join('') !== expected || end > expected.length) return [];
  return spanRanges(nodes, [[start, end]]);
}

/**
 * The current selection as offsets into an element's text, trimmed of surrounding white space and clipped to the
 * element. Undefined when nothing inside it is selected, or when the element does not show `expected` exactly.
 */
export function selectionOffsets(element: Element, expected: string): [number, number] | undefined {
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const selected = selection.getRangeAt(0), whole = document.createRange();
  whole.selectNodeContents(element);
  if (selected.compareBoundaryPoints(Range.END_TO_START, whole) >= 0 || selected.compareBoundaryPoints(Range.START_TO_END, whole) <= 0) return;
  if (element.textContent !== expected) return;
  const clipped = selected.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clipped.setStart(whole.startContainer, whole.startOffset);
  if (clipped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clipped.setEnd(whole.endContainer, whole.endOffset);
  const before = document.createRange();
  before.setStart(whole.startContainer, whole.startOffset); before.setEnd(clipped.startContainer, clipped.startOffset);
  let start = before.toString().length, end = start + clipped.toString().length;
  // Selections often run over a separator; the quote keeps the words, ending punctuation (。！？) stays.
  while (start < end && /[\s，、,；;：:]/.test(expected[start]!)) start++;
  while (end > start && /[\s，、,；;：:]/.test(expected[end - 1]!)) end--;
  return end > start ? [start, end] : undefined;
}

const highlightsSupported = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

const FOCUS = 'palside-focus';
const FADE = ['palside-focus-fade-1', 'palside-focus-fade-2', 'palside-focus-fade-3'];
const FOCUS_HOLD = 1500;
const FOCUS_STEP = 110;
let focusRun = 0;

/** A landing highlight: holds, then steps down through lighter tints and clears. Returns false when it cannot be painted. */
export function focusRanges(ranges: Range[]): boolean {
  if (!ranges.length || !highlightsSupported()) return false;
  const run = ++focusRun;
  const names = [FOCUS, ...FADE];
  const paint = (index: number) => {
    if (run !== focusRun) return;
    for (const name of names) CSS.highlights.delete(name);
    const name = names[index];
    if (!name) return;
    CSS.highlights.set(name, new Highlight(...ranges));
    setTimeout(() => paint(index + 1), index ? FOCUS_STEP : FOCUS_HOLD);
  };
  paint(0);
  return true;
}

/** Search hits while reading from a search result: every hit softly, the opened message's hits strongly. */
export function setSearchMarks(soft: Range[], strong: Range[]) {
  if (!highlightsSupported()) return;
  const softHighlight = new Highlight(...soft); softHighlight.priority = 0;
  const strongHighlight = new Highlight(...strong); strongHighlight.priority = 1;
  CSS.highlights.set('palside-search', softHighlight);
  CSS.highlights.set('palside-search-current', strongHighlight);
}

export function clearSearchMarks() { if (!highlightsSupported()) return; CSS.highlights.delete('palside-search'); CSS.highlights.delete('palside-search-current'); }
