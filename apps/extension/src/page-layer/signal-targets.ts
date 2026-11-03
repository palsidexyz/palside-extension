import { readSignalTarget,signalIdentityUrl,SIGNAL_ANCHORS,SIGNAL_MATCHES,type SignalAnchor,type SignalElementAnchor,type SignalQuoteAnchor,type SignalTarget } from '../runtime/annotations/signals.ts';
import { adapterFor,genericChart,privateSelector } from './adapters.ts';
import { readable } from './targets.ts';
import { quoteContext } from './text.ts';

/**
 * Signal anchors: what a press points at, written so another member's page can find it again.
 *
 * The sender records up to four anchors, nearest first: the words under the pointer, up to three elements around
 * them, and the chart. The receiver uses the first one it finds, so the signal lands on the words, else the block
 * around them, else the chart, else the page edge. An element taller than half the viewport or larger than a quarter
 * of it is never an anchor: falling back to it would land too far from the press.
 *
 * Text compares with whitespace collapsed. A receiver first looks for an exact match; failing that, a loose match
 * (`textKey`: every digit read as 0) counts only when it is the only one. A ticking price still matches while rows
 * that differ only in their numbers stay distinct. Each capture or resolve walks the page once, in one task and
 * within fixed caps, so the page cannot change under it.
 */

const MAX_NODES = 20_000;
const MAX_TEXT = 400_000;
const ELEMENT_ANCHORS = 3;
const NAME_TEXT = 80;
const MEDIA = ['img', 'picture', 'svg', 'video'];

export const textKey = (text: string) => text.replace(/\s+/gu, ' ').replace(/\d/gu, '0');

