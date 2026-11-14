import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { identifyPage,websiteIdentity } from '@palside/shared/navigation';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import type { RoomKey,RoomPerson } from '../../../runtime/rooms/contract-types';
import type { PageStatus } from '../../../runtime/browser/page-protocol';
import { resolveTokenMetadata } from '../../../runtime/viewing/token-name';
import { pageLabel } from '../../../runtime/viewing/page-title';
import { iconDataUrl } from '../../../runtime/viewing/viewing';
import { pageView } from '../../../runtime/viewing/view-snapshot';
import { tokenPage } from '../../../runtime/viewing/page-resolver';
import { tokenNamed } from '../../../runtime/viewing/token-profiles';
import { tokenStats,tokenView } from '../assets/token-data';
import type { Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/social';
import { danmakuOn } from '../../../domain/annotations/interaction';
import type { PalsideController } from '../app/use-palside';
import { errorMessage } from '@palside/i18n';
import { defaultTokenSite, tokenSites } from '../../../runtime/rooms/token-sites';
import { siteLogo } from '../settings/site-catalog';
import { setSocialUi } from '../annotations/social-state';
import { pageIssue } from '../feedback/page-issue';

/** 弹幕 is on (设置 › 网页互动 and its 弹幕 card); it needs the live runtime. Off, every way into it goes. */
export function roomsOn(c: PalsideController) { return Boolean(danmakuOn(c.siteInteraction)); }

/** The 弹幕 of a token the panel shows; pages that are not a confirmed token have none. */
export function roomKeyFor(view: Viewing | undefined): RoomKey | undefined {
  const asset = viewAsset(view);
  return asset ? roomKeyForAsset(asset) ?? undefined : undefined;
}

/** The active tab's token, as the panel names it. */
export function tabRoomKey(c: PalsideController) {
  const asset = c.live.page?.asset;
  return asset ? roomKeyForAsset(asset) ?? undefined : undefined;
}

/** People in a token's 弹幕 right now, from the one record of its public numbers; undefined when unknown. */
export function roomCount(c: PalsideController, key: RoomKey) { return tokenStats(c, key)?.count; }

/** The page the active tab shows as a Viewing: a token page parsed from its address, else the page itself. Draw it through `liveView`. */
export function tabView(page: PageStatus | undefined, asset?: string): Viewing | undefined {
  if (!page || asset && page.asset !== asset || !page.url || !page.host) return;
  const identity = identifyPage(page.url, [page.host]);
  // A pool or chainless contract page shows its token once the background reports it (`page.asset`).
  const lookup = identity?.kind === 'pool' || identity?.kind === 'address' ? identity : undefined;
  const source = identity?.kind === 'asset' ? identity : lookup && page.asset ? tokenPage(lookup, page.asset) : websiteIdentity(page.url, 'page');
  return source ? pageView(source, source.kind === 'asset' ? resolveTokenMetadata(source) : { name: pageLabel(page.title, page.host), logo: iconDataUrl(page.favicon) }, lookup && source.kind === 'asset' ? lookup.kind : undefined) : undefined;
}

/** A token by its room key, drawn from its one token record; a known view or the active tab supplies the page it opens. */
export function roomView(c: PalsideController, key: RoomKey): Viewing {
  const asset = key.slice('token:'.length);
  const views = c.data.views.filter(view => viewAsset(view) === asset);
  const base = views.find(view => tokenNamed(view)) ?? (c.live.page?.asset === asset ? tabView(c.live.page, asset) : undefined) ?? views[0];
  return tokenView(c, asset, base);
}

/** Members of any of my teams, for the green ring. */
export function teammateIds(c: PalsideController) {
  return new Set(c.teams.filter(team => team.joined).flatMap(team => team.memberIds).filter(id => id !== c.data.self));
}

/** Everyone the open 弹幕 can name: its faces, 在看的人, speakers, and the senders of its 红包. */
export function roomKnownPeople(c: PalsideController): RoomPerson[] {
  const rooms = c.live.state.rooms, current = rooms.current, chain = c.live.state.chainRoom;
  return [...current?.faces ?? [], ...rooms.people?.people ?? [], ...current?.messages.map(message => message.author) ?? [], ...chain && chain.key === current?.key ? chain.people ?? [] : []];
}

/** A room person as the panel draws people: teammates keep their own profile, avatar and presence. */
export function roomPerson(c: PalsideController, person: RoomPerson, fallback: string, mates = teammateIds(c)): Person & { mate: boolean } {
  const known = c.people.find(item => item.id === person.id);
  const mate = mates.has(person.id);
  if (known) return { ...known, walletAddress: known.walletAddress ?? person.wallet ?? undefined, mate };
  return { id: person.id, name: person.nickname || fallback, color: '#e5e6e9', avatar: c.live.state.rooms.avatars[person.id], walletAddress: person.wallet ?? undefined, mate };
}

/** The token 弹幕 follows, exactly as the runtime leases it: the active tab of the panel window the user last worked in, on an added site.
 *  Another window's panel gets none (`elsewhere`). */
export function followedTabRoomKey(c: PalsideController) {
  const rooms = c.live.state.rooms;
  return rooms && !rooms.elsewhere ? rooms.tab : undefined;
}

/** This panel's own tab shows a token that 弹幕 cannot follow because it follows another window. */
export function roomElsewhere(c: PalsideController) {
  return Boolean(c.live.state.rooms.elsewhere && c.live.page?.access.site && tabRoomKey(c) && !c.live.state.rooms.pinned);
}

/**
 * 弹幕 on: the chat area turns into one token's 弹幕 and the composer writes to it, until the 弹幕 key (or Esc on an empty field) hands
 * the panel back to the squad. One panel session; it never outlives the panel. `opening`: a token asked for from 热门, a card or 详情,
 * held while its room is pinned; `lap` / `lapped`: the 弹幕 key's arrival lap, once per token.
 */
const danmaku = { on: false, opening: undefined as RoomKey | undefined, lap: undefined as RoomKey | undefined, lapped: new Set<RoomKey>(), listeners: new Set<() => void>() };
export function updateDanmaku(next: Partial<Pick<typeof danmaku, 'on' | 'opening' | 'lap'>>) { Object.assign(danmaku, next); for (const listener of danmaku.listeners) listener(); }
function subscribeDanmaku(listener: () => void) { danmaku.listeners.add(listener); return () => { danmaku.listeners.delete(listener); }; }
export function useDanmakuState() {
  const on = useSyncExternalStore(subscribeDanmaku, () => danmaku.on, () => false);
  const opening = useSyncExternalStore(subscribeDanmaku, () => danmaku.opening, () => undefined);
  const lap = useSyncExternalStore(subscribeDanmaku, () => danmaku.lap, () => undefined);
  return { on, opening, lap };
}
/** The arrival lap runs once per token per panel session. */
export function firstVisit(key: RoomKey) { if (danmaku.lapped.has(key)) return false; danmaku.lapped.add(key); return true; }
export function lapRunning(key: RoomKey) { return danmaku.lap === key; }
/** While 弹幕 is on, the token it shows stays pinned across other screens (详情, 发红包, 在看的人). */
export function danmakuHoldsPin() { return danmaku.on; }

/** Turns 弹幕 on for the token the tab follows; the keyboard moves to the one composer field. */
export function openDanmaku() {
  updateDanmaku({ on: true });
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-message-input]')?.focus());
}
/** Leaves 弹幕 and hands the keyboard back to the squad field; a token opened from 热门 or a card is let go. */
export function closeDanmaku(c: PalsideController) {
  updateDanmaku({ on: false, opening: undefined });
  setSocialUi({ roomPacket: undefined });
  if (c.live.state.rooms.pinned) void c.live.command('room-close').catch(() => {});
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-message-input]')?.focus());
}

