import { MINUTE_MS, SECOND_MS } from '@palside/shared/units';
import { retryDelayMs } from '@palside/shared/backoff';
import { TOKEN_MISSING_RECHECK_MS,TOKEN_RESOLVE_LIMIT } from '@palside/shared/rules/tokens';
import { networkTokenChain,tokenChainNetwork } from '@palside/shared/tokens';
import type { TokenEntry,TokenResolution } from '@palside/shared/contracts/tokens';
import type { Network } from '@palside/shared/sites';

/** Resolves to `undefined` when the directory cannot be asked right now (signed out): nothing is remembered or retried, and the next `show` asks again. */
export type TokenResolver = (items: { address: string; chain: TokenEntry['chain'] }[]) => Promise<readonly TokenResolution[] | undefined>;
/** One answer per asset: the directory entry, or `null` when the address is not a token on that chain. */
export type TokenAnswers = (answers: ReadonlyMap<string, TokenEntry | null>) => void;

/**
 * An icon still being stored arrives by push on the event stream. Only while the stream is down is it asked for again at
 * these delays, while the asset is still shown; after them the answer is rechecked like a missing token. A stream that
 * comes back asks once for every icon still pending (`resume`).
 */
export const TOKEN_LOGO_POLL_MS = [15 * SECOND_MS, MINUTE_MS, 5 * MINUTE_MS] as const;
/** A failed request (offline, server busy) is retried after about this, doubling per failure up to `TOKEN_RETRY_MAX_MS`. */
export const TOKEN_RETRY_MS = 30 * SECOND_MS;
export const TOKEN_RETRY_MAX_MS = 5 * MINUTE_MS;

type Known = { until: number; polls?: number; token?: boolean; logoPending?: boolean; failures?: number };

/**
 * The extension's client of the server token directory. Every asset key the panel shows is asked for once, in batches of
 * at most `TOKEN_RESOLVE_LIMIT`; concurrent requests for one asset share a request. Answers live in memory only.
 * A failure keeps whatever name the snapshot carried and retries while the asset is still shown.
 */
export class TokenDirectoryClient {
  private known = new Map<string, Known>();
  private queued = new Set<string>();
  private flights = new Map<string, Promise<void>>();
  private shown = new Set<string>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private flush?: Promise<void>;
  private epoch = 0;
  /** Bumped per asset by each server push, so an answer asked for before it cannot replace it. */
  private pushes = new Map<string, number>();
  private readonly resolver: TokenResolver;
  private readonly answer: TokenAnswers;
  private readonly held: (asset: string) => boolean;
  private readonly now: () => number;
  private readonly failed: (assets: string[]) => void;
  private readonly streaming: () => boolean;
  /** `held` reports whether the memory layer still holds this asset's answer; an evicted answer is asked for again. */
  /** `failed`: assets whose ask failed or whose chain could not be read; asked again after the retry wait. */
  /** `streaming`: whether the event stream is open, so a pending icon will arrive by push. */
  constructor(resolver: TokenResolver, answer: TokenAnswers, held: (asset: string) => boolean, now = () => Date.now(), failed: (assets: string[]) => void = () => {}, streaming: () => boolean = () => false) { this.resolver = resolver; this.answer = answer; this.held = held; this.now = now; this.failed = failed; this.streaming = streaming; }

  /** The event stream reopened: pushes sent while it was down are lost, so every shown icon still pending is asked for once. */
  resume() {
    for (const asset of this.shown) { const known = this.known.get(asset); if (known?.logoPending) { known.until = 0; this.want(asset); } }
  }

  /** The assets the panel shows now; any not yet known is asked for. */
  show(assets: Iterable<string>) {
    this.shown = new Set(assets);
    for (const asset of this.shown) this.want(asset);
  }

  /** Settles once this asset's answer (or failure) is in. */
  ensure(asset: string): Promise<void> { return this.want(asset) ?? Promise.resolve(); }

  /** Entries the server pushed (a logo landed after we asked): taken as answers, ending any pending asks for them. */
  push(entries: readonly TokenEntry[]) {
    const answers = new Map<string, TokenEntry | null>();
    for (const entry of entries) {
      const asset = `${tokenChainNetwork[entry.chain]}:${entry.address}`;
      this.pushes.set(asset, (this.pushes.get(asset) ?? 0) + 1);
      answers.set(asset, entry);
      this.known.set(asset, { until: entry.logoPending ? this.now() + TOKEN_MISSING_RECHECK_MS : Infinity, token: true, ...(entry.logoPending ? { logoPending: true } : {}) });
    }
    if (answers.size) this.answer(answers);
  }

