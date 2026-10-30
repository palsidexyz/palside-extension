import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { identifyPage,tokenPageUrl,websiteIdentity } from '@palside/shared/navigation';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import type { RoomKey,RoomPerson,RoomProfile } from '../../../runtime/rooms/contract-types';
import { siteById } from '@palside/shared/sites';
import type { PageStatus } from '../../../runtime/browser/page-protocol';
import { resolveTokenMetadata } from '../../../runtime/viewing/token-page';
import { pageName } from '../../../runtime/viewing/page-title';
import { pageFavicon } from '../../../runtime/viewing/viewing';
import { pageView } from '../../../runtime/viewing/view-snapshot';
import type { Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/social';
import type { PalsideController } from '../app/use-palside';

/** 参与弹幕 is on unless switched off in 设置 › 弹幕; it needs the live runtime. */
export function roomsOn(c: PalsideController) { return Boolean(c.live && !c.live.state.preferences.rooms?.off); }

/** The 弹幕 of a token the panel shows; pages that are not a confirmed token have none. */
export function roomKeyFor(view: Viewing | undefined): RoomKey | undefined {
  const asset = viewAsset(view);
  return asset ? roomKeyForAsset(asset) ?? undefined : undefined;
}

/** The active tab's token, as the panel names it. */
export function tabRoomKey(c: PalsideController) {
  const asset = c.live?.page?.asset;
  return asset ? roomKeyForAsset(asset) ?? undefined : undefined;
}

/** People in a token's 弹幕 right now, from the live room or the last summary; 0 when unknown. */
export function roomCount(c: PalsideController, key: RoomKey) {
  const rooms = c.live?.state.rooms;
  return rooms?.current?.key === key ? rooms.current.count : rooms?.summaries[key]?.count ?? Object.values(rooms?.hot ?? {}).flatMap(hot => hot.top).find(row => row.key === key)?.count ?? 0;
}

/** The page the active tab shows as a Viewing: a token page parsed from its address, else the page itself. */
export function tabView(page: PageStatus | undefined, asset?: string): Viewing | undefined {
  if (!page || asset && page.asset !== asset || !page.url || !page.host) return;
  const identity = identifyPage(page.url, [page.host]);
  const source = identity?.kind === 'asset' ? identity : websiteIdentity(page.url, 'page');
  return source ? pageView(source, source.kind === 'asset' ? resolveTokenMetadata(source) : { name: pageName(page.title, page.host), logo: pageFavicon(page.favicon) }) : undefined;
}

/** A token by its room key: the panel's own view of it when it has one, else one drawn from the service's profile. */
export function roomView(c: PalsideController, key: RoomKey, profile?: RoomProfile | null): Viewing {
  const [, chain = '', address = ''] = key.split(':');
  const asset = `${chain}:${address}`;
  const known = c.data.views.find(view => viewAsset(view) === asset) ?? (c.live?.page?.asset === asset ? tabView(c.live.page, asset) : undefined);
  if (known) return known;
  const site = profile?.site ? siteById(profile.site) : undefined;
  const name = profile?.name || `${address.slice(0, 4)}…${address.slice(-4)}`;
  const url = site && tokenPageUrl(site.id, chain, address);
  return { id: asset, kind: 'asset', name, chain, address, source: site?.name ?? '', url: url || '', color: '#e5e6e9', glyph: name.slice(0, 1).toUpperCase(), ...profile?.logo ? { logo: profile.logo } : {} };
}

/** Members of any of my teams, for the green ring. */
export function teammateIds(c: PalsideController) {
  return new Set(c.teams.filter(team => team.joined).flatMap(team => team.memberIds).filter(id => id !== c.data.self));
}

/** A room person as the panel draws people: teammates keep their own profile, avatar and presence. */
export function roomPerson(c: PalsideController, person: RoomPerson, fallback: string, mates = teammateIds(c)): Person & { mate: boolean } {
  const known = c.people.find(item => item.id === person.id);
  const mate = mates.has(person.id);
  if (known) return { ...known, mate };
  return { id: person.id, name: person.nickname || fallback, color: '#e5e6e9', avatar: c.live?.state.rooms.avatars[person.id], mate };
}

type Opening = { key: RoomKey; status: 'opening' | 'error'; profile?: { name: string; logo?: string; site: string } };
type RoomSession = { opening?: Opening; current?: PalsideController; navigation: object; listeners: Set<() => void> };
// The stable panel state setter identifies one mounted account session.
const sessions = new WeakMap<PalsideController['setPersonId'], RoomSession>();
function roomSession(c: PalsideController) {
  let session = sessions.get(c.setPersonId);
  if (!session) { session = { navigation: {}, listeners: new Set() }; sessions.set(c.setPersonId, session); }
  return session;
}
function publishOpening(session: RoomSession, opening?: Opening) {
  session.opening = opening;
  for (const listener of session.listeners) listener();
}

/** Opens the requested token while its pinned snapshot travels to the panel. */
export function openRoom(c: PalsideController, key: RoomKey, profile?: Opening['profile']) {
  if (!c.live || !roomsOn(c)) return;
  const session = roomSession(c), opening: Opening = { key, profile, status: 'opening' };
  session.navigation = {};
  publishOpening(session, opening);
  c.go('room');
  if (c.live.state.rooms.pinned !== key) void c.live.command('room-open', { key, ...profile ? { profile } : {} }).catch(() => {
    if (session.opening === opening) publishOpening(session, { ...opening, status: 'error' });
  });
}

function updateRoomController(session: RoomSession, c?: PalsideController) { session.current = c; }
function releaseRoomSession(session: RoomSession, identity: PalsideController['setPersonId']) {
  session.current = undefined; session.navigation = {}; publishOpening(session); sessions.delete(identity);
}

export function useRoomOpening(c: PalsideController) {
  const session = roomSession(c);
  const opening = useSyncExternalStore(listener => { session.listeners.add(listener); return () => { session.listeners.delete(listener); }; }, () => session.opening, () => session.opening);
  const pinned = c.live?.state.rooms.pinned, on = roomsOn(c);
  useLayoutEffect(() => { updateRoomController(session, c); });
  useLayoutEffect(() => {
    if (c.screen !== 'room' || !on || opening?.status === 'opening' && pinned === opening.key) publishOpening(session);
  }, [session, c.screen, on, opening, pinned]);
  useLayoutEffect(() => {
    sessions.set(c.setPersonId, session);
    return () => releaseRoomSession(session, c.setPersonId);
  }, [session, c.setPersonId]);
  return opening;
}

/** A quote may return only from the room and navigation that initiated it. */
export function roomQuoteReturn(c: PalsideController, key: RoomKey) {
  const session = roomSession(c), navigation = session.navigation;
  const owns = () => c.ownsScreen() && session.navigation === navigation && session.current?.screen === 'room' && session.current.live?.state.rooms.pinned === key;
  return {
    owns,
    back: () => {
      if (!owns()) return;
      void c.run('room-close'); c.go('chat');
      requestAnimationFrame(() => {
        const current = session.current;
        if (session.navigation === navigation && current?.screen === 'chat' && current.data.self === c.data.self && current.current === c.current) document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')?.focus();
      });
    },
  };
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
  const command = c.live?.command, account = c.data.self;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ command: typeof command; account: string; kind: typeof kind; key: typeof key; revision: number; status: 'loading' | 'error' | 'success' }>();
  useEffect(() => {
    let current = true;
    const hot = kind === 'hot', watched = kind === 'summary' || kind === 'people', ignore = () => {};
    if (!command || watched && !key) return;
    const update = (status: 'loading' | 'error' | 'success') => { if (current) setResult({ command, account, kind, key, revision, status }); };
    const read = async () => {
      if (hot) await command('room-hot', { chain: key ?? null });
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
      if (hot) void command('room-hot', {}).catch(ignore);
      else if (watched) void command('room-watch', { id: kind }).catch(ignore);
    };
  }, [command, account, kind, key, revision]);
  let status = result && result.command === command && result.account === account && result.kind === kind && result.key === key && result.revision === revision ? result.status : 'loading';
  // A hot subscription acknowledgement does not contain a verified ranking.
  if (kind === 'hot' && status === 'success' && !c.live?.state.rooms.hot?.[key ?? '']) status = 'loading';
  if (!command) status = 'success';
  return { status, retry: () => setRevision(value => value + 1) };
}
