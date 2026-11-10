import { readsTokens, siteByDomain, sites, type Network, type RouteValue, type SiteRoute, type SiteSpec } from './sites/index.ts';
import { isEvmAddress, isSolanaAddress } from './tokens.ts';

export type { Network } from './sites/index.ts';
type WebsiteMode = 'site' | 'page';
/**
 * `asset`: a token on a known chain. `pool`: a trading pool the server maps to its token. `address`: an EVM contract whose
 * chain the URL does not say; the server finds the chain that has it. `pool` and `address` pages wait for that answer.
 */
export type PageIdentity =
  | { kind: 'asset'; site: string; host: string; url: string; chain: Network; address: string; id: string }
  | { kind: 'pool'; site: string; host: string; url: string; chain: Network; pool: string }
  | { kind: 'address'; site: string; host: string; url: string; address: string }
  | { kind: 'website'; site: string; host: string; url: string; id: string; disclosure: WebsiteMode };

type SiteDefinition = { id: string; name: string; domain: string; tokens: boolean };
/** Display and parsing view of the site registry. `tokens`: the site's token pages are recognized; never a website access grant. */
export const siteDefinitions: readonly SiteDefinition[] = sites.map(site => ({ id: site.id, name: site.name, domain: site.domain, tokens: readsTokens(site) }));
/**
 * Chain names and ids as URLs write them. `null` marks a chain Palside does not read: naming it stops the lookup,
 * so no address is probed on the wrong chains. Numeric ids count only in a chain parameter or right before the address.
 */
