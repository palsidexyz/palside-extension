import { readSignalElementTarget,signalIdentityUrl,signalPrivateIdentity,type SignalElementTarget,type SignalTarget } from '../runtime/annotations/signals.ts';
import { privateSelector } from './adapters.ts';
import { readable } from './targets.ts';
import { normalizeQuoteWhitespace,quoteContext } from './text.ts';

const elementPrivateSelector = privateSelector.split(',').filter(selector => selector !== 'canvas').join(',');
/** Canvas pixels are never read; only an explicitly identifiable public canvas is eligible. */
function publicElement(element: Element | null, requireBox = true): element is Element {
  if (!element || element.closest(elementPrivateSelector)) return false;
  let depth = 0;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (++depth > 64) return false;
    if (['id', 'class', 'aria-label', 'data-testid'].some(key => signalPrivateIdentity.test((node!.getAttribute(key) ?? '').replace(/([a-z])([A-Z])/g, '$1-$2')))) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  const rect = element.getBoundingClientRect();
  return !requireBox || rect.width > 0 && rect.height > 0;
}
function publicText(root: Element): string | undefined {
  let node: Node | null = root, text = '', count = 0;
  while (node) {
    if (++count > 80) return;
    const owner = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!publicElement(owner) || owner.tagName.toLowerCase() === 'canvas') return;
    if (node.nodeType === Node.TEXT_NODE) {
      const part = node as Text;
      if (text.length + part.length > 240) return;
      text += part.substringData(0, part.length);
    }
    if (node.firstChild) { node = node.firstChild; continue; }
    while (node !== root && !node.nextSibling) node = node.parentNode!;
    if (node === root) break;
    node = node.nextSibling;
  }
  return normalizeQuoteWhitespace(text).trim() || undefined;
}
function identity(element: Element, x = 0.5, y = 0.5): SignalElementTarget | undefined {
  if (!publicElement(element)) return;
  const tag = element.tagName.toLowerCase();
  const raw: SignalElementTarget = { kind: 'element', tag, x, y };
  const id = element.getAttribute('id');
  if (id && /^[a-zA-Z][a-zA-Z0-9_:.-]{0,127}$/.test(id) && !/\d{5,}|[a-f0-9]{12,}/i.test(id)) raw.id = id;
  const role = element.getAttribute('role');
  if (role) raw.role = role;
  const label = element.getAttribute('aria-label') || (tag === 'img' ? element.getAttribute('alt') : null);
  if (label) raw.label = normalizeQuoteWhitespace(label).trim();
  for (const key of ['href', 'src'] as const) {
    const attribute = element.getAttribute(key);
    if (!attribute) continue;
    let url: string | undefined;
    try { url = signalIdentityUrl(new URL(attribute, document.baseURI).href); } catch { return; }
    if (!url) return;
    raw[key] = url;
  }
  // Text strengthens container identity; media identity never reads fallback/pixel content.
  if (!['img', 'picture', 'svg', 'video', 'canvas'].includes(tag)) raw.text = publicText(element);
  return readSignalElementTarget(raw);
}
/** Capture a point relative to identifiable content, never relative to the viewport. */
export function captureSignalTarget(x: number, y: number): SignalTarget {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: 'page' };
  try {
    const hit = document.elementFromPoint(x, y);
    if (!publicElement(hit)) return { kind: 'page' };
    // Prefer exact text when available; padding/media use an element identity.
    const quote = captureQuoteTarget(x, y);
    if (quote.kind === 'quote') return quote;
    let element: Element | null = hit;
    for (let depth = 0; element && depth < 6; depth += 1, element = element.parentElement) {
      if (['body', 'html'].includes(element.tagName.toLowerCase()) || !publicElement(element)) break;
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const target = identity(element, (x - rect.left) / rect.width, (y - rect.top) / rect.height);
      if (target) return target;
      // Unidentified media must not borrow a broad ancestor's identity.
      if (['canvas', 'img', 'video', 'svg', 'picture'].includes(element.tagName.toLowerCase())) break;
    }
  } catch { /* Unavailable DOM is an unlocated signal. */ }
  return { kind: 'page' };
}

/** The caret APIs do not touch the user's Selection. Reject nearest-caret guesses in empty space. */
function captureQuoteTarget(x: number, y: number): SignalTarget {
  const page: SignalTarget = { kind: 'page' };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return page;
  try {
    const hit = document.elementFromPoint(x, y);
    if (!readable(hit) || hit.closest('img,svg,video,audio,picture')) return page;
    const caretDocument = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = caretDocument.caretPositionFromPoint?.(x, y);
    const caret = position ? undefined : caretDocument.caretRangeFromPoint?.(x, y);
    const node = position?.offsetNode ?? caret?.startContainer;
    const offset = position?.offset ?? caret?.startOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE || offset === undefined || !hit.contains(node) || !readable(node.parentElement)) return page;
    const text = node as Text;
    let character = -1;
    for (const index of [offset, offset - 1]) {
      if (index < 0 || index >= text.length) continue;
      const range = document.createRange();
      range.setStart(text, index); range.setEnd(text, index + 1);
      if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
        character = index; break;
      }
    }
    if (character < 0) return page;
    // Read only a small local window, never a container's unfiltered textContent.
    const base = Math.max(0, character - 96);
    const source = text.substringData(base, 256);
    const index = character - base;
    const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source)];
    const selected = words.findIndex(part => part.isWordLike && index >= part.index && index < part.index + part.segment.length);
    if (selected < 0) return page;
    let first = selected, last = selected;
    // A few neighbouring words give short words and CJK characters meaningful context.
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
    // A cut-off word at the window boundary is not reliable evidence.
    if (end - start > 64 || start === 0 && base > 0 || end === source.length && base + source.length < text.length) return page;
    return quoteContext(source, start, end) ?? page;
  } catch { return page; }
}