/** Opens a token's 弹幕 in the chat area from 热门, a token card, 详情 or the page: pinned unless it is the tab's own token. */
export function openRoom(c: PalsideController, key: RoomKey) {
  if (!roomsOn(c)) return;
  const rooms = c.live.state.rooms, followed = followedTabRoomKey(c) === key;
  setSocialUi({ roomPacket: undefined });
  updateDanmaku({ on: true, opening: followed || rooms.pinned === key ? undefined : key });
  c.go('chat');
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-message-input]')?.focus());
  if (followed) { if (rooms.pinned) void c.live.command('room-close').catch(() => {}); return; }
  if (rooms.pinned === key) return;
  void c.live.command('room-open', { key }).then(() => { if (danmaku.opening === key) updateDanmaku({ opening: undefined }); }, error => {
    if (danmaku.opening !== key) return;
    updateDanmaku({ on: false, opening: undefined });
    c.setNotice(errorMessage(error));
  });
}

/** The 弹幕 the composer and the chat area show: the token being opened, else the pinned one, else the one the tab follows; and its live room once loaded. */
export function useDanmaku(c: PalsideController) {
  const state = useDanmakuState();
  const shown = roomsOn(c);
  const rooms = c.live.state.rooms;
  const key = shown ? state.opening ?? rooms.pinned ?? followedTabRoomKey(c) : undefined;
  // 弹幕 is live server data only: without the service it holds no list or count that may be stale.
  const offline = Boolean(key) && Boolean(pageIssue(c, 'service'));
  const room = key && rooms.current?.key === key ? rooms.current : undefined;
  return { shown, key, room, offline, on: state.on && Boolean(key), lap: state.lap };
}

