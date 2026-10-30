import { siteByDomain, sites, type Network, type RouteValue, type SiteRoute } from './sites/index.ts';

export type { Network } from './sites/index.ts';
type WebsiteMode = 'site' | 'page';
export type PageIdentity =
  | { kind: 'asset'; site: string; host: string; url: string; chain: Network; address: string; id: string }
  | { kind: 'pool'; site: string; host: string; url: string; chain: Network; pool: string }
  | { kind: 'website'; site: string; host: string; url: string; id: string; disclosure: WebsiteMode };

type SiteDefinition = { id: string; name: string; domain: string; capability: 'token' | 'pool' | 'website' };
/** Display and parsing view of the site registry. Capabilities describe URL adapters, never website access grants. */
export const siteDefinitions: readonly SiteDefinition[] = sites.map(site => {
  const kinds = site.identify?.routes.map(route => route.kind) ?? [];
  const capability = kinds.includes('token') ? 'token' : kinds.includes('pool') ? 'pool' : 'website';
  return { id: site.id, name: site.name, domain: site.domain, capability };
});
const networks: Record<string, Network> = { robinhood: 'Robinhood', sol: 'Solana', solana: 'Solana', bsc: 'BNB Chain', bnb: 'BNB Chain', eth: 'Ethereum', ethereum: 'Ethereum', base: 'Base' };
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export function websiteId(host: string) { return siteDefinitions.find(site => site.domain === host)?.id ?? host; }