const chainNames: Readonly<Record<string, Network | null>> = {
  robinhood: 'Robinhood', '4663': 'Robinhood',
  sol: 'Solana', solana: 'Solana', '501': 'Solana', '1399811149': 'Solana',
  bsc: 'BNB Chain', bnb: 'BNB Chain', binance: 'BNB Chain', bnbchain: 'BNB Chain', '56': 'BNB Chain',
  eth: 'Ethereum', ethereum: 'Ethereum', '1': 'Ethereum',
  base: 'Base', '8453': 'Base',
  ...Object.fromEntries(['arbitrum', 'arb', '42161', 'polygon', 'matic', '137', 'optimism', '10', 'avalanche', 'avax', '43114', 'tron', 'trx', 'ton', 'sui', 'aptos',
    'blast', '81457', 'linea', '59144', 'scroll', '534352', 'zksync', '324', 'mantle', '5000', 'sonic', '146', 'monad', 'hyperevm', 'hyperliquid', 'abstract',
    'berachain', 'unichain', '130', 'fantom', 'ftm', 'cronos', 'celo', 'gnosis', 'xdai', 'kaia', 'sei', 'starknet', 'bitcoin', 'btc', 'xlayer'].map(name => [name, null])),
};
const chainName = (name: string) => Object.hasOwn(chainNames, name) ? chainNames[name] : undefined;
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
/** A catalog site's id for its domain or any alias, else the host itself: one site, one id, whichever of its hosts a page is on. */
export function websiteId(host: string) { return siteByDomain(host)?.id ?? host; }

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
  // One-time sign-in and recovery material: OAuth/OIDC callbacks, SAML posts, magic links, one-time codes and reset links.
  'code', 'state', 'nonce', 'codeverifier', 'ticket', 'otp', 'magiclink', 'resettoken', 'verificationtoken', 'samlresponse', 'samlrequest', 'relaystate',
  'privatekey', 'mnemonic', 'seedphrase',
]);
/** Preserve meaningful page routing, including hash routes. A URL carrying authentication or one-time sign-in material is never shared (callers fall back to the site name). */
export function publicShareUrl(input: string): string | null {
  const url = websiteUrl(input); if (!url) return null;
  // `token=` carries a contract on token sites; anywhere else, or with any other value, it is a credential.
  const tokenSite = readsTokens(siteByDomain(url.hostname));
  const isCredential = (key: string, value: string) => key.toLowerCase() === 'token' ? !(tokenSite && addressShaped(value)) : credentialNames.has(key.replace(/[-_ ]/g, '').toLowerCase());
  if ([...url.searchParams].some(([key, value]) => isCredential(key, value))) return null;
  try {
    const fragment = decodeURIComponent(url.hash);
    if (fragment.split(/[?&#]/).some(parameter => parameter.includes('=') && isCredential(parameter.split('=', 1)[0]!.replace(/\+/g, ' '), parameter.slice(parameter.indexOf('=') + 1)))) return null;
  } catch { return null; }
  for (const key of [...url.searchParams.keys()]) if (tracking.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function websiteIdentity(input: string, mode: WebsiteMode = 'site'): Extract<PageIdentity, { kind: 'website' }> | null {
  const url = websiteUrl(input); if (!url) return null;
  const page = mode === 'page' ? publicShareUrl(input) : null;
  return { kind: 'website', site: siteByDomain(url.hostname)?.name ?? url.hostname, host: url.hostname,
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

const addressShaped = (value: string) => isEvmAddress(value) || isSolanaAddress(value);
/** A pool id: an EVM pool contract, a 32-byte Uniswap v4 / PancakeSwap Infinity id, or a Solana account. */
export function poolShaped(chain: Network, value: string) {
  return chain === 'Solana' ? isSolanaAddress(value) : /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value);
}
const canonicalPool = (chain: Network, value: string) => chain === 'Solana' ? value : value.toLowerCase();

/**
 * A public page's identity; `allowedHosts` limits it to those exact hosts, otherwise every public host qualifies.
 * A registered pool route decides first; then token pages on crypto sites are read from the URL itself; everything else is a website.
 */
export function identifyPage(input: string, allowedHosts?: readonly string[], mode: WebsiteMode = 'site'): PageIdentity | null {
  const url = websiteUrl(input); if (!url || allowedHosts && !allowedHosts.includes(url.hostname)) return null;
  const host = url.hostname; const website = websiteIdentity(input, mode)!;
  const single = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
  const site = siteByDomain(host);
  for (const route of site?.pools?.routes ?? []) {
    const match = url.pathname.match(new RegExp(route.path, route.flags));
    if (match) return poolIdentity(route, match, site!.pools!.chains, single, url, website);
  }
  return readsTokens(site) ? urlIdentity(site!, url, website) : website;
}

function poolIdentity(route: SiteRoute, match: RegExpMatchArray, chains: readonly Network[], single: (key: string) => string | null, url: URL, website: Extract<PageIdentity, { kind: 'website' }>): PageIdentity {
  const read = (value: RouteValue) => 'group' in value ? match[value.group] : single(value.query);
  if (!('group' in route.chain) && url.searchParams.getAll(route.chain.query).length > 1) return website;
  const key = read(route.chain); const raw = read(route.id);
  const named = key ? 'map' in route.chain && route.chain.map ? route.chain.map[key] : chainName(key.toLowerCase()) ?? undefined : raw && !('group' in route.chain) && isSolanaAddress(raw) ? 'Solana' : undefined;
  const chain = named && chains.includes(named) ? named : undefined;
  if (!chain || !raw || !poolShaped(chain, raw)) return website;
  const pool = canonicalPool(chain, raw);
  const path = route.url.replace(/\{(chain|id|path)\}/g, (_, name: string) => name === 'chain' ? key ?? '' : name === 'id' ? pool : url.pathname.replace(/\/$/, '')).replace(/\?chain=$/, '');
  return { kind: 'pool', site: website.site, host: website.host, chain, pool, url: `${url.origin}${path}` };
}

/** Path segments that are about a person or a transaction, never a token: their addresses are not read or sent anywhere. */
const PERSONAL = new Set(['address', 'addresses', 'account', 'accounts', 'wallet', 'wallets', 'tx', 'txs', 'transaction', 'transactions', 'block', 'blocks',
  'portfolio', 'profile', 'profiles', 'user', 'users', 'holder', 'holders', 'trader', 'traders', 'maker', 'makers', 'kol', 'kols', 'dev',
  // Wallet checks on security sites (GoPlus): the address is someone's wallet or its approvals.
  'address-security', 'approval-security']);
/** Query parameters naming a person; their values are never read as a token. */
const PERSONAL_QUERY = new Set(['wallet', 'account', 'user', 'maker', 'trader', 'owner', 'holder', 'from', 'to', 'ref', 'referral', 'inviter', 'invite']);
const POOL_SEGMENTS = new Set(['pool', 'pools', 'pair', 'pairs', 'pair-explorer', 'lp']);
const CHAIN_QUERY = new Set(['chain', 'chainid', 'chain_id', 'network', 'networkid', 'net', 'blockchain']);
/** Language prefixes sites put before their routes (/en/, /zh-hans/, /zh-TW/). */
const LOCALE = /^(?:en|zh|ja|ko|ru|es|pt|fr|de|it|tr|vi|id|th|ar|uk|pl|nl|fa|hi|ms)(?:[-_][a-z]{2,4})?$/i;

/**
 * A token page on a crypto site read from its URL: the first address in the path (or an unrepeated query value), and the chain
 * from a chain parameter, a chain segment before the address, a suffix like `-solana` or `base:`, the site's only chain, or the
 * address family. A path about a wallet or a transaction stays a website. An EVM address with no chain becomes `address`.
 */
function urlIdentity(site: SiteSpec, url: URL, website: Extract<PageIdentity, { kind: 'website' }>): PageIdentity {
  let segments: string[];
  try { segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment)); } catch { return website; }
  const locale = Boolean(segments[0] && LOCALE.test(segments[0]) && chainName(segments[0].toLowerCase()) === undefined);
  if (locale) segments = segments.slice(1);
  const lower = segments.map(segment => segment.toLowerCase());
  if (lower.some(segment => PERSONAL.has(segment))) return website;
  const pool = lower.some(segment => POOL_SEGMENTS.has(segment));
  const shaped = (value: string) => addressShaped(value) || pool && /^0x[0-9a-fA-F]{64}$/.test(value);
  const hints: (Network | null)[] = [];
  const used: string[] = [];
  let found: { value: string; segment: number } | undefined;
  for (const [index, segment] of segments.entries()) {
    const parts = segment.split(/[-:]/);
    const value = parts.find(shaped);
    if (value) { found = { value, segment: index }; for (const part of parts) { const name = part === value || /^\d+$/.test(part) ? undefined : chainName(part.toLowerCase()); if (name !== undefined) hints.push(name); } break; }
  }
  if (!found) for (const [key, value] of url.searchParams) {
    if (!PERSONAL_QUERY.has(key.toLowerCase()) && url.searchParams.getAll(key).length === 1 && shaped(value)) { found = { value, segment: segments.length }; used.push(key); break; }
  }
  if (!found) return website;
  for (const [key, value] of url.searchParams) {
    if (!CHAIN_QUERY.has(key.toLowerCase()) || value.includes(',')) continue;
    // A repeated chain parameter names no one chain.
    if (url.searchParams.getAll(key).length !== 1) return website;
    // A chain parameter Palside cannot read names some other chain: never probe the supported ones instead.
    const name = chainName(value.toLowerCase());
    if (name === undefined) return website;
    hints.unshift(name); used.push(key);
  }
  for (const [index, segment] of lower.slice(0, found.segment).entries()) {
    const name = !/^\d+$/.test(segment) || index === found.segment - 1 ? chainName(segment) : undefined;
    if (name !== undefined) hints.push(name);
  }
  if (hints.includes(null)) return website;
  const solana = isSolanaAddress(found.value);
  const siteChain = site.chain === 'none' ? undefined : site.chain;
  // A single-chain site's address must fit its chain unless the URL names another one.
  if (!hints.length && siteChain && (siteChain === 'Solana') !== solana) return website;
  const chain = hints[0] ?? (solana ? 'Solana' : siteChain);
  if (chain && (chain === 'Solana') !== solana) return website;
  // The source URL keeps the path with chain names and an EVM address in lowercase, and only the query values that named the token.
  const canonical = solana ? found.value : found.value.toLowerCase();
  const path = url.pathname.split('/').map(raw => {
    let decoded: string; try { decoded = decodeURIComponent(raw); } catch { return raw; }
    return chainName(decoded.toLowerCase()) !== undefined && !/^\d+$/.test(decoded) ? raw.toLowerCase() : raw.replace(found!.value, canonical);
  }).join('/').replace(/\/$/, '');
  const query = new URLSearchParams([...url.searchParams].filter(([key]) => used.includes(key)).map(([key, value]) => [key, value === found!.value ? canonical : value]));
  const source = `${url.origin}${path}${query.size ? `?${query}` : ''}`;
  const base = { site: website.site, host: website.host, url: source };
  if (pool) return chain && poolShaped(chain, found.value) ? { kind: 'pool', ...base, chain, pool: canonicalPool(chain, found.value) } : website;
  if (!chain) return { kind: 'address', ...base, address: found.value.toLowerCase() };
  const address = normalizeAddress(chain, found.value);
  return address ? { kind: 'asset', ...base, chain, address, id: `${chain}:${address}` } : website;
}

/** A token's page on a registered site, or null when the site has no token page for that chain. */
export function tokenPageUrl(siteId: string, chain: string, address: string): string | null {
  const site = sites.find(item => item.id === siteId), key = site?.tokenUrl?.chains[chain as Network];
  if (!site?.tokenUrl || !key) return null;
  const url = `https://${site.domain}${site.tokenUrl.path.replace('{chain}', key).replace('{id}', address)}`;
  const identity = identifyPage(url);
  const same = identity?.kind === 'asset' ? identity.chain === chain && (identity.address === address || identity.address === address.toLowerCase())
    : identity?.kind === 'pool' && identity.chain === chain && identity.pool.toLowerCase() === address.toLowerCase();
  return same ? identity!.url : null;
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
