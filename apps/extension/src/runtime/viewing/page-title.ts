const separators = /\s(?:\||-|–|—|·)\s/u;
const boilerplate = /^(?:price|chart|charts|price chart|live price|价格|行情)$/iu;
const priceToken = /^(?:[$€£¥]\s?\d[\d,.]*(?:[KMBT])?|[+-]\s?\d[\d,.]*%|\d[\d,.]*%)$/iu;

function words(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function suffixMatches(suffix: string, host: string) {
  const suffixWords = words(suffix.replace(/\.[a-z]{2,}$/iu, ''));
  const hostName = host.replace(/^www\./iu, '').replace(/\.[a-z]{2,}$/iu, '');
  const hostWords = words(hostName);
  if (!suffixWords.length || !hostWords.length) return false;
  const suffixJoined = suffixWords.join('');
  const hostJoined = hostWords.join('');
  return suffixWords.join(' ') === hostWords.join(' ')
    || suffixJoined === hostJoined
    || suffixWords.every(word => hostWords.includes(word));
}

function trimPriceTokens(value: string) {
  const parts = value.split(/\s+/u).filter(Boolean);
  while (parts.length && priceToken.test(parts[0]!)) parts.shift();
  while (parts.length && priceToken.test(parts.at(-1)!)) parts.pop();
  return parts.join(' ');
}

/** Segments between title separators, without the ones naming the site itself. */
function segments(value: string, host: string) {
  return value.split(separators).map(part => part.trim()).filter(part => part && !suffixMatches(part, host));
}

function trimBoilerplate(value: string) {
  const parts = value.split(/\s+/u);
  while (parts.length > 1 && boilerplate.test(parts.at(-1)!)) parts.pop();
  return parts.join(' ');
}

/**
 * A webpage display title, not evidence of a token name: drops the site name, SEO tails and leading/trailing prices.
 * "PEPE $0.00001 | GMGN.AI" → "PEPE"; "Birdeye - BONK Price" → "BONK"; long single titles stay whole.
 */
export function pageName(title: unknown, host: string): string | undefined {
  if (typeof title !== 'string' || typeof host !== 'string') return undefined;
  const spaced = title.trim().replace(/\s+/gu, ' ');
  // "… / X": a slash only separates the site name at the very end.
  const slash = spaced.lastIndexOf(' / ');
  const clean = slash > 0 && suffixMatches(spaced.slice(slash + 3), host) ? spaced.slice(0, slash) : spaced;
  if (!clean) return undefined;
  const parts = segments(clean, host);
  if (!parts.length) return undefined;
  // A short first segment is the subject ("$CASHCAT +12%"); what follows is the site's tagline.
  let value = parts[0]!.length <= 32 || parts.length === 1 ? parts[0]! : parts.join(' · ');
  value = trimBoilerplate(trimPriceTokens(value)).trim();
  const hostName = host.replace(/^www\./iu, '').replace(/\.[a-z]{2,}$/iu, '');
  const titleName = value.replace(/^www\./iu, '').replace(/\.[a-z]{2,}$/iu, '');
  if (!value || words(titleName).join('') === words(hostName).join('')) return undefined;
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value));
  return graphemes.slice(0, 80).map(part => part.segment).join('').trim() || undefined;
}
