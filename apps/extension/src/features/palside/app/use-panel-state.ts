import { useFormattedTeams,useFormattedMessages,useCurrentMessages } from './use-panel-selectors';
import { localeOrEnglish,type TextValue,message as uiMessage } from '@palside/i18n';
import { useLocale,useTranslations } from 'use-intl';
import { useTextState,useText } from '../ui/text';
import { usePreferences } from '../settings/use-preferences';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { emptyFavorites,readFavorites,readSiteInteractions } from '../../../domain/annotations/interaction';
import { connectionStatus } from '../../../runtime/transport/connection';
import type { ReportTarget } from '../feedback/report';
import type { PublicTeam } from '@palside/shared/contracts/team-model';
import { lobbyWithMembership,requestIsActive } from '../../../domain/teams/lobby-values';
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import { toast } from '@palside/ui/toast';
import { emptyDraft,type Draft } from '../../../domain/chat/model';
import { signedOutScreens, type Screen } from './panel-model';
import { type Team } from '../../../domain/teams/model';
import { type Viewing } from '../../../domain/assets/model';
import type { OnboardingFlow, PalsideProps, Working } from './panel-props';
import { siteCatalog } from '../settings/site-catalog';
import { walletDeadlines } from '../wallet/clock';
import { imageExpiry } from '../../../runtime/chat/message-expiry';
const noTeam: Team = { id: '', name: '', description: '', owner: '', memberIds: [], joined: false, published: false, muted: false, unread: 0 };
/** An invite being joined from the join sheet; `blocked` when this account may not join it, with nothing about the team shown. */
export type JoinPrompt = { invite: string; team?: Pick<PublicTeam, 'id' | 'name' | 'description' | 'memberCount'>; lockedUntil?: number | null; passwordRequired?: boolean; blocked?: boolean };
export function usePanelState({ live, onboarding }: PalsideProps) {

  const sites = siteCatalog;

  const text = useText();

  const t = useTranslations();

  const locale = localeOrEnglish(useLocale());

  const data = live.state.data;

  const preferences = usePreferences(live);

  const initialView = data.views[0];

  const formattedTeams = useFormattedTeams(data.teams, t);

  const forgotten = live.state.preferences.forgottenTeams;

  // 删除本机记录 hides a read-only team for good; joining it again brings it back.
  const teams = useMemo(() => forgotten?.length ? formattedTeams.filter(team => team.joined || !forgotten.includes(team.id)) : formattedTeams, [formattedTeams, forgotten]);

  const lobbyTeams = live.state.lobbyTeams;

  const discoveryTeams = useMemo(() => lobbyWithMembership(lobbyTeams ?? [], teams), [lobbyTeams, teams]);

  const today = new Date().setHours(0, 0, 0, 0);

  const messages = useFormattedMessages(data.messages, locale, today, t);

  const allRequests = data.requests;

  const [now, setNow] = useState(() => Date.now());
  const [localScreen, setScreenValue] = useState<Screen>(data.pendingInvite ? 'join' : 'chat');

  const requests = allRequests.filter(request => requestIsActive(request, now));

  useEffect(() => {
    const financial = walletDeadlines(live.state, now);
    const deadlines = [...teams, ...discoveryTeams].flatMap(t => [t.recruitmentExpiresAt, t.applicationRetryAt, t.applicationExpiresAt]).concat(allRequests.map(r => r.expiresAt), live.state.data.messages.map(message => message.attachment?.kind === 'image' && message.attachment.src ? imageExpiry(message, Infinity) : undefined), Object.values(live.state.invitations).map(invite => invite.expiresAt ?? undefined), live.state.publishedViewing?.expiresAt, financial)
      .filter((time): time is number => typeof time === 'number' && time > now);
    const refresh = () => setNow(Date.now());
    const timer = deadlines.length ? setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - Date.now()))) : undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [now, teams, discoveryTeams, allRequests, live.state]);

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
  const [keptTeams, setKeptTeams] = useState<ReadonlySet<string>>(() => new Set([live.state.preferences.current]));
  const newlyJoined = teams.filter(team => team.joined && !keptTeams.has(team.id));
  if (newlyJoined.length) setKeptTeams(new Set([...keptTeams, ...newlyJoined.map(team => team.id)]));

  const preferred = live.state.preferences.current;

  const preferredTeam = teams.find(team => team.id === preferred);

  // A team the user did not keep open falls back to a joined one, else to the 首页.
  const current = preferredTeam && (preferredTeam.joined || keptTeams.has(preferred)) ? preferred : teams.find(team => team.joined)?.id ?? '';

  // The password step comes before the device is registered, so it wins over the signed-out screens.
  const screen: Screen = live.state.setup === 'password' ? 'password' : !live.state.authenticated ? (signedOutScreens.includes(localScreen) ? localScreen : 'welcome') : !live.state.account?.nickname ? 'nickname' : localScreen;
  const { ownsScreen, invalidateScreen } = useScreenOwnership(data.self, current, screen);
  const ownsAccessContext = useAccessOwnership(data.self, current, live.page?.tabId, live.page?.url);
  const ownsAccess = () => ownsAccessContext() && ownsScreen();
  const setScreen = useCallback((to: Screen) => { invalidateScreen(); setScreenValue(to); }, [invalidateScreen, setScreenValue]);

  const drafts = Object.fromEntries([...new Set([...Object.keys(live.state.drafts), ...Object.keys(optimisticDrafts)])].map(id => { const saved = live.state.drafts[id]; const optimistic = optimisticDrafts[id]; return [id, optimistic && optimistic.revision > (saved?.revision ?? 0) ? optimistic.value : saved?.value ?? emptyDraft]; }));

  const connection = connectionStatus(live.state.connection);

  const disconnected = connection !== 'connected';

  const viewingId = live.state.viewingId;

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

  const localToasts = useRef(new Set<string>());

  /** A one-line notice; with `undo` it carries 撤销 for the change it reports. An empty value clears this panel's own notices. */
  const undoLabel = t('extension.sites.undo');
  const toastText = useRef({ text, undoLabel });
  useLayoutEffect(() => { toastText.current = { text, undoLabel }; });
  const setNotice = useCallback((value: TextValue, undo?: () => void) => {
    const toasts = localToasts.current;
    if (!value) { toasts.forEach(id => toast.dismiss(id)); toasts.clear(); return; }
    const id = toastText.current.text(value);
    const forget = () => { toasts.delete(id); };
    toasts.add(id);
    toast(id, { id, duration: undo ? 6000 : 4500, action: undo ? { label: toastText.current.undoLabel, onClick: undo } : undefined, onDismiss: forget, onAutoClose: forget });
  }, []);

  const [confirmation, setConfirmation] = useState<{ title: TextValue; description: TextValue; confirm: () => void | Promise<void>; action?: TextValue; danger?: boolean }>();

  const [sharedCategory, setSharedCategory] = useState<'messages' | 'assets' | 'images' | 'links'>('messages');

  const [reportTarget, setReportTarget] = useState<ReportTarget>();

  const [image, setImage] = useState<{ src: string; name: string }>();

  const liveInvitation = live.state.invitations[current];

  // The snapshot reports a suspension even when this panel still holds the link it read earlier.
  const inviteSuspended = Boolean(live.state.remoteTeams.find(team => team.id === current)?.inviteSuspended || (liveInvitation?.suspended && !liveInvitation.active));

  const inviteActive = Boolean(!inviteSuspended && liveInvitation?.active && liveInvitation.url && (liveInvitation.expiresAt ?? 0) > now);

  const invitePassword = liveInvitation?.password ?? null;

  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt>();

  const [copied, setCopied] = useState(false);

  const [authBusy, setAuthBusy] = useState(false);

  const [localWorking, setLocalWorking] = useState<Working>(false);

  const [localFlow, setLocalFlow] = useState<OnboardingFlow>('create');

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

  const pageHost = activeHost(live.page?.url);

  const share = Boolean(live.state.preferences.share);
  const people = data.people.map(person => {
    const visible = !disconnected && team.joined && team.memberIds.includes(person.id);
    const self = person.id === data.self;
    const expiredOwn = live.state.publishedViewing?.viewId === person.viewing && (live.state.publishedViewing?.expiresAt ?? Infinity) <= now;
    const viewId = person.viewing;
    return { ...person, name: person.deleted ? t('common.deletedMember') : person.name || t(self ? 'common.self' : 'common.member'), presence: visible ? person.presence : undefined, viewing: visible && !(self && expiredOwn) ? viewId : undefined };
  });

  const me = people.find(p => p.id === data.self) ?? { id: '', name: '', color: '#e9edf0', walletAddress: undefined as string | undefined };

  useEffect(() => { mounted.current = true; const urls = objectUrls.current; return () => { mounted.current = false; urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);

  // The website hands over a team id; show its listing once the account is signed in.
  const openTeam = data.openTeam;
  const authenticated = Boolean(live.state.authenticated && !live.state.setup && !working);

  const [handledTeam, setHandledTeam] = useState<string>();

  if (openTeam && authenticated && handledTeam !== openTeam) { setHandledTeam(openTeam); setRecruitmentId(openTeam); setScreenValue('recruitment'); }

  if (!openTeam && handledTeam) setHandledTeam(undefined);


  // Owners hear once that wrong join passwords switched a link off; replacing the link clears it.
  const remoteTeams = live.state.remoteTeams;

  const announcedSuspensions = useRef(new Set<string>());

  useEffect(() => {
    for (const team of remoteTeams) {
      if (!team.inviteSuspended) { announcedSuspensions.current.delete(team.id); continue; }
      if (announcedSuspensions.current.has(team.id)) continue;
      announcedSuspensions.current.add(team.id);
      setNotice(uiMessage('extension.dynamic.inviteSuspendedNotice', { name: team.name }));
    }
  }, [remoteTeams, setNotice]);

  const siteInteraction = readSiteInteractions(preferences.values.siteInteraction) ?? {};

  const favorites = readFavorites(preferences.values.favorites) ?? emptyFavorites;


  /** 网站详情: the site the page shows. */
  const [siteHost, setSiteHost] = useState('');
  return { view: { ownsScreen, ownsAccess, editSessionId, locale, data, teams, discoveryTeams, messages, now, requests, current, screen, drafts, connection, disconnected, viewingId, selectedAsset, selectedView, personId, setPersonId, memberFilter, setMemberFilter, selectingOwner, setSelectingOwner, query, setQuery, lobbyLoading, lobbyError, recruitmentId, setRecruitmentId, phrase, editing, setEditing, editText, setEditText, confirmation, setConfirmation, sharedCategory, setSharedCategory, reportTarget, setReportTarget, image, setImage, inviteSuspended, inviteActive, invitePassword, joinPrompt, setJoinPrompt, copied, setCopied, authBusy, working, flow, objectUrls, team, draft, draftConflict, viewing, currentMessages, canWrite, pageHost, share, people, me, siteInteraction, favorites, siteHost, setNotice, live, sites }, text, t, preferences, localScreen, setScreen, origins, setKeptTeams, setOptimisticDrafts, draftConflicts, setDraftConflicts, draftQueue, blockedDrafts, draftVersions, resolvingDrafts, draftRevisions, setSelectedAsset, setSelectedView, setLobbyLoading, setLobbyError, setPhrase, editSession, editRevision, setEditRevision, setAuthBusy, setWorking, setFlow, returnFocus, pending, mounted, openTeam, authenticated, setSiteHost };
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
