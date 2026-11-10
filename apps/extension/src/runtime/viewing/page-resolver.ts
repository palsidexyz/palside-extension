import { DAY_MS, SECOND_MS } from '@palside/shared/units';
import type { Network, PageIdentity } from '@palside/shared/navigation';
import type { TokenEntry, TokenResolution } from '@palside/shared/contracts/tokens';
import { networkTokenChain, tokenChainNetwork, type TokenChain } from '@palside/shared/tokens';
import { TOKEN_MISSING_RECHECK_MS } from '@palside/shared/rules/tokens';
import { assetKey } from '../../domain/annotations/interaction.ts';

/** A page whose token the server finds: a trading pool, or an EVM contract the URL gives no chain for. */
export type LookupPage = Extract<PageIdentity, { kind: 'pool' | 'address' }>;
type Item = { pool: string; chain: TokenChain } | { address: string };
/** Resolves to `undefined` when the directory cannot be asked now (signed out); nothing is remembered. */
export type PageLookup = (item: Item) => Promise<TokenResolution | undefined>;

/** When one EVM address is a token on several chains: the person's pick for that address, else Palside's own chain first. Every candidate is kept. */
export const PAGE_CHAIN_ORDER: readonly TokenChain[] = ['robinhood', 'base', 'bnb', 'ethereum', 'solana'];
export const PAGE_TOKEN_TTL_MS = 7 * DAY_MS;
export const PAGE_RETRY_MS = 30 * SECOND_MS;
/** At most this many page answers travel with panel state: the recent pages the background and panel may ask about. */
export const PAGE_EXPOSED = 50;
const PAGE_LIMIT = 200;
type Entry = { asset: string | null | undefined; candidates: string[]; until: number };

/**
 * Page URL → token, for pool pages and chainless contract pages. Memory only, per account, like token names.
 * A pool always trades the same token, so a found token is kept for days; "no single token" is asked again after 10 minutes
 * and an unreachable directory after 30 seconds.
 */
export class PageResolver {
  private entries = new Map<string, Entry>();
  private flights = new Map<string, Promise<string | null | undefined>>();
  /** The chain the person picked for an address found on several chains: lower-case address → asset key. Memory only. */
  private chosen = new Map<string, string>();
  private readonly lookup: PageLookup;
  private readonly answer: (asset: string, entry: TokenEntry) => void;
  private readonly changed: () => void;
  private readonly now: () => number;
  private epoch = 0;
  /** Bumped on every change, so state projection can skip unchanged emits. */
  version = 0;
  constructor(lookup: PageLookup, answer: (asset: string, entry: TokenEntry) => void, changed: () => void = () => {}, now = () => Date.now()) {
    this.lookup = lookup; this.answer = answer; this.changed = () => { this.version++; changed(); }; this.now = now;
  }

  /** The page's token: an asset key, `null` when it has none, `undefined` while unknown. */
  get(url: string): string | null | undefined {
    const entry = this.entries.get(url);
    return entry && entry.until > this.now() ? entry.asset : undefined;
  }
  /** Every chain the address is a token on, preferred first; one entry for a pool. */
  candidates(url: string) { return this.entries.get(url)?.candidates ?? []; }

