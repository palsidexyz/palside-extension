import { shortAddress,tokenPageUrl } from '@palside/shared/navigation';
import { siteById } from '@palside/shared/sites';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/interaction';
import { tokenNamed,withProfile } from '../../../runtime/viewing/token-profiles';
import type { RoomKey,RoomPerson,RoomStance } from '../../../runtime/rooms/contract-types';
import type { PalsideController } from '../app/use-palside';

type Live = Pick<PalsideController, 'live'>;

/**
 * One record per token: every surface draws a token's name and icon from the runtime's token record
 * (page read > teammates and messages > 弹幕 service), falling back to the view's own snapshot.
 * Cards, 详情, 弹幕, 热门, 在看 and titles therefore always agree.
 */
export function liveView<T extends Viewing>(c: Live, view: T): T {
  return view.kind === 'asset' ? withProfile(view, c.live?.state.tokens?.[viewAsset(view) ?? '']) : view;
}

/** A token by asset (`chain:address`), with `base` supplying the page identity when one is known. */
export function tokenView(c: Live & Pick<PalsideController, 'data'>, asset: string, base?: Viewing): Viewing {
  const record = c.live?.state.tokens?.[asset];
  const known = base ?? c.data.views.find(view => viewAsset(view) === asset && tokenNamed(view)) ?? c.data.views.find(view => viewAsset(view) === asset);
  if (known) return liveView(c, known);
  const [chain = '', address = ''] = [asset.slice(0, asset.indexOf(':')), asset.slice(asset.indexOf(':') + 1)];
  const site = record?.site ? siteById(record.site) : undefined;
  const url = site && tokenPageUrl(site.id, chain, address);
  const name = record?.name ?? shortAddress(address);
  return { id: asset, kind: 'asset', name, chain, address, source: site?.name ?? '', url: url || '', color: '#e5e6e9', glyph: record ? name.slice(0, 1).toUpperCase() : '?', ...record?.logo ? { logo: record.logo } : {} };
}

export type TokenStats = { count: number; stance: RoomStance; faces: RoomPerson[] };
/** A token's public 弹幕 numbers: the open room once loaded, else its latest summary, else its 热门 row; undefined when unknown. */
export function tokenStats(c: Live, key: RoomKey): TokenStats | undefined {
  const rooms = c.live?.state.rooms;
  if (rooms?.current?.key === key && !rooms.current.loading) return rooms.current;
  const summary = rooms?.summaries[key]; if (summary) return summary;
  const row = rooms?.hot?.rows.find(item => item.key === key);
  return row ? { count: row.count, stance: { ...row.stance, mine: null }, faces: row.faces } : undefined;
}
