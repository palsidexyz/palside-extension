import { DAY_MS } from '@palside/shared/units';
import { shortAddress } from '@palside/shared/navigation';
import { siteByDomain,siteById } from '@palside/shared/sites';
import type { TokenEntry } from '@palside/shared/contracts/tokens';
import type { Network } from '@palside/shared/sites';
import { networkTokenChain } from '@palside/shared/tokens';
import { viewAsset } from '../../domain/annotations/interaction.ts';
import type { Viewing } from '../../domain/assets/model';
import { tokenName } from './token-name.ts';

/** A token's one display record, bound to one `chain:address`: its name, icon and the registry site it is usually opened on. */
/** `logoPending`: the directory is still fetching this token's icon; it arrives by push or the next ask. */
export type TokenProfile = { name: string; logo?: string; site?: string; logoPending?: true };
/** `directory`: the server token directory, read from the chain; `view`: a teammate's or a message's snapshot name, shown until the directory answers. */
export type TokenProfileSource = 'directory' | 'view';
type Entry = TokenProfile & { source: TokenProfileSource; at: number };

const rank: Record<TokenProfileSource, number> = { view: 0, directory: 1 };
export const TOKEN_PROFILE_TTL_MS = 7 * DAY_MS;
export const TOKEN_PROFILE_LIMIT = 500;
/** At most this many records travel with panel state: the tokens the panel currently references. */
export const TOKEN_PROFILE_EXPOSED = 200;

/** The token directory's stored icon on Palside's own API: the only remote token image the extension shows. */
export function directoryLogo(origin: string, network: Network, address: string, version: number) {
  return `${origin}/tokens/logo/${networkTokenChain[network]}/${address}?v=${version}`;
}

/** A token view whose name is a real name, not the address placeholder. Websites are always named. */
export function tokenNamed(view: Pick<Viewing, 'kind' | 'name' | 'address'> | undefined) {
  if (!view) return false;
  if (view.kind !== 'asset' || !view.address) return true;
  return view.name !== shortAddress(view.address) && Boolean(tokenName(view.name));
}

/** A token view drawn with its record's name and icon, keeping its own identity (id, URL, source). Token icons come only from the directory. */
export function withProfile<T extends Viewing>(view: T, profile: TokenProfile | undefined): T {
  if (view.kind !== 'asset' || !profile) return view;
  const logo = profile.logo;
  if (view.name === profile.name && view.logo === logo) return view;
  const next: T = { ...view, name: profile.name, glyph: profile.name.slice(0, 1) };
  if (logo) next.logo = logo; else delete next.logo;
  return next;
}

const profileOf = (entry: Entry): TokenProfile => ({ name: entry.name, ...(entry.logo ? { logo: entry.logo } : {}), ...(entry.site ? { site: entry.site } : {}), ...(entry.logoPending ? { logoPending: true as const } : {}) });

/**
 * Memory only, per account: never written to storage, so it is not a browsing trail on disk.
 * Cleared with the account session and 清除本地数据. Keyed by asset, not by tab or document,
 * so every surface (card, 详情, 弹幕, 热门, 在看) shows the same name and icon.
 */
export class TokenProfiles {
  private entries = new Map<string, Entry>();
  private readonly changed: () => void;
  private readonly now: () => number;
  private readonly origin: string;
  /** Bumped on every content change, so state projection can skip unchanged emits. */
  version = 0;
  /** `apiOrigin` serves the directory's icons. */
  constructor(changed: () => void = () => {}, now = () => Date.now(), apiOrigin = '') { this.changed = () => { this.version++; changed(); }; this.now = now; this.origin = apiOrigin; }

  get(asset: string | undefined): TokenProfile | undefined {
    if (!asset) return;
    const entry = this.entries.get(asset); if (!entry) return;
    if (this.now() - entry.at > TOKEN_PROFILE_TTL_MS) { this.entries.delete(asset); this.changed(); return; }
    return profileOf(entry);
  }