  resolve(page: LookupPage): Promise<string | null | undefined> {
    const known = this.entries.get(page.url);
    if (known && known.until > this.now()) return Promise.resolve(known.asset);
    const flight = this.flights.get(page.url); if (flight) return flight;
    const epoch = this.epoch;
    const work = (async () => {
      let result: TokenResolution | undefined;
      try { result = await this.lookup(page.kind === 'pool' ? { pool: page.pool, chain: networkTokenChain[page.chain] } : { address: page.address }); }
      catch { result = undefined; if (this.epoch === epoch) this.store(page.url, { asset: undefined, candidates: [], until: this.now() + PAGE_RETRY_MS }); return undefined; }
      if (this.epoch !== epoch || !result) return undefined;
      if (result.status === 'unavailable' && !result.tokens.length) { this.store(page.url, { asset: undefined, candidates: [], until: this.now() + PAGE_RETRY_MS }); return undefined; }
      const candidates = this.prefer(result.tokens.flatMap(token => { const asset = assetKey(tokenChainNetwork[token.chain], token.address); if (asset) this.answer(asset, token); return asset ? [asset] : []; }));
      const asset = candidates[0] ?? null;
      // Some chains read, another not: show what was read and ask again soon, so the unread chain can still join the choice.
      this.store(page.url, { asset, candidates, until: this.now() + (result.status === 'unavailable' ? PAGE_RETRY_MS : asset ? PAGE_TOKEN_TTL_MS : TOKEN_MISSING_RECHECK_MS) });
      return asset;
    })().finally(() => { if (this.flights.get(page.url) === work) this.flights.delete(page.url); });
    this.flights.set(page.url, work);
    return work;
  }

  /** Candidate assets in display order: the person's pick for the address first, then Palside's chain order. */
  prefer(assets: string[]): string[] {
    const rank = (asset: string) => { const chain = networkTokenChain[asset.slice(0, asset.indexOf(':')) as Network]; return chain ? PAGE_CHAIN_ORDER.indexOf(chain) : PAGE_CHAIN_ORDER.length; };
    const picked = assets.length > 1 ? this.chosen.get(addressOf(assets[0]!)) : undefined;
    return [...assets].sort((a, b) => Number(b === picked) - Number(a === picked) || rank(a) - rank(b));
  }

  /** Remembers `asset` as the person's chain for its address, and moves every page showing that address onto it. */
  choose(asset: string): boolean {
    const address = addressOf(asset);
    let found = false;
    for (const [url, entry] of [...this.entries]) {
      if (!entry.candidates.includes(asset)) continue;
      found = true;
      if (entry.asset !== asset) this.store(url, { ...entry, asset, candidates: [asset, ...entry.candidates.filter(item => item !== asset)] });
    }
    this.chosen.delete(address); this.chosen.set(address, asset);
    while (this.chosen.size > PAGE_LIMIT) this.chosen.delete(this.chosen.keys().next().value!);
    return found;
  }

  /** Pages whose address is a token on several chains: `url → candidates`, current first, for the chain picker. */
  choices(): Record<string, string[]> {
    const out: Record<string, string[]> = {}, now = this.now();
    for (const [url, entry] of [...this.entries].slice(-PAGE_EXPOSED)) if (entry.until > now && entry.candidates.length > 1) out[url] = entry.candidates;
    return out;
  }

  private store(url: string, entry: Entry) {
    const previous = this.entries.get(url);
    this.entries.delete(url); this.entries.set(url, entry);
    while (this.entries.size > PAGE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    if (previous?.asset !== entry.asset) this.changed();
  }

  clear() { this.epoch++; this.flights.clear(); this.chosen.clear(); if (!this.entries.size) return; this.entries.clear(); this.changed(); }

  /** Recent answers, newest last: `url → asset` or `null`, for the background and panel. */
  pick(): Record<string, string | null> {
    const out: Record<string, string | null> = {}, now = this.now();
    for (const [url, entry] of [...this.entries].slice(-PAGE_EXPOSED)) if (entry.until > now && entry.asset !== undefined) out[url] = entry.asset;
    return out;
  }
}

function addressOf(asset: string) { return asset.slice(asset.indexOf(':') + 1).toLowerCase(); }

/** A looked-up page as its token, keeping the page's own URL and site. */
export function tokenPage(page: LookupPage, asset: string): Extract<PageIdentity, { kind: 'asset' }> {
  const index = asset.indexOf(':'), chain = asset.slice(0, index) as Network, address = asset.slice(index + 1);
  return { kind: 'asset', site: page.site, host: page.host, url: page.url, chain, address, id: asset };
}