/** Drafts belong to the mounted panel account, including visits to other screens. */
export function useRoomDrafts(account: string) {
  const create = () => ({ account, values: new Map<string, string>(), sending: new Set<string>(), listeners: new Set<() => void>() });
  const [drafts, setDrafts] = useState(create);
  useLayoutEffect(() => () => { drafts.values.clear(); drafts.sending.clear(); drafts.listeners.clear(); }, [drafts]);
  if (drafts.account !== account) { const next = create(); setDrafts(next); return next; }
  return drafts;
}

export function useRoomRead(c: PalsideController, kind: 'summary' | 'people' | 'hot' | 'blocks' | 'invites', key?: string | null) {
  const command = c.live.command, account = c.data.self;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ command: typeof command; account: string; kind: typeof kind; key: typeof key; revision: number; status: 'loading' | 'error' | 'success' }>();
  useEffect(() => {
    let current = true;
    const hot = kind === 'hot', watched = kind === 'summary' || kind === 'people', ignore = () => {};
    if (!command || watched && !key) return;
    const update = (status: 'loading' | 'error' | 'success') => { if (current) setResult({ command, account, kind, key, revision, status }); };
    const read = async () => {
      if (hot) await command('room-hot', { open: true });
      else if (watched) {
        await command('room-watch', { id: kind, view: key! });
        if (!current) return;
        await command(kind === 'summary' ? 'room-summary' : 'room-people', { key: key! });
      } else if (kind === 'blocks') await command('room-blocks');
      else await command('invite-list');
    };
    void read().then(() => update('success'), () => update('error'));
    return () => {
      current = false;
      if (hot) void command('room-hot', { open: false }).catch(ignore);
      else if (watched) void command('room-watch', { id: kind }).catch(ignore);
    };
  }, [command, account, kind, key, revision]);
  let status = result && result.command === command && result.account === account && result.kind === kind && result.key === key && result.revision === revision ? result.status : 'loading';
  // A hot subscription acknowledgement does not contain a verified ranking.
  if (kind === 'hot' && status === 'success' && !c.live.state.rooms.hot?.loaded) status = 'loading';
  if (!command) status = 'success';
  return { status, retry: () => setRevision(value => value + 1) };
}

/** The sites that can show this token, and the one a single click uses: last used → the 弹幕's site → GMGN. */
export function tokenSiteChoice(c: PalsideController, view: Viewing, participantSite?: string | null) {
  const token = view.kind === 'asset' && view.chain && view.address ? { chain: view.chain, address: view.address } : undefined;
  if (!token) return { sites: [], site: undefined };
  const withLogo = <Site extends { id: string }>(site: Site) => ({ ...site, logo: siteLogo(site.id) });
  const site = defaultTokenSite(token, c.live.state.preferences.rooms?.site, participantSite);
  return { sites: tokenSites(token).map(withLogo), site: site && withLogo(site) };
}

/** Opens the token on a site the usual way (beside the panel, reusing an open tab) and makes that site the default. */
export function openTokenSite(c: PalsideController, site: { id: string; url: string }) {
  const live = c.live;
  void live.openPage(site.url).catch(error => c.setNotice(errorMessage(error)));
  if (live.state.preferences.rooms?.site !== site.id) void live.command('preferences', { accountId: c.data.self, rooms: { site: site.id } }).catch(() => {});
}
