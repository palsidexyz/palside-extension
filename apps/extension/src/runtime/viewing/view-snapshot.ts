import { resolveTokenMetadata,tokenName } from './token-name.ts';
import { identifyPage,normalizeAddress,publicShareUrl,shortAddress,websiteIdentity,type Network,type PageIdentity } from '@palside/shared/navigation';
import { networkTokenChain } from '@palside/shared/tokens';
import type { Viewing } from '../../domain/assets/model';
import { iconDataUrl } from './viewing.ts';

/** A teammate's page title, bounded: the sender cuts it at 80 graphemes. */
const WEBSITE_NAME_MAX = 120;

/**
 * A token view carries its identity and a fallback name only: every receiver draws the name and icon from the token
 * directory. A website view carries its page name and favicon.
 */
export function pageView(identity: Extract<PageIdentity, { kind: 'asset' | 'website' }>, metadata?: { name?: string; logo?: string }, via?: Viewing['via']): Viewing {
  const name = identity.kind === 'asset' ? resolveTokenMetadata(identity, metadata).name : metadata?.name || identity.site;
  const logo = identity.kind === 'asset' ? undefined : iconDataUrl(metadata?.logo);
  return {
    version: 1,
    id: `${identity.id}:${identity.kind === 'website' ? identity.disclosure : 'asset'}:${identity.url}`,
    kind: identity.kind,
    name,
    url: identity.url,
    source: identity.site,
    color: '#e9edf0',
    glyph: identity.kind === 'asset' ? name.slice(0, 1) : identity.host.slice(0, 1).toUpperCase(),
    ...(identity.kind === 'asset'
      ? { chain: identity.chain, address: identity.address, ...(via ? { via } : {}) }
      : { disclosure: identity.disclosure, ...(logo ? { logo } : {}) }),
  };
}
/** Pure snapshot validation never looks at a receiver's cache, preferences or public API. Token icons in snapshots are ignored. */
export function validateView(value: unknown): Viewing | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<Viewing>;
  if (v.version !== 1 || typeof v.url !== 'string' || typeof v.name !== 'string') return;
  if (v.kind === 'website') {
    if (v.disclosure !== 'site' && v.disclosure !== 'page') return;
    const identity = websiteIdentity(v.url, v.disclosure);
    if (!identity || identity.disclosure !== v.disclosure || (v.disclosure === 'site' ? new URL(v.url).pathname !== '/' || new URL(v.url).search || new URL(v.url).hash : !publicShareUrl(v.url))) return;
    return { ...pageView(identity, { name: Array.from(v.name.trim()).slice(0, WEBSITE_NAME_MAX).join(''), logo: iconDataUrl(v.logo) }), source: new URL(v.url).hostname };
  }
  if (v.kind !== 'asset' || typeof v.chain !== 'string' || !(v.chain in networkTokenChain)) return;
  let host: string; try { host = new URL(v.url).hostname; } catch { return; }
  const source = identifyPage(v.url, [host]), chain = v.chain as Network;
  const address = normalizeAddress(chain, v.address ?? '');
  if (!source || !address) return;
  // A token page must name this token; a pool page must be on its chain; a chainless contract page must name this contract.
  // Which token a pool trades is the sender's server answer; receivers draw its name and icon from the directory either way.
  if (source.kind === 'asset' ? source.chain !== chain || source.address !== address : source.kind === 'pool' ? source.chain !== chain
    : source.kind !== 'address' || chain === 'Solana' || source.address !== address) return;
  const safe = tokenName(v.name.trim()) ?? shortAddress(address);
  const via = source.kind === 'pool' || source.kind === 'address' ? source.kind : undefined;
  return pageView({ kind: 'asset', chain, address, host, site: source.site, url: source.url, id: `${chain}:${address}` }, { name: safe }, via);
}
export async function readView(value: unknown): Promise<Viewing | undefined> { return validateView(value); }