  clear() {
    this.epoch++; this.known.clear(); this.pushes.clear(); this.queued.clear(); this.flights.clear(); this.shown.clear(); this.flush = undefined;
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
  }

  private want(asset: string): Promise<void> | undefined {
    const flight = this.flights.get(asset); if (flight) return flight;
    const known = this.known.get(asset);
    if (known && known.until > this.now() && (!known.token || this.held(asset))) return;
    // Not an address the directory can read: never asked, so it is unknown at once rather than loading forever.
    if (!split(asset)) { queueMicrotask(() => this.failed([asset])); return; }
    this.queued.add(asset);
    this.flush ??= Promise.resolve().then(() => this.send());
    const pending = this.flush.then(() => this.flights.get(asset));
    return pending.then(() => {});
  }

  private async send() {
    const epoch = this.epoch; this.flush = undefined;
    const assets = [...this.queued]; this.queued.clear();
    const batches: string[][] = [];
    for (let index = 0; index < assets.length; index += TOKEN_RESOLVE_LIMIT) batches.push(assets.slice(index, index + TOKEN_RESOLVE_LIMIT));
    for (const batch of batches) {
      const flight = this.request(batch, epoch);
      for (const asset of batch) this.flights.set(asset, flight);
      void flight.finally(() => { if (this.epoch !== epoch) return; for (const asset of batch) if (this.flights.get(asset) === flight) this.flights.delete(asset); });
    }
  }

  private async request(batch: string[], epoch: number) {
    const items = batch.map(asset => split(asset)!);
    const pushes = batch.map(asset => this.pushes.get(asset));
    let results: readonly TokenResolution[] | undefined;
    try { results = await this.resolver(items.map(item => ({ address: item.address, chain: networkTokenChain[item.network] }))); if (!results) return; } catch { results = undefined; }
    if (this.epoch !== epoch) return;
    const answers = new Map<string, TokenEntry | null>(), unread: string[] = [], polls = new Map<number, string[]>();
    let retry = 0;
    for (const [index, asset] of batch.entries()) {
      if (this.pushes.get(asset) !== pushes[index]) continue;
      const result = results?.find(row => 'address' in row && row.address === items[index]!.address && row.chain === networkTokenChain[items[index]!.network]);
      const entry = result?.status === 'token' ? result.tokens.find(token => tokenChainNetwork[token.chain] === items[index]!.network && token.address === items[index]!.address) : undefined;
      if (entry) {
        answers.set(asset, entry);
        const poll = this.known.get(asset)?.polls ?? 0;
        if (entry.logoPending && !this.streaming() && poll < TOKEN_LOGO_POLL_MS.length) {
          this.known.set(asset, { until: Infinity, polls: poll + 1, token: true, logoPending: true });
          const delay = TOKEN_LOGO_POLL_MS[poll]!; polls.set(delay, [...polls.get(delay) ?? [], asset]);
        } else this.known.set(asset, { until: entry.logoPending ? this.now() + TOKEN_MISSING_RECHECK_MS : Infinity, token: true, ...(entry.logoPending ? { logoPending: true } : {}) });
      } else if (result && (result.status === 'missing' || result.status === 'invalid')) {
        answers.set(asset, null);
        this.known.set(asset, { until: this.now() + TOKEN_MISSING_RECHECK_MS });
      } else {
        const failures = (this.known.get(asset)?.failures ?? 0) + 1;
        retry = Math.max(retry, failures);
        this.known.set(asset, { until: Infinity, failures });
        unread.push(asset);
      }
    }
    if (answers.size) this.answer(answers);
    for (const [delay, assets] of polls) this.later(assets, delay, epoch);
    // One timer for the whole failed batch, so it is asked again as one request.
    if (unread.length) { this.later(unread, retryDelayMs(retry, { baseMs: TOKEN_RETRY_MS, maxMs: TOKEN_RETRY_MAX_MS }), epoch); this.failed(unread); }
  }

  /** Asks again after `delay` for those of `assets` still shown, in one batch. */
  private later(assets: string[], delay: number, epoch: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.epoch !== epoch) return;
      for (const asset of assets) {
        const known = this.known.get(asset);
        if (known && known.until === Infinity && known.polls === undefined && known.failures === undefined) continue; // a push already brought the logo
        if (known) known.until = 0;
        if (this.shown.has(asset)) this.want(asset);
      }
    }, delay);
    this.timers.add(timer);
  }
}

/** `<Network>:<address>` as the directory's request item. */
function split(asset: string): { network: Network; address: string } | undefined {
  const index = asset.indexOf(':'); if (index < 1) return;
  const network = asset.slice(0, index) as Network, address = asset.slice(index + 1);
  return network in networkTokenChain && address ? { network, address } : undefined;
}