/** Own visibility only; walks start at the root and never enter a hidden or private subtree. */
function shown(element: Element) {
  if (element.matches(privateSelector)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0' && style.contentVisibility !== 'hidden';
}
/** The element and all its ancestors are public and visible. */
function publicElement(element: Element | null): element is Element {
  if (!element || element.closest(privateSelector)) return false;
  for (let node: Element | null = element, depth = 0; node; node = node.parentElement) if (++depth > 64 || !shown(node)) return false;
  return true;
}

type Point = { node: Text; offset: number };
/** `text` has whitespace collapsed; `loose` is the same run through `textKey`, position for position. */
type Run = { text: string; loose?: string; at: Point[] };
/** The page's public elements in document order, and its public text as `textKey` runs mapped back to positions. */
type Snapshot = { elements: Element[]; runs: Run[] };
let current: { snapshot?: Snapshot | null } | undefined;
/** Runs `work` against one walk of the page, taken on first use. */
function scanning<T>(work: () => T): T {
  current = {};
  try { return work(); } finally { current = undefined; }
}
function snapshot(): Snapshot | undefined {
  if (current?.snapshot !== undefined) return current.snapshot ?? undefined;
  const taken = walk();
  if (current) current.snapshot = taken ?? null;
  return taken;
}
/** A private or hidden subtree ends a text run, so no match spans it. Undefined past the caps. */
function walk(): Snapshot | undefined {
  const root = document.body;
  if (!root) return;
  const elements: Element[] = [], runs: Run[] = [];
  let text = '', at: Point[] = [], total = 0, space: Point | undefined;
  const end = () => { if (text) runs.push({ text, at }); text = ''; at = []; space = undefined; };
  let node: Node | null = root.firstChild, visited = 0;
  while (node) {
    if (++visited > MAX_NODES) return;
    const element = node.nodeType === 1 ? node as Element : undefined;
    const allowed = node.nodeType === Node.TEXT_NODE || Boolean(element && shown(element));
    if (element && allowed) elements.push(element);
    if (!allowed) end();
    else if (node.nodeType === Node.TEXT_NODE) {
      const part = node as Text;
      for (let start = 0; start < part.length; start += 256) {
        const chunk = part.substringData(start, 256);
        for (let i = 0; i < chunk.length; i += 1) {
          const point = { node: part, offset: start + i }, character = chunk[i]!;
          if (/\s/u.test(character)) { space ??= point; continue; }
          if (space && text) { text += ' '; at.push(space); }
          space = undefined;
          text += character; at.push(point);
          if (++total > MAX_TEXT) return;
        }
      }
    }
    if (element && allowed && node.firstChild) { node = node.firstChild; continue; }
    while (node && node !== root && !node.nextSibling) node = node.parentNode;
    if (!node || node === root) break;
    node = node.nextSibling;
  }
  end();
  return { elements, runs };
}

/** An element's own public text when it is short enough to be a name, like a button's or a table cell's; undefined
 * when any of it is hidden or private, or it reads as content rather than a name (quotes cover that). */
function ownText(root: Element): string | undefined {
  let node: Node | null = root, text = '', count = 0;
  while (node) {
    if (++count > 80) return;
    if (node.nodeType === 1 && node !== root && !shown(node as Element)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const part = node as Text;
      if (text.length + part.length > NAME_TEXT) return;
      text += part.substringData(0, part.length);
    }
    if (node.firstChild) { node = node.firstChild; continue; }
    while (node !== root && !node.nextSibling) node = node.parentNode!;
    if (node === root) break;
    node = node.nextSibling;
  }
  return text.replace(/\s+/gu, ' ').trim() || undefined;
}
type Identity = Omit<SignalElementAnchor, 'nth' | 'of' | 'x' | 'y'>;
/** As in ARIA, a section, article or form without a label is named by its heading, caption or legend. */
const SECTIONS = ['section', 'article', 'aside', 'nav', 'main', 'form', 'fieldset', 'figure', 'table'];
function heading(element: Element, tag: string): string | undefined {
  if (!SECTIONS.includes(tag)) return;
  const title = element.querySelector?.('h1,h2,h3,h4,h5,h6,caption,legend,figcaption');
  return title && publicElement(title) ? ownText(title) : undefined;
}
/** What a person sees an element as: id, role, label, link or image, else its short text. Never a DOM path. */
function identity(element: Element): Identity | undefined {
  const tag = element.tagName.toLowerCase();
  const result: Identity = { kind: 'element', tag };
  const id = element.getAttribute('id');
  // Generated ids differ between page loads and members.
  if (id && /^[a-zA-Z][a-zA-Z0-9_:.-]{0,127}$/.test(id) && !/\d{5,}|[a-f0-9]{12,}/i.test(id)) result.id = id;
  const role = element.getAttribute('role');
  if (role && /^[a-z]+$/.test(role)) result.role = role;
  const label = element.getAttribute('aria-label') || (tag === 'img' ? element.getAttribute('alt') : null) || heading(element, tag);
  if (label?.trim()) result.label = label.replace(/\s+/gu, ' ').trim().slice(0, 160);
  for (const key of ['href', 'src'] as const) {
    const attribute = element.getAttribute(key);
    if (!attribute) continue;
    let url: string | undefined;
    try { url = signalIdentityUrl(new URL(attribute, document.baseURI).href); } catch { return; }
    if (!url) return;
    result[key] = url;
  }
  // Text names an element only when nothing steadier does, so a labelled block keeps its anchor while its contents
  // change; the class list only when there is no text either. Media identity never reads fallback content.
  const named = Boolean(result.id || result.label || result.href || result.src);
  const text = named || MEDIA.includes(tag) ? undefined : ownText(element);
  if (text) result.text = text;
  if (!named && !text) {
    let cls = '';
    for (const name of [...element.classList ?? []].filter(name => /^[\w-]{1,48}$/.test(name)).sort()) if (cls.length + name.length < 160) cls += (cls ? ' ' : '') + name;
    if (cls) result.cls = cls;
  }
  return named || result.text || result.cls ? result : undefined;
}
const flat = (text: string, loose: boolean) => loose ? textKey(text) : text.replace(/\s+/gu, ' ');
const sameText = (a: string | undefined, b: string | undefined, loose: boolean) => a === undefined ? b === undefined : b !== undefined && flat(a, loose) === flat(b, loose);
const same = (a: Identity, b: Identity, loose: boolean) => a.tag === b.tag && a.id === b.id && a.role === b.role && a.cls === b.cls && a.href === b.href && a.src === b.src && sameText(a.label, b.label, loose) && sameText(a.text, b.text, loose);
/** Public elements with this identity, in document order; undefined when the page is too large to tell. */
function findElements(want: Identity, loose = false): Element[] | undefined {
  const page = snapshot();
  if (!page) return;
  const out: Element[] = [];
  for (const element of page.elements) {
    if (element.tagName.toLowerCase() !== want.tag) continue;
    const found = identity(element);
    if (found && same(found, want, loose) && out.push(element) > SIGNAL_MATCHES) break;
  }
  return out;
}
type QuoteMatch = { start: Point; end: Point };
/** Every place the quote reads the same with its context; undefined when the page is too large to tell. */
function findQuotes(quote: Pick<SignalQuoteAnchor, 'exact' | 'prefix' | 'suffix'>, loose = false): QuoteMatch[] | undefined {
  const exact = flat(quote.exact, loose).trim(), prefix = flat(quote.prefix, loose).trimStart(), suffix = flat(quote.suffix, loose).trimEnd();
  const page = exact ? snapshot() : undefined;
  if (!page) return;
  const query = prefix + exact + suffix, out: QuoteMatch[] = [];
  for (const run of page.runs) {
    const text = loose ? run.loose ??= textKey(run.text) : run.text;
    for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + 1)) {
      const head = index + prefix.length;
      out.push({ start: run.at[head]!, end: run.at[head + exact.length - 1]! });
      if (out.length > SIGNAL_MATCHES) return out;
    }
  }
  return out;
}
function rangeOf(match: QuoteMatch) {
  const range = document.createRange();
  range.setStart(match.start.node, match.start.offset); range.setEnd(match.end.node, match.end.offset + 1);
  return range;
}
const chartAt = () => (adapterFor().chart ?? genericChart)();
const inside = (rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }, x: number, y: number) =>
  rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