// One uninterrupted slice lets typical pages finish before live updates can invalidate the scan.
const SCAN_SLICE_MS = 32;
type ResolveOptions = { signal?: AbortSignal; budgetMs?: number };
/** Complete bounded scan proves uniqueness. Paths/selectors never substitute for identity. */
export async function resolveSignalElement(value: SignalTarget, options: ResolveOptions = {}): Promise<Element | undefined> {
  const target = readSignalElementTarget(value);
  const root = document.body, budget = Math.min(options.budgetMs ?? 150, 1000);
  if (!target || !root || options.signal?.aborted || !Number.isFinite(budget) || budget <= 0) return;
  const started = performance.now();
  let slice = started, visited = 0, changed = false;
  let found: Element | undefined;
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { changed = true; });
  observer?.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  const expired = () => options.signal?.aborted || changed || performance.now() - started >= budget;
  const matches = (element: Element) => {
    if (element.tagName.toLowerCase() !== target.tag) return false;
    const candidate = identity(element);
    return candidate !== undefined && (['id', 'role', 'label', 'text', 'href', 'src'] as const).every(key => target[key] === undefined || candidate[key] === target[key]);
  };
  try {
    let node: Node | null = root;
    while (node) {
      if (++visited > 12_000 || expired()) return;
      if (performance.now() - slice >= SCAN_SLICE_MS) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (expired()) return;
        slice = performance.now();
      }
      const allowed = node.nodeType === 1 && publicElement(node as Element, false);
      if (allowed && matches(node as Element)) {
        if (found) return;
        found = node as Element;
      }
      if (allowed && node.firstChild) { node = node.firstChild; continue; }
      while (node !== root && !node.nextSibling) node = node.parentNode!;
      if (node === root) break;
      node = node.nextSibling;
    }
    if (expired() || observer?.takeRecords().length || !found?.isConnected || !matches(found)) return;
    return found;
  } catch { return undefined; }
  finally { observer?.disconnect(); }
}

type Point = { node: Text; offset: number };
type Character = Point & { character: string };

/** Yield traversal work as well as characters, so even a page with no text stays interruptible. */
function* characters(root: Element): Generator<Character | 'gap' | undefined> {
  let node: Node | null = root;
  while (node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node.nodeType === 1 ? node as Element : null;
    const allowed = element !== null && readable(element);
    yield allowed ? undefined : 'gap';
    if (allowed && node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      for (let start = 0; start < text.length; start += 256) {
        const chunk = text.substringData(start, 256);
        for (let offset = 0; offset < chunk.length; offset += 1) yield { node: text, offset: start + offset, character: chunk[offset]! };
      }
    }
    if (allowed && node.firstChild) { node = node.firstChild; continue; }
    while (node !== root && !node.nextSibling) { node = node.parentNode!; yield undefined; }
    if (node === root) return;
    node = node.nextSibling;
  }
}

/** Exhaust the public text stream to prove uniqueness; partial scans never produce a result. */
export async function resolveSignalTarget(target: SignalTarget, options: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<Range | undefined> {
  if (target.kind !== 'quote' || options.signal?.aborted || !document.body) return;
  const budget = options.budgetMs ?? 150;
  if (!Number.isFinite(budget) || budget <= 0) return;
  const started = performance.now();
  let slice = started;
  const exact = normalizeQuoteWhitespace(target.exact);
  const prefix = normalizeQuoteWhitespace(target.prefix);
  const suffix = normalizeQuoteWhitespace(target.suffix);
  if (!exact.trim() || exact.length > 400 || prefix.length > 48 || suffix.length > 48) return;
  const query = prefix + exact + suffix;
  let buffer = '';
  const points: { start: Point; end: Point }[] = [];
  let whitespace: { start: Point; end: Point } | undefined;
  let found: Range | undefined, ambiguous = false, changed = false;
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { changed = true; });
  observer?.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  const expired = () => options.signal?.aborted || changed || performance.now() - started >= budget;
  const append = (character: string, start: Point, end = start) => {
    buffer = (buffer + character).slice(-query.length);
    points.push({ start, end });
    if (points.length > query.length) points.shift();
    if (buffer !== query) return;
    if (found) { ambiguous = true; return; }
    const head = points[prefix.length]!.start, tail = points[prefix.length + exact.length - 1]!.end;
    const range = document.createRange();
    range.setStart(head.node, head.offset); range.setEnd(tail.node, tail.offset + 1);
    if (normalizeQuoteWhitespace(range.toString()) === exact) found = range;
  };
  try {
    for (const point of characters(document.body)) {
      if (expired()) return;
      if (performance.now() - slice >= SCAN_SLICE_MS) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (expired()) return;
        slice = performance.now();
      }
      if (point === undefined) continue;
      if (point === 'gap') {
        if (whitespace) append(' ', whitespace.start, whitespace.end);
        buffer = ''; points.length = 0; whitespace = undefined;
      } else if (/\s/u.test(point.character)) {
        if (whitespace) whitespace.end = point;
        else whitespace = { start: point, end: point };
      } else {
        if (whitespace) { append(' ', whitespace.start, whitespace.end); whitespace = undefined; }
        append(point.character, point);
      }
      if (ambiguous) return;
    }
    if (whitespace) append(' ', whitespace.start, whitespace.end);
    if (expired() || ambiguous || observer?.takeRecords().length || !found) return;
    if (!found.startContainer.isConnected || !found.endContainer.isConnected || !readable(found.startContainer.parentElement) || !readable(found.endContainer.parentElement)) return;
    return normalizeQuoteWhitespace(found.toString()) === exact ? found : undefined;
  } catch { return undefined; }
  finally { observer?.disconnect(); }
}
