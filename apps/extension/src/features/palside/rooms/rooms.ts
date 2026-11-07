import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { identifyPage,websiteIdentity } from '@palside/shared/navigation';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import type { RoomKey,RoomPerson } from '../../../runtime/rooms/contract-types';
import type { PageStatus } from '../../../runtime/browser/page-protocol';
import { resolveTokenMetadata } from '../../../runtime/viewing/token-name';
import { pageName } from '../../../runtime/viewing/page-title';
import { pageFavicon } from '../../../runtime/viewing/viewing';
import { pageView } from '../../../runtime/viewing/view-snapshot';
import { tokenPage } from '../../../runtime/viewing/page-resolver';
import { tokenNamed } from '../../../runtime/viewing/token-profiles';
import { tokenStats,tokenView } from '../assets/token-data';
import type { Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/social';
import type { PalsideController } from '../app/use-palside';
import { errorMessage } from '@palside/i18n';
import { defaultTokenSite, tokenSites } from '../../../runtime/rooms/token-sites';
import { siteLogo } from '../settings/site-catalog';

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

/** People in a token's 弹幕 right now, from the one record of its public numbers; undefined when unknown. */
export function roomCount(c: PalsideController, key: RoomKey) { return tokenStats(c, key)?.count; }

/** The page the active tab shows as a Viewing: a token page parsed from its address, else the page itself. Draw it through `liveView`. */
export function tabView(page: PageStatus | undefined, asset?: string): Viewing | undefined {
  if (!page || asset && page.asset !== asset || !page.url || !page.host) return;
  const identity = identifyPage(page.url, [page.host]);
  // A pool or chainless contract page shows its token once the background reports it (`page.asset`).
  const lookup = identity?.kind === 'pool' || identity?.kind === 'address' ? identity : undefined;
  const source = identity?.kind === 'asset' ? identity : lookup && page.asset ? tokenPage(lookup, page.asset) : websiteIdentity(page.url, 'page');
  return source ? pageView(source, source.kind === 'asset' ? resolveTokenMetadata(source) : { name: pageName(page.title, page.host), logo: pageFavicon(page.favicon) }, lookup && source.kind === 'asset' ? lookup.kind : undefined) : undefined;
}

/** A token by its room key, drawn from its one token record; a known view or the active tab supplies the page it opens. */
export function roomView(c: PalsideController, key: RoomKey): Viewing {
  const asset = key.slice('token:'.length);
  const views = c.data.views.filter(view => viewAsset(view) === asset);
  const base = views.find(view => tokenNamed(view)) ?? (c.live?.page?.asset === asset ? tabView(c.live.page, asset) : undefined) ?? views[0];
  return tokenView(c, asset, base);
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

type Opening = { key: RoomKey; status: 'opening' | 'error' };
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

/** Opens the requested token in the 弹幕 tab, pinned, while its snapshot travels to the panel. */
export function openRoom(c: PalsideController, key: RoomKey) {
  if (!c.live || !roomsOn(c)) return;
  const session = roomSession(c), opening: Opening = { key, status: 'opening' };
  session.navigation = {};
  publishOpening(session, opening);
  c.go('room');
  if (c.live.state.rooms.pinned !== key) void c.live.command('room-open', { key }).catch(() => {
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

/** The token being opened, before its room arrives: read only, for labels that must not wait for the service. */
export function useOpeningKey(c: PalsideController) {
  const session = roomSession(c);
  return useSyncExternalStore(listener => { session.listeners.add(listener); return () => { session.listeners.delete(listener); }; }, () => session.opening?.key, () => session.opening?.key);
}

/** The active tab's token as 弹幕 follows it: only where Chrome allows the site, which is where the background joins its room. */
export function followedTabRoomKey(c: PalsideController) {
  return c.live?.page?.access.site ? tabRoomKey(c) : undefined;
}

/** The token the 弹幕 tab shows: the one being opened, else the pinned one, else the token it follows on the active tab; none elsewhere. */
export function useShownRoomKey(c: PalsideController) {
  const opening = useOpeningKey(c);
  return opening ?? c.live?.state.rooms.pinned ?? followedTabRoomKey(c);
}

/** A quote may return only from the room and navigation that initiated it. */
export function roomQuoteReturn(c: PalsideController, key: RoomKey) {
  const session = roomSession(c), navigation = session.navigation;
  const owns = () => c.ownsScreen() && session.navigation === navigation && session.current?.screen === 'room' && session.current.live?.state.rooms.current?.key === key;
  return {
    owns,
    back: () => {
      if (!owns()) return;
      // The 弹幕 tab keeps its token: the quote only moves to the chat beside it.
      c.go('chat');
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
  if (kind === 'hot' && status === 'success' && !c.live?.state.rooms.hot?.loaded) status = 'loading';
  if (!command) status = 'success';
  return { status, retry: () => setRevision(value => value + 1) };
}

/** The sites that can show this token, and the one a single click uses: last used → the 弹幕's site → GMGN. */
export function tokenSiteChoice(c: PalsideController, view: Viewing, participantSite?: string | null) {
  const token = view.kind === 'asset' && view.chain && view.address ? { chain: view.chain, address: view.address } : undefined;
  if (!token) return { sites: [], site: undefined };
  const withLogo = <Site extends { id: string }>(site: Site) => ({ ...site, logo: siteLogo(site.id) });
  const site = defaultTokenSite(token, c.live?.state.preferences.rooms?.site, participantSite);
  return { sites: tokenSites(token).map(withLogo), site: site && withLogo(site) };
}

/** Opens the token on a site the usual way (beside the panel, reusing an open tab) and makes that site the default. */
export function openTokenSite(c: PalsideController, site: { id: string; url: string }) {
  const live = c.live;
  if (!live) { window.open(site.url, '_blank', 'noopener'); return; }
  void live.openPage(site.url).catch(error => c.setNotice(errorMessage(error)));
  if (live.state.preferences.rooms?.site !== site.id) void live.command('preferences', { accountId: c.data.self, rooms: { site: site.id } }).catch(() => {});
}
