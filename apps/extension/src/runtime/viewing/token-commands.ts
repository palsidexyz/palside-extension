import { addressFamily, tokenChainNetwork } from '@palside/shared/tokens';
import type { Network } from '@palside/shared/navigation';
import { MINUTE_MS } from '@palside/shared/units';
import type { ApiResult } from '../transport/api';
import type { Command } from '../transport/command-map';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';
import type { Attachment } from '../../domain/chat/model';
import { assetKey } from '../../domain/annotations/interaction.ts';
import { defaultTokenSite } from '../rooms/token-sites';
import { pageView } from './view-snapshot';

type AssetAttachment = Extract<Attachment, { kind: 'asset' }>;
type Resolved = ApiResult<'tokens.resolve'>['items'][number] | undefined;

/** Per session: an address resolves once per 10 minutes, and typing or switching its chain reuses the answer or the request in flight. */
const RESOLVE_TTL_MS = 10 * MINUTE_MS, RESOLVE_KEEP = 50;
const resolved = new WeakMap<object, Map<string, { at: number; result: Promise<Resolved> }>>();
function resolveAddress(runtime: RuntimeCommands['runtime'], session: NonNullable<RuntimeCommands['runtime']['auth']['session']>, address: string) {
  let cache = resolved.get(session);
  if (!cache) resolved.set(session, cache = new Map());
  const now = Date.now(), hit = cache.get(address);
  if (hit && now - hit.at < RESOLVE_TTL_MS) { cache.delete(address); cache.set(address, hit); return hit.result; }
  const result = runtime.api.request('tokens.resolve', { body: { items: [{ address }] }, token: session.token }).then(answer => answer.items[0]);
  cache.set(address, { at: now, result });
  result.catch(() => { if (cache.get(address)?.result === result) cache.delete(address); });
  while (cache.size > RESOLVE_KEEP) cache.delete(cache.keys().next().value!);
  return result;
}

/**
 * 代币卡片 from a pasted contract address: the directory says which chains hold the token; the card takes the person's chain for
 * that address, else Palside's chain order. `asset` picks one of the candidates and is remembered for the address.
 * Nothing is fetched from any page; no answer (signed out, not a token, unreachable) means no card.
 */
export async function tokenCardCommand(this: RuntimeCommands, command: Extract<Command, { name: 'token-card' }>): Promise<{ attachment?: AssetAttachment; candidates: string[] }> {
  const runtime = this.runtime, session = runtime.auth.session;
  const address = command.payload.address.trim();
  if (!session || !addressFamily(address)) return { candidates: [] };
  let found;
  try { found = await resolveAddress(runtime, session, address); }
  catch { return { candidates: [] }; }
  if (runtime.auth.session !== session || !found || !found.tokens.length) return { candidates: [] };
  const tokens = found.tokens.filter(entry => assetKey(tokenChainNetwork[entry.chain], entry.address));
  // Handed to the directory as answers, so the card's name and icon are not asked for a second time.
  runtime.directory.push(tokens);
  const assets = tokens.map(entry => assetKey(tokenChainNetwork[entry.chain], entry.address)!);
  const wanted = command.payload.asset;
  if (wanted && assets.includes(wanted)) runtime.pages.choose(wanted);
  const candidates = runtime.pages.prefer(assets);
  runtime.state.cardAssets = candidates.length > 1 ? candidates : undefined;
  const asset = candidates[0];
  if (!asset) return { candidates };
  const at = asset.indexOf(':'), chain = asset.slice(0, at), canonical = asset.slice(at + 1);
  const site = defaultTokenSite({ chain, address: canonical }, runtime.state.preferences.rooms?.site);
  if (!site) return { candidates };
  const host = new URL(site.url).hostname;
  const view = pageView({ kind: 'asset', site: site.name, host, url: site.url, chain: chain as Network, address: canonical, id: asset }, runtime.tokens.get(asset));
  runtime.emit();
  return { attachment: { kind: 'asset', assetId: view.id, view }, candidates };
}

/** Changes the chain of every page showing this address to `asset`, one of its candidates; 弹幕 then follows the tab. */
export async function pageChainCommand(this: RuntimeCommands, command: Extract<Command, { name: 'page-chain' }>) {
  const changed = this.runtime.pages.choose(command.payload.asset);
  if (changed) this.runtime.emit();
  return { changed };
}

/** 热门's search: name or symbol prefix among tokens the directory knows, or a pasted address. Rows travel as token records. */
export async function tokenSearchCommand(this: RuntimeCommands, command: Extract<Command, { name: 'token-search' }>): Promise<{ assets: string[] }> {
  const runtime = this.runtime, session = runtime.auth.session;
  const q = command.payload.q.trim();
  if (!session) return { assets: [] };
  if (!q) { if (runtime.state.searchAssets) { runtime.state.searchAssets = undefined; runtime.emit(); } return { assets: [] }; }
  const { rows } = await runtime.api.request('tokens.search', { query: { q }, token: session.token });
  if (runtime.auth.session !== session) return { assets: [] };
  const assets = rows.flatMap(entry => {
    const asset = assetKey(tokenChainNetwork[entry.chain], entry.address);
    if (asset) runtime.tokens.putDirectory(asset, entry);
    return asset ? [asset] : [];
  });
  const ordered = addressFamily(q) ? runtime.pages.prefer(assets) : assets;
  runtime.state.searchAssets = ordered;
  runtime.emit();
  return { assets: ordered };
}

export const tokenHandlers = {
  'token-card': tokenCardCommand,
  'page-chain': pageChainCommand,
  'token-search': tokenSearchCommand,
} satisfies HandlerRegistry;