/** URL syntax/origin boundaries only. No login, account, holdings or other page-purpose blacklist. */
export function websiteUrl(input: string): URL | null {
  let url: URL; try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || input.length > 4096) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.endsWith('.') || host.startsWith('[') || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|home\.arpa)$/.test(host)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a === 100 && b! >= 64 && b! <= 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31
      || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a! >= 224) return null;
  }
  url.hostname = host;
  return url;
}
const tracking = /^(utm_.+|ref|referral|referrer|gclid|fbclid)$/i;
const credentialNames = new Set([
  'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'authenticationtoken', 'authorizationtoken', 'sessiontoken', 'csrftoken', 'xsrftoken', 'securitytoken', 'bearertoken', 'apitoken', 'logintoken',
  'auth', 'authentication', 'authorization', 'authcode', 'authorizationcode', 'authkey', 'jwt', 'session', 'sessionid', 'sessionkey', 'apikey', 'apisecret', 'clientsecret', 'secret', 'password', 'passwd', 'pwd',
  'signature', 'sig', 'credential', 'credentials', 'oauthtoken', 'oauthtokensecret', 'oauthsignature', 'oauthverifier', 'xamzcredential', 'xamzsignature', 'xamzsecuritytoken', 'xgoogcredential', 'xgoogsignature', 'xgoogsecuritytoken',
]);
/** Preserve meaningful page routing, including hash routes. Never send embedded authentication credentials. */
export function publicShareUrl(input: string): string | null {
  const url = websiteUrl(input); if (!url) return null;
  const route = siteByDomain(url.hostname)?.identify?.routes.find(route => new RegExp(route.path, route.flags).test(url.pathname));
  const isCredential = (key: string) => key.toLowerCase() === 'token' ? route?.kind !== 'token' : credentialNames.has(key.replace(/[-_ ]/g, '').toLowerCase());
  if ([...url.searchParams.keys()].some(isCredential)) return null;
  try {
    const fragment = decodeURIComponent(url.hash);
    if (fragment.split(/[?&#]/).some(parameter => parameter.includes('=') && isCredential(parameter.split('=', 1)[0]!.replace(/\+/g, ' ')))) return null;
  } catch { return null; }
  for (const key of [...url.searchParams.keys()]) if (tracking.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function websiteIdentity(input: string, mode: WebsiteMode = 'site'): Extract<PageIdentity, { kind: 'website' }> | null {
  const url = websiteUrl(input); if (!url) return null;
  const page = mode === 'page' ? publicShareUrl(input) : null;
  return { kind: 'website', site: siteDefinitions.find(site => site.domain === url.hostname)?.name ?? url.hostname, host: url.hostname,
    id: `website:${websiteId(url.hostname)}`, url: page ?? url.origin, disclosure: page ? 'page' : 'site' };
}
export function normalizeAddress(chain: Network, address: unknown): string | null {
  if (typeof address !== 'string') return null;
  if (chain !== 'Solana') return /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : null;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(0);
  for (const character of address) value = value * BigInt(58) + BigInt(alphabet.indexOf(character));
  let bytes = 0; while (value > BigInt(0)) { bytes++; value >>= BigInt(8); }
  const zeros = address.match(/^1*/)?.[0].length ?? 0;
  return bytes + zeros === 32 ? address : null;
}

/** Parse only registered token/pool routes; every other selected page is a website. */
/** A public page's identity; `allowedHosts` limits it to those exact hosts, otherwise every public host qualifies. */
export function identifyPage(input: string, allowedHosts?: readonly string[], mode: WebsiteMode = 'site'): PageIdentity | null {
  const url = websiteUrl(input); if (!url || allowedHosts && !allowedHosts.includes(url.hostname)) return null;
  const host = url.hostname; const website = websiteIdentity(input, mode)!;
  const single = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
  const site = siteByDomain(host);
  for (const route of site?.identify?.routes ?? []) {
    const match = url.pathname.match(new RegExp(route.path, route.flags));
    if (match) return routeIdentity(route, match, site!.identify!.chains, single, url, website);
  }
  return website;
}

function routeIdentity(route: SiteRoute, match: RegExpMatchArray, chains: readonly Network[], single: (key: string) => string | null, url: URL, website: Extract<PageIdentity, { kind: 'website' }>): PageIdentity {
  const read = (value: RouteValue) => 'group' in value ? match[value.group] : single(value.query);
  const key = read(route.chain); const raw = read(route.id);
  const named = key ? 'map' in route.chain && route.chain.map ? route.chain.map[key] : networks[key.toLowerCase()] : undefined;
  const chain = named && chains.includes(named) ? named : undefined;
  const path = (id: string) => route.url.replace(/\{(chain:lower|chain|id|path)\}/g, (_, name: string) =>
    name === 'chain' ? key! : name === 'chain:lower' ? key!.toLowerCase() : name === 'id' ? id : url.pathname.replace(/\/$/, ''));
  if (route.kind === 'pool') {
    if (chain && raw && /^[a-zA-Z0-9]{20,100}$/.test(raw) && (!route.idIsAddress || normalizeAddress(chain, raw))) {
      return { kind: 'pool', site: website.site, host: website.host, chain, pool: raw, url: `${url.origin}${path(raw)}` };
    }
    return website;
  }
  const address = chain && raw ? normalizeAddress(chain, raw) : null;
  return chain && address ? { kind: 'asset', site: website.site, host: website.host, chain, address, id: `${chain}:${address}`, url: `${url.origin}${path(address)}` } : website;
}

/** URL path keys the registry's routes use for each network, most common first. */
const networkKeys: Record<Network, readonly string[]> = { Solana: ['sol', 'solana'], 'BNB Chain': ['bsc', 'bnb'], Ethereum: ['eth', 'ethereum'], Base: ['base'], Robinhood: ['robinhood'] };
/** A token's canonical page on a registered site, or null when the site has no token route for that chain. */
export function tokenPageUrl(siteId: string, chain: string, address: string): string | null {
  const site = sites.find(item => item.id === siteId); const identify = site?.identify;
  if (!site || !identify || !identify.chains.includes(chain as Network)) return null;
  for (const route of identify.routes) {
    if (route.kind !== 'token') continue;
    const map = 'map' in route.chain ? route.chain.map : undefined;
    const key = map ? Object.keys(map).find(name => map[name] === chain) : networkKeys[chain as Network][0];
    if (!key || /\{path\}/.test(route.url)) continue;
    const url = `https://${site.domain}${route.url.replace(/\{(chain:lower|chain|id)\}/g, (_, name: string) => name === 'chain' ? key : name === 'chain:lower' ? key.toLowerCase() : address)}`;
    const identity = identifyPage(url);
    if (identity?.kind === 'asset' && identity.chain === chain && identity.address.toLowerCase() === address.toLowerCase()) return identity.url;
  }
  return null;
}

/** Exact source or the site-only fallback; no implicit cross-origin/port rewriting. */
export function matchesSharedPage(activeUrl: string, sharedUrl: string): boolean {
  const identity = identifyPage(activeUrl, undefined, 'page');
  if (!identity) return false;
  return identity.url === sharedUrl || websiteIdentity(activeUrl)?.url === sharedUrl || publicShareUrl(activeUrl) === sharedUrl;
}
export function pageKey(input: string): string | null { return publicShareUrl(input); }
export function parseInvitation(input: string, websiteUrl: string): string | null {
  try {
    const url = new URL(input);
    if (url.origin !== new URL(websiteUrl).origin || url.username || url.password) return null;
    return url.pathname.match(/^\/(?:(?:en|zh-CN)\/)?invite\/([a-zA-Z0-9_-]{32})\/?$/)?.[1] ?? null;
  } catch { return null; }
}
