import { identifyPage,normalizeAddress,shortAddress,type PageIdentity } from '@palside/shared/navigation';
import type { SiteProfile } from '@palside/shared/sites';

export type TokenIdentity = Extract<PageIdentity, { kind: 'asset' }>;
export type TokenPageContext = { tabId: number; windowId: number };
export type TokenPageMetadata = { name?: string; logo?: string };
export type TokenPageRequest = { identity: TokenIdentity; context: TokenPageContext; accountId: string; teamId: string; purpose: 'viewing' | 'share' };
export type TokenPageReader = (request: TokenPageRequest) => Promise<TokenPageMetadata | undefined>;

/** Validates a name already bound to a full contract, never a raw tab title. */
export function tokenName(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 64 || !/[\p{L}\p{N}]/u.test(name) || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>↑↓▲▼↗↘⬆⬇]/u.test(name)) return;
  if (/^(?:[$€£¥]\s*)?[+-]?[\d,.]+\s*(?:%|[KMBT])?$/iu.test(name)) return;
  return name;
}

/** Only contract-bound metadata may improve an asset's display; unknown names stay identifiable by address. */
export function resolveTokenMetadata(identity: Pick<TokenIdentity, 'address'>, confirmed?: TokenPageMetadata): TokenPageMetadata {
  return { name: tokenName(confirmed?.name) ?? shortAddress(identity.address), ...(confirmed?.logo ? { logo: confirmed.logo } : {}) };
}

/** Metadata may supplement an already identified contract; it cannot choose a network or map a pool. */
export function matchesTokenPage(url: string, identity: TokenIdentity) {
  const source = identifyPage(url, [identity.host]);
  return source && source.kind !== 'website' && source.url === identity.url && source.chain === identity.chain &&
    source.kind === 'asset' && normalizeAddress(identity.chain, identity.address) === identity.address && source.address === identity.address;
}

/**
 * Injected once into the main frame's ISOLATED world under the granted host permission.
 * Self-contained: no imports/closures, fetch, storage, page variables, forms, request interception,
 * observers or listeners. Reads only a token heading next to an exact contract link and its image.
 * Image export uses already decoded pixels; otherwise return the public source for central URL validation.
 * `profile` is the site's registry entry, passed as plain data because injected code cannot import it.
 */
export function readVisibleToken(input: { href: string; host: string; address: string; chain: string }, profile: SiteProfile | null | undefined): TokenPageMetadata | undefined {
  if (window.top !== window || document.visibilityState !== 'visible' || location.href !== input.href || location.hostname !== input.host) return;
  // Pool pages are source fallbacks. Only token pages with a registry profile can opt into the
  // temporary, contract-bound metadata read.
  if (!profile) return;
  const solana = input.chain === 'Solana';
  if (!(solana ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[a-fA-F0-9]{40}$/).test(input.address)) return;
  const same = (value: string) => solana ? value === input.address : value.toLowerCase() === input.address.toLowerCase();
  const safeName = (value: string | null | undefined) => {
    const name = value?.trim();
    return name && name.length <= 64 && /[\p{L}\p{N}]/u.test(name) && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>↑↓▲▼↗↘⬆⬇]/u.test(name) && !/^(?:[$€£¥]\s*)?[+-]?[\d,.]+\s*(?:%|[KMBT])?$/iu.test(name) ? name : undefined;
  };
  // Known title formats contain a public token symbol. Never return the raw title.
  let titleName: string | undefined;
  const title = profile.title;
  if (title && new RegExp(title.match, title.flags).test(document.title)) {
    const symbol = document.title.match(new RegExp(title.name))?.[1];
    titleName = safeName(title.strip ? symbol?.replace(new RegExp(title.strip, 'gu'), '') : symbol);
  }
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[aria-hidden="true"]');
  };
  const candidates: { name: string; image?: HTMLImageElement }[] = [];
  const links = document.querySelectorAll<HTMLAnchorElement>(`a[href*="${input.address}"${solana ? '' : ' i'}]`);
  for (const link of [...links].slice(0, 20)) {
    if (!visible(link)) continue;
    let destination: URL; try { destination = new URL(link.href); } catch { continue; }
    if (destination.protocol !== 'https:' || destination.username || destination.password) continue;
    const addressParts = [...destination.pathname.split('/'), ...destination.hash.slice(1).split(/[/?&#=]/), ...destination.searchParams.values()];
    // FOMO's public header links to an X search containing the full contract OR the symbol.
    if (destination.hostname === 'x.com' && destination.pathname === '/search') addressParts.push(...(destination.searchParams.get('q') ?? '').split(/\s+OR\s+/));
    if (!addressParts.some(same)) continue;
    let root = link.parentElement;
    for (let depth = 0; root && depth < 5; depth++, root = root.parentElement) {
      if (root === document.body || root === document.documentElement || root.querySelectorAll('*').length > 140) break;
      const headings = [...root.querySelectorAll<HTMLElement>('h1,h2,[data-testid="token-name"],[data-testid="token-symbol"]')].filter(visible);
      const headingNames = [...new Set(headings.map(heading => safeName(heading.textContent)).filter((name): name is string => Boolean(name)))];
      const name = titleName ? headingNames.includes(titleName) ? titleName : undefined : headingNames.length === 1 ? headingNames[0] : undefined;
      // GMGN/FOMO sometimes render the symbol as a small inline label instead of a heading.
      // Compare only short leaf labels within this contract header, never its aggregate text.
      const inlineName = titleName && [...root.querySelectorAll(profile.inline)].some(element => !element.childElementCount && visible(element) && element.textContent?.trim() === titleName) ? titleName : undefined;
      const confirmed = name ?? inlineName; if (!confirmed) continue;
      const images = [...root.querySelectorAll<HTMLImageElement>('img')].filter(image => {
        if (!visible(image) || !image.complete || !image.naturalWidth || image.naturalWidth > 2048 || image.naturalHeight > 2048) return false;
        const rect = image.getBoundingClientRect();
        if (rect.width < 24 || rect.width > 96 || Math.abs(rect.width - rect.height) > 2) return false;
        try {
          const url = new URL(image.currentSrc || image.src);
          if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
          return profile.images.some(rule => url.hostname === rule.host && url.pathname.startsWith(rule.path));
        } catch { return false; }
      });
      candidates.push({ name: confirmed, image: images.length === 1 ? images[0] : undefined });
      if (images.length) break;
    }
  }
  if (location.href !== input.href || !candidates.length || new Set(candidates.map(candidate => candidate.name)).size !== 1) return;
  const result: TokenPageMetadata = { name: candidates[0]!.name };
  const images = [...new Set(candidates.map(candidate => candidate.image).filter((image): image is HTMLImageElement => Boolean(image)))];
  if (images.length === 1) {
    result.logo = images[0]!.currentSrc || images[0]!.src;
    try {
      const image = images[0]!; const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
      const context = canvas.getContext('2d'); if (!context) return result;
      const scale = Math.min(48 / image.naturalWidth, 48 / image.naturalHeight);
      context.drawImage(image, (48 - image.naturalWidth * scale) / 2, (48 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      const png = canvas.toDataURL('image/png'); if (png.length <= 10_690) result.logo = png;
    } catch { /* Display the public image URL without exporting pixels or requesting host permissions. */ }
  }
  return location.href === input.href && document.visibilityState === 'visible' ? result : undefined;
}
