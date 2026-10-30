import { resolveTokenMetadata,tokenName } from './token-page.ts';
import { identifyPage,normalizeAddress,publicShareUrl,shortAddress,websiteIdentity,type PageIdentity } from '@palside/shared/navigation';
import type { Viewing } from '../../domain/assets/model';
import { tokenLogoSource,validateTokenLogo } from './token-logo.ts';

export function pageView(identity: Exclude<PageIdentity, { kind: 'pool' }>, metadata?: { name?: string; logo?: string }): Viewing {
  const name = identity.kind === 'asset' ? resolveTokenMetadata(identity, metadata).name! : metadata?.name || identity.site;
  const logo = typeof metadata?.logo === 'string' && metadata.logo.startsWith('data:image/') && metadata.logo.length <= 8192
    ? metadata.logo
    : tokenLogoSource(metadata?.logo);
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
      ? { chain: identity.chain, address: identity.address, ...(logo ? { logo } : {}) }
      : { disclosure: identity.disclosure, ...(logo ? { logo } : {}) }),
  };
}
/** Pure snapshot validation never looks at a receiver's cache, preferences or public API. */
export function validateView(value: unknown): Viewing | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<Viewing>;
  if (v.version !== 1 || typeof v.url !== 'string' || typeof v.name !== 'string') return;
  if (v.kind === 'website') {
    if (v.disclosure !== 'site' && v.disclosure !== 'page') return;
    const identity = websiteIdentity(v.url, v.disclosure);
    if (!identity || identity.disclosure !== v.disclosure || (v.disclosure === 'site' ? new URL(v.url).pathname !== '/' || new URL(v.url).search || new URL(v.url).hash : !publicShareUrl(v.url))) return;
    const logo = typeof v.logo === 'string' && v.logo.startsWith('data:image/') && v.logo.length <= 8192 ? v.logo : undefined;
    return { ...pageView(identity, { name: v.name, logo }), source: new URL(v.url).hostname };
  }
  if (v.kind !== 'asset') return;
  let host: string; try { host = new URL(v.url).hostname; } catch { return; }
  const source = identifyPage(v.url, [host]);
  if (!source || source.kind !== 'asset' || source.chain !== v.chain) return;
  const address = normalizeAddress(source.chain, v.address ?? '');
  if (!address || address !== source.address) return;
  const name = v.name.trim();
  const safe = tokenName(name) ?? shortAddress(address);
  return pageView({ kind: 'asset', chain: source.chain, address, host, site: source.site, url: source.url, id: `${source.chain}:${address}` }, { name: safe, logo: tokenLogoSource(v.logo) });
}
export async function readView(value: unknown): Promise<Viewing | undefined> {
  const view = validateView(value); if (!view) return;
  if (view.kind === 'asset' && view.logo) view.logo = await validateTokenLogo(view.logo);
  return view;
}