const unit = (value: number) => Math.max(0, Math.min(1, value));
/** An anchor goes on the wire only when it reads back as itself. */
const valid = (anchor: SignalAnchor) => readSignalTarget({ kind: 'spot', anchors: [anchor] }) !== undefined;

/** The words under a point, without touching the user's Selection. Empty space next to text is not a word. */
function wordsAt(x: number, y: number) {
  const hit = document.elementFromPoint(x, y);
  if (!readable(hit) || hit.closest('img,svg,video,audio,picture')) return;
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  const caret = position ? undefined : caretDocument.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? caret?.startContainer;
  const offset = position?.offset ?? caret?.startOffset;
  if (!node || node.nodeType !== Node.TEXT_NODE || offset === undefined || !hit.contains(node) || !readable(node.parentElement)) return;
  const text = node as Text;
  let character = -1;
  for (const index of [offset, offset - 1]) {
    if (index < 0 || index >= text.length) continue;
    const range = document.createRange();
    range.setStart(text, index); range.setEnd(text, index + 1);
    if ([...range.getClientRects()].some(rect => inside(rect, x, y))) { character = index; break; }
  }
  if (character < 0) return;
  // Read only a small local window, never a container's whole text.
  const base = Math.max(0, character - 96);
  const source = text.substringData(base, 256);
  const index = character - base;
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source)];
  const selected = words.findIndex(part => part.isWordLike && index >= part.index && index < part.index + part.segment.length);
  if (selected < 0) return;
  let first = selected, last = selected;
  // A few neighbouring words give short words and CJK characters some context.
  for (let step = 0; step < 4; step += 1) {
    const next = step % 2 === 0 ? last + 1 : first - 1;
    const part = words[next];
    if (!part || /[\n\r.!?。！？]/u.test(part.segment)) continue;
    const start = Math.min(first, next), end = Math.max(last, next);
    if (words[end]!.index + words[end]!.segment.length - words[start]!.index > 64) continue;
    first = start; last = end;
  }
  let start = words[first]!.index, end = words[last]!.index + words[last]!.segment.length;
  while (start < end && /\s/u.test(source[start]!)) start += 1;
  while (end > start && /\s/u.test(source[end - 1]!)) end -= 1;
  const quote = quoteContext(source, start, end);
  return quote ? { quote, node: text, offset: base + start } : undefined;
}

/**
 * The anchors for a press at a viewport point, nearest first. Each records which of its equal matches on this page
 * is the pressed one; an anchor that cannot tell is left out.
 */
