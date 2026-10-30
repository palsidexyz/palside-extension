import { useFormattedTeams,useFormattedMessages,useCurrentMessages } from './use-panel-selectors';
import { livePanelData } from './live-data';
import { localeOrEnglish,type TextValue,message as uiMessage } from '@palside/i18n';
import { useLocale,useTranslations } from 'use-intl';
import { useTextState,useText } from '../ui/text';
import { usePreferences } from '../settings/use-preferences';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { defaultInteraction,emptyFavorites,readFavorites,readInteraction } from '../../../domain/annotations/interaction';
import { connectionStatus } from '../../../runtime/transport/connection';
import type { ReportTarget } from '../feedback/report';
import type { PublicTeam } from '@palside/shared/contracts/team-model';
import { lobbyWithMembership,requestIsActive } from '../../../domain/teams/lobby-values';
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import { emptyDraft,type Draft } from '../../../domain/chat/model';
import { type Screen } from './panel-model';
import { type Team } from '../../../domain/teams/model';
import { type Viewing } from '../../../domain/assets/model';
import type { PalsideProps } from './panel-props';
import { walletDeadlines } from '../wallet/clock';
const signedOutScreens: Screen[] = ['welcome', 'new-account', 'confirm-phrase', 'restore'];
const noTeam: Team = { id: '', name: '', description: '', owner: '', memberIds: [], joined: false, published: false, muted: false, unread: 0 };
/** An invite being joined from the join sheet; `blocked` when this account may not join it, with nothing about the team shown. */
export type JoinPrompt = { invite: string; team?: Pick<PublicTeam, 'id' | 'name' | 'description' | 'memberCount'>; lockedUntil?: number | null; passwordRequired?: boolean; blocked?: boolean };
export function usePanelState({ data: initialData, live, scenario = 'normal', sites, deliver, onboarding, adapter }: PalsideProps) {

  const text = useText();

  const t = useTranslations();

  const locale = localeOrEnglish(useLocale());

  const data = live?.state.data ?? initialData;

  const preferences = usePreferences(live);

  const initialTeam: Team = data.teams[0] ?? noTeam;

  const initialView = data.views[0];
  const { localPeople, setPeople, localTeams, setTeams, localMessages, setMessages, localAllRequests, setRequests, localCurrent, setCurrent, localInteraction, setLocalInteraction, localFavorites, setLocalFavorites, localDrafts, setDrafts, localWeb, setLocalWeb, localToggles, setLocalToggles, localSites, setLocalSites, localTokenOff, setLocalTokenOff, localOffline, setOffline, localViewingId, setViewingId } = adapter?.data ?? livePanelData({ data, scenario, initialTeam });

  const sourceTeams = live ? data.teams : localTeams;

  const formattedTeams = useFormattedTeams(sourceTeams, t);

  const forgotten = live?.state.preferences.forgottenTeams;

  // 删除本机记录 hides a read-only team for good; joining it again brings it back.
  const teams = useMemo(() => forgotten?.length ? formattedTeams.filter(team => team.joined || !forgotten.includes(team.id)) : formattedTeams, [formattedTeams, forgotten]);

  const isLive = Boolean(live);

  const lobbyTeams = live?.state.lobbyTeams;

  const discoveryTeams = useMemo(() => isLive ? lobbyWithMembership(lobbyTeams ?? [], teams) : teams, [isLive, lobbyTeams, teams]);

  const sourceMessages = live ? data.messages : localMessages;

  const today = new Date().setHours(0, 0, 0, 0);

  const messages = useFormattedMessages(sourceMessages, isLive, locale, today, t);

  const allRequests = live ? data.requests : localAllRequests;

  const [now, setNow] = useState(() => Date.now());
  const [localScreen, setScreenValue] = useState<Screen>(data.pendingInvite ? 'join' : 'chat');

  const requests = allRequests.filter(request => requestIsActive(request, now));

  useEffect(() => {
    const financial = walletDeadlines(live?.state, now);
    const deadlines = [...teams, ...discoveryTeams].flatMap(t => [t.recruitmentExpiresAt, t.applicationRetryAt, t.applicationExpiresAt]).concat(allRequests.map(r => r.expiresAt), Object.values(live?.state.invitations ?? {}).map(invite => invite.expiresAt ?? undefined), live?.state.publishedViewing?.expiresAt, financial)
      .filter((time): time is number => typeof time === 'number' && time > now);
    const refresh = () => setNow(Date.now());
    const timer = deadlines.length ? setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - Date.now()))) : undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [now, teams, discoveryTeams, allRequests, live?.state]);

  /** The screen each sub-screen was opened from, so 返回 retraces the user's own path. */
  const origins = useRef<Partial<Record<Screen, Screen>>>({});

  const [optimisticDrafts, setOptimisticDrafts] = useState<Record<string, { value: Draft; revision: number }>>({});

  const [draftConflicts, setDraftConflicts] = useState<Record<string, boolean>>({});

  const draftQueue = useRef(Promise.resolve());

  const blockedDrafts = useRef(new Set<string>());

  const draftVersions = useRef<Record<string, number>>({});

  const resolvingDrafts = useRef(new Set<string>());

  const draftRevisions = useRef<Record<string, number>>({});

  /** Read-only teams that may stay open: the one open at start, any seen joined (so one dissolved by others stays put), and any reopened. Leaving one yourself drops it. */
  const [keptTeams, setKeptTeams] = useState<ReadonlySet<string>>(() => new Set([live ? live.state.preferences.current : localCurrent]));
  const newlyJoined = teams.filter(team => team.joined && !keptTeams.has(team.id));
  if (newlyJoined.length) setKeptTeams(new Set([...keptTeams, ...newlyJoined.map(team => team.id)]));

  const preferred = live ? live.state.preferences.current : localCurrent;

  const preferredTeam = teams.find(team => team.id === preferred);

  // A team the user did not keep open falls back to a joined one, else to the 首页.
  const current = preferredTeam && (preferredTeam.joined || keptTeams.has(preferred)) ? preferred : teams.find(team => team.joined)?.id ?? '';

  // The password step comes before the device is registered, so it wins over the signed-out screens.
  const screen: Screen = live?.state.setup === 'password' ? 'password' : live && !live.state.authenticated ? (signedOutScreens.includes(localScreen) ? localScreen : 'welcome') : live && !live.state.account?.nickname ? 'nickname' : localScreen;
  const { ownsScreen, invalidateScreen } = useScreenOwnership(data.self, current, screen);
  const ownsAccessContext = useAccessOwnership(data.self, current, live?.page?.tabId, live?.page?.url);
  const ownsAccess = () => ownsAccessContext() && ownsScreen();
  const setScreen = useCallback((to: Screen) => { invalidateScreen(); setScreenValue(to); }, [invalidateScreen, setScreenValue]);

  const drafts = live ? Object.fromEntries([...new Set([...Object.keys(live.state.drafts), ...Object.keys(optimisticDrafts)])].map(id => { const saved = live.state.drafts[id]; const optimistic = optimisticDrafts[id]; return [id, optimistic && optimistic.revision > (saved?.revision ?? 0) ? optimistic.value : saved?.value ?? emptyDraft]; })) : localDrafts;

  const connection = live ? connectionStatus(live.state.connection) : localOffline ? 'network-offline' : 'connected';

  const disconnected = connection !== 'connected';

  const viewingId = live ? live.state.viewingId : localViewingId;

  const [selectedAsset, setSelectedAsset] = useState(initialView?.id ?? '');

  /** The page opened in 详情 when it is not one of the team's shared views (the open tab). */
  const [selectedView, setSelectedView] = useState<Viewing>();

  const [personId, setPersonId] = useState<string>();

  const [memberFilter, setMemberFilter] = useState<string>();

  const [selectingOwner, setSelectingOwner] = useState(false);

  const [query, setQuery] = useState('');

  const [lobbyLoading, setLobbyLoading] = useState(false);

  const [lobbyError, setLobbyError] = useTextState();

  const [recruitmentId, setRecruitmentId] = useState<string>();

  const [assetFilter, setAssetFilter] = useState<string>();

  const [phrase, setPhrase] = useState<string[]>([]);

  const [editing, setEditingValue] = useState<string>();
  const [editSessionId, setEditSessionId] = useState(0);
  const editSession = useRef({ id: 0, version: 0 });
  const setEditing = useCallback((id: string | undefined) => {
    editSession.current = { id: editSession.current.id + 1, version: 0 };
    setEditSessionId(editSession.current.id);
    setEditingValue(id);
  }, []);

  const [editRevision, setEditRevision] = useState(0);

  const [editText, setEditTextValue] = useState('');
  const setEditText = useCallback((text: string) => {
    editSession.current = { ...editSession.current, version: editSession.current.version + 1 };
    setEditTextValue(text);
  }, []);

  const [notice, setNoticeValue] = useState<{ text: TextValue; undo?: () => void }>({ text: '' });

  /** A one-line notice; with `undo` it carries 撤销 for the change it reports. */
  function setNotice(text: TextValue, undo?: () => void) { setNoticeValue({ text, undo }); }

  const [confirmation, setConfirmation] = useState<{ title: TextValue; description: TextValue; confirm: () => void | Promise<void>; action?: TextValue; danger?: boolean }>();

  const [sharedCategory, setSharedCategory] = useState<'assets' | 'images' | 'links'>('assets');

  const [reportTarget, setReportTarget] = useState<ReportTarget>();

  const [image, setImage] = useState<{ src: string; name: string }>();

  const [invitations, setInvitations] = useState<Record<string, { active: boolean; version: number; password?: string | null }>>({});

  const liveInvitation = live?.state.invitations[current];

  // The snapshot reports a suspension even when this panel still holds the link it read earlier.
  const inviteSuspended = live ? Boolean(live.state.remoteTeams.find(team => team.id === current)?.inviteSuspended || (liveInvitation?.suspended && !liveInvitation.active)) : false;

  const inviteActive = live ? Boolean(!inviteSuspended && liveInvitation?.active && liveInvitation.url && (liveInvitation.expiresAt ?? 0) > now) : invitations[current]?.active ?? true;

  const inviteVersion = invitations[current]?.version ?? 1;

  const invitePassword = (live ? liveInvitation?.password : invitations[current]?.password) ?? null;

  function setInviteActive(active: boolean) { setInvitations(old => ({ ...old, [current]: { ...old[current], active, version: old[current]?.version ?? 1 } })); }

  function setInviteVersion(update: (version: number) => number) { setInvitations(old => ({ ...old, [current]: { ...old[current], active: old[current]?.active ?? true, version: update(old[current]?.version ?? 1) } })); }

    const [joinPrompt, setJoinPrompt] = useState<JoinPrompt>();

  const [copied, setCopied] = useState(false);

  const [authBusy, setAuthBusy] = useState(false);

  const [localWorking, setLocalWorking] = useState(false);

  const [localFlow, setLocalFlow] = useState<'create' | 'restore'>('create');

  const { working, setWorking, flow, setFlow } = onboarding ?? { working: localWorking, setWorking: setLocalWorking, flow: localFlow, setFlow: setLocalFlow };

  const returnFocus = useRef<HTMLElement | null>(null);

  const pending = useRef(new Set<string>());

  const mounted = useRef(true);

  const objectUrls = useRef(new Set<string>());

  const team = teams.find(t => t.id === current) ?? noTeam;

  const draft = drafts[current] ?? emptyDraft;

  const draftConflict = Boolean(draftConflicts[current]);

  const viewing = data.views.find(v => v.id === viewingId);

  const currentMessages = useCurrentMessages(messages, current);

  const canWrite = team.joined && !team.readonly;

  // The preview has no tab: it acts on the site of the page being shared.
  const pageHost = live ? activeHost(live.page?.url) : activeHost(viewing?.url);

  const web = live ? preferences.values.web! : localWeb;

  const toggles = live ? live.state.toggles : localToggles;

  const tokenOff = live ? live.state.preferences.tokenOff ?? [] : localTokenOff;

  const people = (live ? data.people : localPeople).map(person => {
    const visible = !disconnected && team.joined && team.memberIds.includes(person.id);
    const self = person.id === data.self;
    const expiredOwn = live?.state.publishedViewing?.viewId === person.viewing && (live?.state.publishedViewing?.expiresAt ?? Infinity) <= now;
    // The preview shares the page it shows while 共享在看 is on.
    const viewId = self && !live ? web.share && toggles.share && team.joined && !team.readonly ? viewing?.id : undefined : person.viewing;
    return { ...person, name: person.deleted ? t('common.deletedMember') : person.name || t(self ? 'common.self' : 'common.member'), presence: visible ? person.presence : undefined, viewing: visible && !(self && expiredOwn) ? viewId : undefined };
  });

  const me = people.find(p => p.id === data.self) ?? { id: '', name: '', color: '#e9edf0' };

  useEffect(() => { mounted.current = true; const urls = objectUrls.current; return () => { mounted.current = false; urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);

  // The website hands over a team id; show its listing once the account is signed in.
  const openTeam = data.openTeam;
 const authenticated = Boolean(live?.state.authenticated && !live.state.setup && !working);

  const [handledTeam, setHandledTeam] = useState<string>();

  if (openTeam && authenticated && handledTeam !== openTeam) { setHandledTeam(openTeam); setRecruitmentId(openTeam); setScreenValue('recruitment'); }

  if (!openTeam && handledTeam) setHandledTeam(undefined);

  useEffect(() => { if (!notice.text) return; const timer = setTimeout(() => setNoticeValue({ text: '' }), notice.undo ? 6000 : 4500); return () => clearTimeout(timer); }, [notice]);

  // Owners hear once that wrong join passwords switched a link off; replacing the link clears it.
  const remoteTeams = live?.state.remoteTeams;

  const announcedSuspensions = useRef(new Set<string>());

  useEffect(() => {
    for (const team of remoteTeams ?? []) {
      if (!team.inviteSuspended) { announcedSuspensions.current.delete(team.id); continue; }
      if (announcedSuspensions.current.has(team.id)) continue;
      announcedSuspensions.current.add(team.id);
      setNotice(uiMessage('extension.dynamic.inviteSuspendedNotice', { name: team.name }));
    }
  }, [remoteTeams]);

  const interaction = live ? readInteraction(preferences.values.interaction) ?? defaultInteraction : localInteraction;

  const favorites = live ? readFavorites(preferences.values.favorites) ?? emptyFavorites : localFavorites;


  /** 网站详情: the site the page shows. */
  const [siteHost, setSiteHost] = useState('');
  return { view: { ownsScreen, ownsAccess, editSessionId, locale, data, setPeople, setTeams, setMessages, teams, discoveryTeams, messages, now, requests, current, screen, drafts, localSites, setOffline, setViewingId, connection, disconnected, viewingId, selectedAsset, selectedView, personId, setPersonId, memberFilter, setMemberFilter, selectingOwner, setSelectingOwner, query, setQuery, lobbyLoading, lobbyError, recruitmentId, setRecruitmentId, assetFilter, setAssetFilter, phrase, editing, setEditing, editText, setEditText, confirmation, setConfirmation, sharedCategory, setSharedCategory, reportTarget, setReportTarget, image, setImage, inviteSuspended, inviteActive, inviteVersion, invitePassword, joinPrompt, setJoinPrompt, copied, setCopied, authBusy, working, flow, objectUrls, team, draft, draftConflict, viewing, currentMessages, canWrite, pageHost, web, toggles, tokenOff, people, me, interaction, favorites, siteHost, setNotice, setInviteActive, setInviteVersion, live, scenario, sites }, text, t, preferences, setRequests, setCurrent, localScreen, setScreen, origins, setLocalInteraction, setLocalFavorites, setKeptTeams, setDrafts, setOptimisticDrafts, draftConflicts, setDraftConflicts, draftQueue, blockedDrafts, draftVersions, resolvingDrafts, draftRevisions, setLocalWeb, setLocalToggles, setLocalSites, setLocalTokenOff, setSelectedAsset, setSelectedView, setLobbyLoading, setLobbyError, setPhrase, editSession, editRevision, setEditRevision, notice, setInvitations, setAuthBusy, setWorking, setFlow, returnFocus, pending, mounted, openTeam, authenticated, setSiteHost, deliver };
}
export type PanelState = ReturnType<typeof usePanelState>;

function useAccessOwnership(accountId: string, teamId: string, tabId: number | undefined, url: string | undefined) {
  const context = useMemo(() => ({ accountId, teamId, tabId, url }), [accountId, teamId, tabId, url]);
  const active = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { active.current = context; return () => { active.current = undefined; }; }, [context]);
  return () => active.current === context;
}

function useScreenOwnership(accountId: string, teamId: string, screen: Screen) {
  const [version, setVersion] = useState(0);
  const active = useRef<object | undefined>(undefined);
  const owner = useMemo(() => ({ accountId, teamId, screen, version }), [accountId, teamId, screen, version]);
  useLayoutEffect(() => { active.current = owner; return () => { active.current = undefined; }; }, [owner]);
  const invalidateScreen = useCallback(() => { active.current = undefined; setVersion(value => value + 1); }, []);
  return { ownsScreen: () => active.current === owner, invalidateScreen };
}


/** The exact host of a web page's address, or nothing for browser pages and addresses that cannot be listed. */
function activeHost(url: string | undefined) {
  if (!url) return;
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? normalizeSiteHost(parsed.hostname) : undefined; } catch { return; }
}
