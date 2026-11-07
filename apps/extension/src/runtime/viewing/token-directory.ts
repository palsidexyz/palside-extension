import { MINUTE_MS, SECOND_MS } from '@palside/shared/units';
import { TOKEN_MISSING_RECHECK_MS,TOKEN_RESOLVE_LIMIT } from '@palside/shared/rules/tokens';
import { networkTokenChain,tokenChainNetwork } from '@palside/shared/tokens';
import type { TokenEntry,TokenResolution } from '@palside/shared/contracts/tokens';
import type { Network } from '@palside/shared/sites';

/** Resolves to `undefined` when the directory cannot be asked right now (signed out): nothing is remembered or retried, and the next `show` asks again. */
export type TokenResolver = (items: { address: string; chain: TokenEntry['chain'] }[]) => Promise<readonly TokenResolution[] | undefined>;
/** One answer per asset: the directory entry, or `null` when the address is not a token on that chain. */
export type TokenAnswers = (answers: ReadonlyMap<string, TokenEntry | null>) => void;

/**
 * An icon still being stored arrives by push on the event stream; these slower asks only cover a stream that was down,
 * while the asset is still shown. After them the answer is rechecked like a missing token.
 */
export const TOKEN_LOGO_POLL_MS = [15 * SECOND_MS, MINUTE_MS, 5 * MINUTE_MS] as const;
/** A failed request (offline, server busy, older server without the directory) is retried after this. */
export const TOKEN_RETRY_MS = 30 * SECOND_MS;

type Known = { until: number; polls?: number; token?: boolean };

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
  private readonly resolver: TokenResolver;
  private readonly answer: TokenAnswers;
  private readonly held: (asset: string) => boolean;
  private readonly now: () => number;
  /** `held` reports whether the memory layer still holds this asset's answer; an evicted answer is asked for again. */
  constructor(resolver: TokenResolver, answer: TokenAnswers, held: (asset: string) => boolean, now = () => Date.now()) { this.resolver = resolver; this.answer = answer; this.held = held; this.now = now; }

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
      answers.set(asset, entry);
      this.known.set(asset, { until: entry.logoPending ? this.now() + TOKEN_MISSING_RECHECK_MS : Infinity, token: true });
    }
    if (answers.size) this.answer(answers);
  }

  clear() {
    this.epoch++; this.known.clear(); this.queued.clear(); this.flights.clear(); this.shown.clear(); this.flush = undefined;
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
  }

  private want(asset: string): Promise<void> | undefined {
    const flight = this.flights.get(asset); if (flight) return flight;
    const known = this.known.get(asset);
    if (known && known.until > this.now() && (!known.token || this.held(asset))) return;
    if (!split(asset)) return;
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
    let results: readonly TokenResolution[] | undefined;
    try { results = await this.resolver(items.map(item => ({ address: item.address, chain: networkTokenChain[item.network] }))); if (!results) return; } catch { results = undefined; }
    if (this.epoch !== epoch) return;
    const answers = new Map<string, TokenEntry | null>();
    for (const [index, asset] of batch.entries()) {
      const result = results?.find(row => 'address' in row && row.address === items[index]!.address && row.chain === networkTokenChain[items[index]!.network]);
      const entry = result?.status === 'token' ? result.tokens.find(token => tokenChainNetwork[token.chain] === items[index]!.network && token.address === items[index]!.address) : undefined;
      if (entry) {
        answers.set(asset, entry);
        const polls = (this.known.get(asset)?.polls ?? 0);
        if (entry.logoPending && polls < TOKEN_LOGO_POLL_MS.length) { this.known.set(asset, { until: Infinity, polls: polls + 1, token: true }); this.later(asset, TOKEN_LOGO_POLL_MS[polls]!, epoch); }
        else this.known.set(asset, { until: entry.logoPending ? this.now() + TOKEN_MISSING_RECHECK_MS : Infinity, token: true });
      } else if (result && (result.status === 'missing' || result.status === 'invalid')) {
        answers.set(asset, null);
        this.known.set(asset, { until: this.now() + TOKEN_MISSING_RECHECK_MS });
      } else {
        this.known.set(asset, { until: this.now() + TOKEN_RETRY_MS });
        this.later(asset, TOKEN_RETRY_MS, epoch);
      }
    }
    if (answers.size) this.answer(answers);
  }

  /** Asks again after `delay`, only while the asset is still shown. */
  private later(asset: string, delay: number, epoch: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.epoch !== epoch) return;
      const known = this.known.get(asset);
      if (known && known.until === Infinity && known.polls === undefined) return; // a push already brought the logo
      if (known) known.until = 0;
      if (this.shown.has(asset)) this.want(asset);
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
