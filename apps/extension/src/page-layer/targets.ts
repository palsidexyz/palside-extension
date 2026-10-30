import type { RefTarget } from '../runtime/browser/page-protocol';
import { isTradeElement } from './adapters.ts';
import { caption,sameAddress,quoteContext,normalizeQuoteWhitespace } from './text.ts';

export type Located = { el?: Element; range: Range };
export function readable(element: Element | null): element is Element {
  if (!element || isTradeElement(element)) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  const rect = element.getBoundingClientRect();
  return Boolean(rect.width && rect.height || getComputedStyle(element).display === 'contents');
}

export type SelectionResult = { item: { target: RefTarget; caption: string }; reason?: never } | { item?: never; reason: 'too-long' | 'unavailable' };

export function selectionTarget(range: Range): SelectionResult {
  const owner = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
  if (!owner || !readable(owner)) return { reason: 'unavailable' };
  const walker = document.createTreeWalker(owner, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!readable(element)) return { reason: 'unavailable' };
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : (node as Text).length;
    length += to - from;
    if (length > 400) return { reason: 'too-long' };
    parts.push((node as Text).data.slice(from, to));
  }
  const exact = parts.join('');
  if (Array.from(exact).length > 200) return { reason: 'too-long' };
  const prefix = range.startContainer.nodeType === Node.TEXT_NODE ? Array.from((range.startContainer as Text).data.slice(Math.max(0, range.startOffset - 48), range.startOffset)).slice(-24).join('') : '';
  const suffix = range.endContainer.nodeType === Node.TEXT_NODE ? Array.from((range.endContainer as Text).data.slice(range.endOffset, range.endOffset + 48)).slice(0, 24).join('') : '';
  const target = quoteContext(prefix + exact + suffix, prefix.length, prefix.length + exact.length);
  return target ? { item: { target, caption: caption(target) } } : { reason: 'unavailable' };
}

type TextPoint = { node: Text; offset: number; character: string };
type TextChunk = { node: Text; offset: number; text: string };
let textIndex: { document: Document; body: HTMLElement; url: string; chunks: (TextChunk | undefined)[]; observer: MutationObserver } | undefined;

export function invalidateTargets() {
  textIndex?.observer.disconnect();
  textIndex = undefined;
}

function outsideHost(records: MutationRecord[]) {
  return records.some(record => !(record.target.nodeType === 1 ? record.target as Element : record.target.parentElement)?.closest('palside-page-layer'));
}

function pageText() {
  if (textIndex && (textIndex.document !== document || textIndex.body !== document.body || textIndex.url !== location.href || outsideHost(textIndex.observer.takeRecords()))) invalidateTargets();
  if (textIndex) return textIndex.chunks;
  const chunks = [...pageChunks()];
  if (document.body) {
    const observer = new MutationObserver(records => { if (outsideHost(records)) invalidateTargets(); });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const index = { document, body: document.body, url: location.href, chunks, observer };
    textIndex = index;
    // Computed visibility can change without a mutation record, so the index serves only the current task.
    queueMicrotask(() => { if (textIndex === index) invalidateTargets(); });
  }
  return chunks;
}

function* pageCharacters(): Generator<TextPoint | undefined> {
  for (const chunk of pageText()) {
    if (!chunk) { yield undefined; continue; }
    for (let offset = 0; offset < chunk.text.length; offset += 1) yield { node: chunk.node, offset: chunk.offset + offset, character: chunk.text[offset]! };
  }
}

/** A rejected subtree breaks the match; text on either side must never be joined across private content. */
function* pageChunks(): Generator<TextChunk | undefined> {
  if (!document.body) return;
  let gaps = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
      if (!readable(element)) {
        gaps += 1;
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let previous = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (gaps !== previous) { yield undefined; previous = gaps; }
    // Range.toString and selectionTarget concatenate actual text nodes, including across blocks.
    // Layout boundaries must not invent separators; rejected subtrees above still break a match.
    for (let start = 0; start < node.length; start += 1024) {
      yield { node, offset: start, text: node.substringData(start, 1024) };
    }
  }
}

function pointRange(head: TextPoint, tail: TextPoint) {
  const range = document.createRange();
  range.setStart(head.node, head.offset);
  range.setEnd(tail.node, tail.offset + 1);
  return range;
}

function findQuote(target: Extract<RefTarget, { kind: 'quote' }>) {
  const query = { ...target, exact: normalizeQuoteWhitespace(target.exact), prefix: normalizeQuoteWhitespace(target.prefix), suffix: normalizeQuoteWhitespace(target.suffix) };
  if (!query.exact || query.exact.length > 400 || query.prefix.length > 48 || query.suffix.length > 48) return;
  const expected = query.prefix + query.exact + query.suffix;
  const size = expected.length;
  let buffer = '';
  const points: { start: TextPoint; end: TextPoint }[] = [];
  let found: Range | undefined, ambiguous = false;
  let whitespace: { start: TextPoint; end: TextPoint } | undefined;
  const append = (character: string, start: TextPoint, end = start) => {
    buffer = (buffer + character).slice(-size);
    points.push({ start, end });
    if (points.length > size) points.shift();
    if (buffer !== expected) return;
    const range = pointRange(points[query.prefix.length]!.start, points[query.prefix.length + query.exact.length - 1]!.end);
    // Positions alone are not evidence: never highlight a changed numeric/text value.
    if (normalizeQuoteWhitespace(range.toString()) !== query.exact) return;
    if (found) ambiguous = true;
    else found = range;
  };
  for (const point of pageCharacters()) {
    if (!point) {
      if (whitespace) append(' ', whitespace.start, whitespace.end);
      buffer = ''; points.length = 0; whitespace = undefined;
      continue;
    }
    if (/\s/u.test(point.character)) { if (whitespace) whitespace.end = point; else whitespace = { start: point, end: point }; continue; }
    if (whitespace) { append(' ', whitespace.start, whitespace.end); whitespace = undefined; }
    append(point.character, point);
    if (ambiguous) return;
  }
  if (whitespace) append(' ', whitespace.start, whitespace.end);
  return ambiguous ? undefined : found;
}

function findAddressRange(target: Extract<RefTarget, { kind: 'address' }>) {
  let points: TextPoint[] = [];
  let overflow = false;
  const match = () => {
    if (overflow || !points.length) return;
    const text = points.map(point => point.character).join('');
    const candidate = text.replace(/^\.+|\.+$/g, '');
    if (!candidate || !sameAddress(candidate, target.text)) return;
    const offset = text.indexOf(candidate);
    return pointRange(points[offset]!, points[offset + candidate.length - 1]!);
  };
  for (const point of pageCharacters()) {
    if (point && /[a-z0-9.…]/i.test(point.character)) {
      if (points.length < 128) points.push(point);
      else overflow = true;
    } else {
      const range = match();
      if (range) return range;
      points = [];
      overflow = false;
    }
  }
  return match();
}

export function locate(target: RefTarget): Located | undefined {
  if (target.kind === 'address') {
    const range = findAddressRange(target);
    return range ? { range, el: range.startContainer.parentElement ?? undefined } : undefined;
  }
  const range = findQuote(target);
  return range ? { range } : undefined;
}
