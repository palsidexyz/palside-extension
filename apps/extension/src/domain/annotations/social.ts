import { assetKey,pageScopeUrl,viewAsset } from './interaction.ts';
import type { Message } from '../chat/model';
import type { Viewing } from '../assets/model';
import { ROOM_TEXT_MAX,EVENT_ID_LENGTH } from '@palside/shared/contracts/limits';

export { assetKey, pageScopeUrl, viewAsset };
/** 便利贴: an encrypted team event kept on the Matrix timeline next to messages, never shown as chat: text pinned to a spot on a token page, or to the token itself. */
export const STICKY_EVENT = 'com.palside.sticky';
/** Live, never stored: relayed like reactions. */
export const POKE_EVENT = 'com.palside.poke';

export const REF_CAPTION_MAX = 40;
/** A received poke stays as a reminder card for one minute. */
export const POKE_DISPLAY = 60_000;
export const STICKY_MAX = 200;
/** Chain + normalized contract: discussions and stickies group by asset. */
export type AssetKey = string;
function assetFields(key: AssetKey) { const index = key.indexOf(':'); return { chain: key.slice(0, index), address: key.slice(index + 1) }; }

type TeamItem = { id: string; teamId: string; author: string; asset: AssetKey; timestamp: number; expiresAt: number; liveArrival?: boolean };
/**
 * 便利贴: several per person per token. With a target it is pinned on its page (site-bound unless the target is cross-site);
 * without one it belongs to the token. Only the author edits (`editedAt`) or deletes it.
 */
export type StickyScope = { asset?: AssetKey; url?: string };
export type Sticky = Omit<TeamItem, 'asset'> & StickyScope & {
  text: string;
  /** Root event id is stable; revision is the selected edit event id. */
  revision?: string;
  conflicted?: boolean;
  url?: string;
  site?: string;
  target?: RefTarget;
  caption?: string;
  editedAt?: number;
};
export type TeamItems = { stickies: Sticky[] };
export const emptyItems = (): TeamItems => ({ stickies: [] });

const plain = (value: unknown, maximum: number) => {
  if (typeof value !== 'string') return;
  const text = value.trim();
  return text && !/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/u.test(text) && Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length <= maximum ? text : undefined;
};
const host = (value: unknown) => typeof value === 'string' && /^[a-z0-9.-]{3,100}$/.test(value) ? value : undefined;

/** Builds the encrypted content of a team event; the asset travels as chain and contract. */
export function teamEventContent(
  asset: AssetKey | undefined,
  fields: { text?: string; site?: string; url?: string; target?: RefTarget; edits?: string; baseRevision?: string; caption?: string },
) {
  const content = {} as Record<string, unknown>;
  if (asset) content.asset = assetFields(asset);
  content.text = fields.text ?? '';
  if (fields.url !== undefined) content.url = pageScopeUrl(fields.url);
  if (fields.site !== undefined) content.site = fields.site;
  if (fields.target !== undefined) content.target = fields.target;
  if (fields.caption !== undefined) content.caption = fields.caption;
  if (fields.edits !== undefined) content.edits = fields.edits;
  if (fields.baseRevision !== undefined) content.baseRevision = fields.baseRevision;
  return content;
}
/** Validates decrypted team event content; anything malformed is dropped like an unknown event. */
export function readTeamEvent(type: string, content: Record<string, unknown>) {
  const asset = content.asset && typeof content.asset === 'object' ? assetKey((content.asset as { chain?: unknown }).chain, (content.asset as { address?: unknown }).address) : undefined;
  if (type === STICKY_EVENT) {
    const text = content.text === '' ? '' : plain(content.text, STICKY_MAX);
    const site = host(content.site), target = readRefTarget(content.target), caption = readRefCaption(content.caption);
    const url = pageScopeUrl(content.url);
    const eventId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= EVENT_ID_LENGTH ? value : undefined;
    const edits = eventId(content.edits), baseRevision = eventId(content.baseRevision);
    if (text === undefined || content.asset !== undefined && !asset || content.site !== undefined && !site || content.url !== undefined && !url || content.target !== undefined && target?.kind !== 'quote' || content.caption !== undefined && !caption) return;
    if (target && (!url || !site || new URL(url).hostname !== site) || !target && (!asset || !text)) return;
    if (content.edits !== undefined && !edits || content.baseRevision !== undefined && !baseRevision || Boolean(edits) !== Boolean(baseRevision)) return;
    return { kind: 'sticky' as const, ...(asset ? { asset } : {}), text, ...(url ? { url } : {}), ...(site ? { site } : {}), ...(target ? { target } : {}), ...(caption ? { caption } : {}), ...(edits ? { edits, baseRevision } : {}) };
  }
}

