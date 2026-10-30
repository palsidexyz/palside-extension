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

/** Format an address with its first six and last four characters. */
export function abbreviate(address: string) {
  const plain = address.replace(/\.\.\./g, '…');
  if (plain.includes('…')) {
    return `${plain.split('…')[0]!.slice(0, 6)}…${plain.split('…').at(-1)!.slice(-4)}`;
  }
  return plain.length > 10 ? `${plain.slice(0, 6)}…${plain.slice(-4)}` : plain;
}

/** Match abbreviated addresses; full addresses remain exact, and Solana is case-sensitive. */
export function sameAddress(a: string, b: string) {
  const normalize = (value: string) => /^0x/i.test(value)
    ? value.toLowerCase().replace(/\.\.\./g, '…')
    : value.replace(/\.\.\./g, '…');
  const x = normalize(a);
  const y = normalize(b);
  if (!x.includes('…') && !y.includes('…')) return x === y;
  const valid = (value: string) => !value.includes('…') || /^[^…]{6,}…[^…]{4,}$/.test(value);
  return valid(x) && valid(y) && x.slice(0, 6) === y.slice(0, 6) && x.slice(-4) === y.slice(-4);
}

/** Build a compact reference caption using only target data. */
export function caption(target: RefTarget) {
  if (target.kind === 'address') return clip(abbreviate(target.text));
  return `“${clip(target.exact.replace(/\s+/g, ' '), 31)}”`;
}

/** Offsets are UTF-16 offsets; context limits count Unicode characters. */
export function quoteContext(text: string, start: number, end: number): Extract<RefTarget, { kind: 'quote' }> | undefined {
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