  /** A snapshot's name and site. Returns whether the stored profile changed. A directory answer is never replaced; the snapshot may only add a missing site. */
  put(asset: string | undefined, input: { name?: unknown; site?: unknown } | null | undefined): boolean {
    if (!asset || !input) return false;
    const name = tokenName(input.name);
    const site = typeof input.site === 'string' && siteById(input.site) ? input.site : undefined;
    if (!name) return false;
    const address = asset.slice(asset.indexOf(':') + 1);
    if (name === shortAddress(address)) return false;
    const previous = this.fresh(asset);
    if (previous && rank[previous.source] > rank.view) {
      if (previous.site || !site) { this.touch(asset, previous); return false; }
      return this.store(asset, { ...previous, site }, previous);
    }
    const keptSite = site ?? previous?.site;
    return this.store(asset, { name, ...(keptSite ? { site: keptSite } : {}), source: 'view', at: this.now() }, previous);
  }

  /** The directory's answer replaces any snapshot name: symbol first, then full name, else the short address (also when hidden by an operator). */
  putDirectory(asset: string, entry: TokenEntry | null) {
    if (!entry) return false;
    const network = asset.slice(0, asset.indexOf(':')) as Network, address = asset.slice(asset.indexOf(':') + 1);
    const name = tokenName(entry.symbol) ?? tokenName(entry.name) ?? shortAddress(address);
    const previous = this.fresh(asset), logo = entry.logo ? directoryLogo(this.origin, network, address, entry.logo) : undefined;
    return this.store(asset, { name, ...(logo ? { logo } : {}), ...(previous?.site ? { site: previous.site } : {}), ...(!logo && entry.logoPending ? { logoPending: true as const } : {}), source: 'directory', at: this.now() }, previous);
  }

  /** Whether the directory has answered for this asset and the answer is still held. */
  answered(asset: string) { return this.fresh(asset)?.source === 'directory'; }
  private fresh(asset: string) { const entry = this.entries.get(asset); return entry && this.now() - entry.at <= TOKEN_PROFILE_TTL_MS ? entry : undefined; }
  private store(asset: string, next: Entry, previous: Entry | undefined) {
    const same = previous && previous.name === next.name && previous.logo === next.logo && previous.site === next.site && previous.logoPending === next.logoPending && previous.source === next.source;
    this.entries.delete(asset); this.entries.set(asset, next);
    while (this.entries.size > TOKEN_PROFILE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    if (!same) this.changed();
    return !same;
  }

  /** Learns from a named token view; the view's site is the registry id when its source names a site. */
  remember(view: Viewing | undefined) {
    if (!view || view.kind !== 'asset' || !tokenNamed(view)) return false;
    let site: string | undefined; try { site = siteByDomain(new URL(view.url).hostname)?.id; } catch { site = undefined; }
    return this.put(viewAsset(view), { name: view.name, site });
  }

  /** The record's name and icon on a token view, the view keeping its own identity (id, URL, source); any other view is returned as is. */
  apply<T extends Viewing>(view: T): T { return view.kind === 'asset' ? withProfile(view, this.get(viewAsset(view))) : view; }

  clear() { if (!this.entries.size) return; this.entries.clear(); this.changed(); }

  /** Records for these assets, newest first within the bound. */
  pick(assets: Iterable<string>): Record<string, TokenProfile> {
    const out: Record<string, TokenProfile> = {}; let count = 0; const now = this.now();
    for (const asset of new Set(assets)) {
      const entry = this.entries.get(asset);
      if (!entry || now - entry.at > TOKEN_PROFILE_TTL_MS) continue;
      out[asset] = profileOf(entry);
      if (++count >= TOKEN_PROFILE_EXPOSED) break;
    }
    return out;
  }

  private touch(asset: string, entry: Entry) {
    if ([...this.entries.keys()].at(-1) === asset) return;
    this.entries.delete(asset); this.entries.set(asset, entry);
  }
}