export type StickyRecord = Sticky & { edits?: string; baseRevision?: string };
export function stickyScopeMatches(item: StickyScope, scope: AssetKey | StickyScope) {
  if (typeof scope === 'string') return item.asset === scope;
  if (scope.url !== undefined) return Boolean(pageScopeUrl(scope.url) && pageScopeUrl(item.url) === pageScopeUrl(scope.url) && (!scope.asset || item.asset === scope.asset));
  return Boolean(scope.asset && item.asset === scope.asset);
}
/** Exact source and selected text identify a saved mark; a whole-asset note has no duplicate key. */
export function stickyTargetKey(item: Pick<Sticky, 'url' | 'target'>) {
  const url = pageScopeUrl(item.url), target = item.target;
  return url && target?.kind === 'quote' ? JSON.stringify([url, target.exact, target.prefix, target.suffix]) : undefined;
}
/** Display consumers receive resolved records and only select their scope. */
/** Resolve event branches once before publishing annotation state. */
export function resolveStickies(records: readonly StickyRecord[], now = Date.now(), deleted: (id: string, teamId: string) => boolean = () => false): Sticky[] {
  const originals: Sticky[] = [];
  const edits = new Map<string, Map<string, StickyRecord[]>>();
  for (const item of records) {
    if (item.expiresAt <= now || deleted(item.id, item.teamId) || item.edits && deleted(item.edits, item.teamId)) continue;
    if (!item.edits) { originals.push({ ...item, revision: item.id }); continue; }
    if (!item.baseRevision) continue;
    const key = JSON.stringify([item.teamId, item.edits]);
    let branches = edits.get(key);
    if (!branches) { branches = new Map(); edits.set(key, branches); }
    const branch = branches.get(item.baseRevision) ?? [];
    branch.push(item); branches.set(item.baseRevision, branch);
  }
  for (const original of originals) {
    const branches = edits.get(JSON.stringify([original.teamId, original.id]));
    const url = pageScopeUrl(original.url), target = stickyTargetKey(original);
    const visited = new Set([original.id]);
    for (;;) {
      const next = (branches?.get(original.revision!) ?? []).filter(edit => !visited.has(edit.id) && edit.author === original.author && edit.asset === original.asset && pageScopeUrl(edit.url) === url && stickyTargetKey(edit) === target).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (!next.length) break;
      // Encrypted concurrent branches select the same event on every device.
      original.conflicted = next.length > 1 || undefined;
      const edit = next[0]!;
      original.text = edit.text; original.editedAt = edit.timestamp; original.revision = edit.id;
      visited.add(edit.id);
    }
  }
  return originals.sort((a, b) => b.timestamp - a.timestamp || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
}

export function visibleStickies(items: Pick<TeamItems, 'stickies'>, teamId: string, scope: AssetKey | StickyScope, now = Date.now()): Sticky[] {
  return items.stickies.filter(item => item.teamId === teamId && item.expiresAt > now && stickyScopeMatches(item, scope));
}

/**
 * A page reference attached to a message: one thing every viewer can find again at any window size.
 * Addresses are found on every site of the asset; quotes only on their exact page.
 */
export type RefTarget =
  | { kind: 'address'; text: string }
  | { kind: 'quote'; exact: string; prefix: string; suffix: string };
/** A line quoted from a token's 弹幕: the ref's view is the token, `author` the room account, `at` when it was sent. Never a page target. */
export type DanmakuTarget = { kind: 'danmaku'; id: string; author: string; name: string; at: number };
export type PageRef = { target: RefTarget | DanmakuTarget; caption: string; view: Viewing };

export function readRefTarget(value: unknown): RefTarget | undefined {
  if (!value || typeof value !== 'object') return;
  const t = value as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (t.kind === 'address' && text(t.text, 64)) return { kind: 'address', text: t.text as string };
  if (t.kind === 'quote' && text(t.exact, 400) && Array.from(t.exact as string).length >= 2 && Array.from(t.exact as string).length <= 200 && typeof t.prefix === 'string' && Array.from(t.prefix).length <= 24 && typeof t.suffix === 'string' && Array.from(t.suffix).length <= 24) return { kind: 'quote', exact: t.exact as string, prefix: t.prefix, suffix: t.suffix };
}
/** A message reference target: a page target, or a quoted 弹幕 line. */
export function readMessageRefTarget(value: unknown): PageRef['target'] | undefined {
  const target = readRefTarget(value); if (target) return target;
  if (!value || typeof value !== 'object') return;
  const t = value as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (t.kind === 'danmaku' && text(t.id, 128) && text(t.author, 128) && typeof t.name === 'string' && Array.from(t.name).length <= 40 && typeof t.at === 'number' && Number.isFinite(t.at) && t.at > 0) return { kind: 'danmaku', id: t.id as string, author: t.author as string, name: t.name, at: t.at };
}
/** The caption is plain text written by the picker, or the quoted 弹幕 line; the asset view is validated by the caller. */
export function readRefCaption(value: unknown, target?: PageRef['target']) { return plain(value, target?.kind === 'danmaku' ? ROOM_TEXT_MAX : REF_CAPTION_MAX); }

/** The sender of the earliest asset card you can see; references and stickies do not count. */
export function firstSharer(messages: readonly Message[], asset: AssetKey) {
  return messages.filter(m => !m.recalled && m.status === 'sent' && m.attachment?.kind === 'asset' && viewAsset(m.attachment.view) === asset)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))[0];
}

export type Poke = { id: string; teamId: string; from: string; view: Viewing; at: number; count: number };