export function captureSignalTarget(x: number, y: number): SignalTarget {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: 'page' };
  const anchors: SignalAnchor[] = [];
  try {
    scanning(() => {
      const hit = document.elementFromPoint(x, y);
      if (publicElement(hit)) {
        const words = wordsAt(x, y);
        const quotes = words && findQuotes(words.quote);
        const nth = quotes?.findIndex(match => match.start.node === words!.node && match.start.offset === words!.offset) ?? -1;
        if (words && quotes && nth >= 0 && quotes.length <= SIGNAL_MATCHES) anchors.push({ ...words.quote, nth, of: quotes.length });
        let elements = 0;
        for (let element: Element | null = hit, depth = 0; element && depth < 8 && elements < ELEMENT_ANCHORS; element = element.parentElement, depth += 1) {
          const tag = element.tagName.toLowerCase();
          if (tag === 'body' || tag === 'html') break;
          const rect = element.getBoundingClientRect();
          if (!inside(rect, x, y)) continue;
          // Larger ancestors only get larger; past this a fallback would land too far away.
          if (rect.height > innerHeight / 2 || rect.width * rect.height > innerWidth * innerHeight / 4) break;
          const id = identity(element);
          const matches = id && findElements(id);
          const index = matches?.indexOf(element) ?? -1;
          const anchor: SignalAnchor | undefined = id && matches && index >= 0 && matches.length <= SIGNAL_MATCHES
            ? { ...id, nth: index, of: matches.length, x: unit((x - rect.left) / rect.width), y: unit((y - rect.top) / rect.height) } : undefined;
          if (anchor && valid(anchor)) { anchors.push(anchor); elements += 1; }
          // Unidentified media must not borrow a broad ancestor's identity.
          else if (MEDIA.includes(tag)) break;
        }
      }
      const box = chartAt()?.getBoundingClientRect();
      if (box && inside(box, x, y)) anchors.push({ kind: 'chart', x: unit((x - box.left) / box.width), y: unit((y - box.top) / box.height) });
    });
  } catch { /* An unreadable page is an unlocated signal. */ }
  // The chart, when pressed, keeps its place as the last fallback.
  const chart = anchors.filter(anchor => anchor.kind === 'chart'), rest = anchors.filter(anchor => anchor.kind !== 'chart' && valid(anchor));
  const kept = [...rest.slice(0, SIGNAL_ANCHORS - chart.length), ...chart];
  return kept.length ? { kind: 'spot', anchors: kept } : { kind: 'page' };
}

/** Where a signal sits on this page: a box to measure, the point inside it, and which anchor found it (0 = nearest). */
export type SignalSpot = { box: Element | Range; x: number; y: number; level: number };

/**
 * The first anchor this page can find: exact matches, told apart by order only when there are exactly as many as
 * the sender saw; else a loose match when it is the only one.
 */
export function resolveSignalSpot(target: SignalTarget): SignalSpot | undefined {
  if (target.kind !== 'spot') return;
  try {
    return scanning(() => {
      for (const [level, anchor] of target.anchors.entries()) {
        if (anchor.kind === 'chart') {
          const chart = chartAt();
          if (chart) return { box: chart, x: anchor.x, y: anchor.y, level };
        } else if (anchor.kind === 'quote') {
          const exact = findQuotes(anchor), loose = exact?.length === anchor.of ? undefined : findQuotes(anchor, true);
          const match = exact?.length === anchor.of ? exact[anchor.nth] : loose?.length === 1 ? loose[0] : undefined;
          if (match) return { box: rangeOf(match), x: 0.5, y: 0.5, level };
        } else {
          const { nth, of, x, y, ...want } = anchor;
          const exact = findElements(want), loose = exact?.length === of ? undefined : findElements(want, true);
          const match = exact?.length === of ? exact[nth] : loose?.length === 1 ? loose[0] : undefined;
          if (match) return { box: match, x, y, level };
        }
      }
      return undefined;
    });
  } catch { return undefined; }
}

/** A resolved spot stays usable while its nodes are attached and public. */
export function spotAlive(spot: SignalSpot) {
  if ('tagName' in spot.box) return spot.box.isConnected && publicElement(spot.box);
  const range = spot.box;
  return range.startContainer.isConnected && range.endContainer.isConnected && readable(range.startContainer.parentElement) && readable(range.endContainer.parentElement);
}
