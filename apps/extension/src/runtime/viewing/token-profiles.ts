import { DAY_MS } from '@palside/shared/units';
import { shortAddress } from '@palside/shared/navigation';
import { siteByDomain,siteById } from '@palside/shared/sites';
import { viewAsset } from '../../domain/annotations/interaction.ts';
import type { Viewing } from '../../domain/assets/model';
import { tokenName } from './token-page.ts';
import { tokenLogoSource } from './token-logo.ts';

/** A token's one display record, bound to one `chain:address`: its name, icon and the registry site it is usually opened on. */
export type TokenProfile = { name: string; logo?: string; site?: string };
/** `page`: this device read it from the token's own page; `view`: a teammate's or a message's snapshot; `room`: the 弹幕 service's vote. */
export type TokenProfileSource = 'page' | 'view' | 'room';
type Entry = TokenProfile & { source: TokenProfileSource; at: number };

const rank: Record<TokenProfileSource, number> = { room: 0, view: 1, page: 2 };
export const TOKEN_PROFILE_TTL_MS = 7 * DAY_MS;
export const TOKEN_PROFILE_LIMIT = 500;
/** At most this many records travel with panel state: the tokens the panel currently references. */
export const TOKEN_PROFILE_EXPOSED = 200;

/** A token view whose name is a real name, not the address placeholder. Websites are always named. */
export function tokenNamed(view: Pick<Viewing, 'kind' | 'name' | 'address'> | undefined) {
  if (!view) return false;
  if (view.kind !== 'asset' || !view.address) return true;
  return view.name !== shortAddress(view.address) && Boolean(tokenName(view.name));
}

/** A token view drawn with its record's name and icon, keeping its own identity (id, URL, source). */
export function withProfile<T extends Viewing>(view: T, profile: TokenProfile | undefined): T {
  if (view.kind !== 'asset' || !profile) return view;
  const logo = profile.logo ?? (profile.name === view.name ? view.logo : undefined);
  if (view.name === profile.name && view.logo === logo) return view;
  const next: T = { ...view, name: profile.name, glyph: profile.name.slice(0, 1) };
  if (logo) next.logo = logo; else delete next.logo;
  return next;
}

const profileOf = (entry: Entry): TokenProfile => ({ name: entry.name, ...(entry.logo ? { logo: entry.logo } : {}), ...(entry.site ? { site: entry.site } : {}) });

/**
 * Memory only, per account: never written to storage, so it is not a browsing trail on disk.
 * Cleared with the account session and 清除本地数据. Keyed by asset, not by tab or document,
 * so every surface (card, 详情, 弹幕, 热门, 在看) shows the same name and icon.
 */
export class TokenProfiles {
  private entries = new Map<string, Entry>();
  private readonly changed: () => void;
  private readonly now: () => number;
  /** Bumped on every content change, so state projection can skip unchanged emits. */
  version = 0;
  constructor(changed: () => void = () => {}, now = () => Date.now()) { this.changed = () => { this.version++; changed(); }; this.now = now; }

  get(asset: string | undefined): TokenProfile | undefined {
    if (!asset) return;
    const entry = this.entries.get(asset); if (!entry) return;
    if (this.now() - entry.at > TOKEN_PROFILE_TTL_MS) { this.entries.delete(asset); this.changed(); return; }
    return profileOf(entry);
  }

  /** Returns whether the stored profile changed. A weaker source never replaces a stronger one's name, but may supply a missing icon or site. */
  put(asset: string | undefined, input: { name?: unknown; logo?: unknown; site?: unknown } | null | undefined, source: TokenProfileSource): boolean {
    if (!asset || !input) return false;
    const name = tokenName(input.name), logo = tokenLogoSource(input.logo);
    const site = typeof input.site === 'string' && siteById(input.site) ? input.site : undefined;
    if (!name) return false;
    const address = asset.slice(asset.indexOf(':') + 1);
    if (name === shortAddress(address)) return false;
    const previous = this.entries.get(asset), now = this.now();
    const fresh = previous && now - previous.at <= TOKEN_PROFILE_TTL_MS;
    let next: Entry;
    if (fresh && rank[previous.source] > rank[source]) {
      const fill = previous.name === name ? { ...(!previous.logo && logo ? { logo } : {}), ...(!previous.site && site ? { site } : {}) } : {};
      if (!Object.keys(fill).length) { this.touch(asset, previous); return false; }
      next = { ...previous, ...fill };
    } else {
      const kept = previous?.name === name ? previous : undefined;
      const keptLogo = logo ?? kept?.logo, keptSite = site ?? previous?.site;
      next = { name, ...(keptLogo ? { logo: keptLogo } : {}), ...(keptSite ? { site: keptSite } : {}), source, at: now };
    }
    const same = previous && previous.name === next.name && previous.logo === next.logo && previous.site === next.site;
    this.entries.delete(asset); this.entries.set(asset, next);
    while (this.entries.size > TOKEN_PROFILE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    if (!same) this.changed();
    return !same;
  }

  /** Learns from a named token view; the view's site is the registry id when its source names a site. */
  remember(view: Viewing | undefined, source: TokenProfileSource = 'view') {
    if (!view || view.kind !== 'asset' || !tokenNamed(view)) return false;
    let site: string | undefined; try { site = siteByDomain(new URL(view.url).hostname)?.id; } catch { site = undefined; }
    return this.put(viewAsset(view), { name: view.name, logo: view.logo, site }, source);
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
