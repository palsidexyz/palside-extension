import type { RefTarget } from '../runtime/browser/page-protocol';

const graphemes = (text: string) => Array.from(
  new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
  part => part.segment,
);

/** Limit a caption by graphemes, keeping composed emoji intact. */
export function clip(text: string, maximum = 40) {
  const parts = graphemes(text);
  return parts.length > maximum ? `${parts.slice(0, maximum - 1).join('')}…` : text;
}

/** Build a compact reference caption using only target data. */
export function caption(target: RefTarget) {
  return `“${clip(target.exact.replace(/\s+/g, ' '), 31)}”`;
}

/** Offsets are UTF-16 offsets; context limits count Unicode characters. */
export function quoteContext(text: string, start: number, end: number): RefTarget | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) return;
  const exact = text.slice(start, end);
  const count = Array.from(exact).length;
  if (count < 2 || count > 200 || !exact.trim()) return;
  return {
    kind: 'quote',
    exact,
    prefix: Array.from(text.slice(0, start)).slice(-24).join(''),
    suffix: Array.from(text.slice(end)).slice(0, 24).join(''),
  };
}

/** Preserve word and numeric separators while tolerating layout whitespace changes. */
export function normalizeQuoteWhitespace(text: string) { return text.replace(/\s+/gu, ' '); }

/** Fill the literal placeholders supplied by the background labels. */
export function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
}

/** A v4 UUID. `crypto.randomUUID` exists only in secure contexts, and the page layer also runs on plain http sites. */
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6]! & 0x0f | 0x40;
  bytes[8] = bytes[8]! & 0x3f | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
