'use client';
import { errorMessage, type TextValue, message as uiMessage } from '@palside/i18n';

import { useText } from '../ui/text';

import { useTranslations } from 'use-intl';
import { useAppearance } from '../settings/appearance';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '@palside/ui/dialog';
import { Toaster, toast } from '@palside/ui/toast';
import { ImageEditor } from '../media/image-editor';
import { usePalside, type PalsideProps } from './use-palside';
import { PersonCard } from '../account/person-card';
import { PaymentSheet, usePaymentSession } from '../wallet/payment-sheet';
import { teamDefaultAvatars, TeamPortraits } from '../account/default-avatar';
import { SocialSession, captureSocialUi } from '../annotations/social-state';
import { NoteSheet } from '../annotations/sticky-list';
import { AllSitesSheet, GrantSheet, SitePicker } from '../settings/access-sheet';
import { ReadSheet } from '../settings/privacy';
import { Chat } from '../chat/chat';
import { DanmakuView, InviteSheet, RoomPersonSheet } from '../rooms/danmaku-view';
import { panelTabsShown } from './panel-tabs';
import { ChatHeader } from '../chat/chat-header';
import { openRoom } from '../rooms/rooms';
import { Onboarding, onboardingScreens } from '../account/onboarding';
const Panels = lazy(() => import('./panels').then(module => ({ default: module.Panels })));
import { JoinSheet, TeamStart } from '../teams/team-start';
import { ConnectionEmpty } from '../feedback/connection-empty';
import { siteForUrl, SiteDirectoryContext } from '../settings/site-catalog';
import { FirstRunTour } from './first-run-tour';
import type { Working } from './panel-props';
import s from './palside.module.css';

export function PalsideApp(props: PalsideProps) {
  const [working, setWorking] = useState<Working>(false);
  const [flow, setFlow] = useState<'create' | 'restore'>('create');
  const accountId = props.live ? props.live.state.account?.id ?? 'signed-out' : props.data.self;
  return <SocialSession key={`${accountId}:${props.live?.state.authenticated ?? 'preview'}`} accountId={accountId}><PalsideSession {...props} onboarding={{ working, setWorking, flow, setFlow }} /></SocialSession>;
}

function PalsideSession(props: PalsideProps) {
  const t = useTranslations();
  const text = useText();
  const root = useRef<HTMLElement>(null);
  const [jumpOrigin, setJumpOrigin] = useState<{ screen: 'search'; scrollTop: number; teamId: string }>();
  const c = usePalside(props);
  usePaymentSession(c.live?.state.authenticated ? c.live.state.account?.id : undefined);
  const appearance = useAppearance();
  const incomingInvite = c.data.pendingInvite;
  const [observedInvite, setObservedInvite] = useState(incomingInvite);
  if (incomingInvite !== observedInvite) {
    setObservedInvite(incomingInvite);
    if (incomingInvite) { c.setConfirmation(undefined); c.setJoinPrompt(undefined); c.openInvitation(); }
  }
  const liveNotice = c.live?.state.notice ?? c.live?.state.error;
  const liveNoticeIdentity = JSON.stringify(liveNotice);
  const liveCommand = c.live?.command;
  const onOpenRoom = c.live?.onOpenRoom;
  const latest = useRef(c);
  useEffect(() => { latest.current = c; });
  // A danmaku clicked on the page opens its 弹幕 view here.
  useEffect(() => onOpenRoom?.(key => openRoom(latest.current, key)), [onOpenRoom]);
  // 弹幕 is on by default: the first time this account joins a token's 弹幕, say once that the service sees which token it is.
  const leasedRoom = c.live?.state.rooms?.leased;
  const roomPreferences = c.live?.state.preferences.rooms;
  const roomNoticeSent = useRef(false);
  useEffect(() => {
    if (!leasedRoom || roomPreferences?.off || roomPreferences?.noticed || roomNoticeSent.current || !liveCommand) return;
    roomNoticeSent.current = true;
    latest.current.setNotice(uiMessage('extension.room.joinedNotice'));
    void liveCommand('preferences', { accountId: latest.current.data.self, rooms: { noticed: true } }).catch(() => { roomNoticeSent.current = false; });
  }, [leasedRoom, roomPreferences?.off, roomPreferences?.noticed, liveCommand]);
  const liveNoticeText = text(liveNotice);
  const shownLiveNotice = useRef('');
  // The runtime's notice survives panel reconnects; closing or timing out its toast clears that same notice only.
  useEffect(() => {
    const id = liveNoticeText ? `runtime:${liveNoticeIdentity}` : '';
    if (shownLiveNotice.current && shownLiveNotice.current !== id) toast.dismiss(shownLiveNotice.current);
    shownLiveNotice.current = id;
    if (!id) return;
    const dismiss = () => { if (shownLiveNotice.current !== id) return; shownLiveNotice.current = ''; void liveCommand?.('dismiss-notice').catch(() => {}); };
    toast(liveNoticeText, { id, duration: 6000, onDismiss: dismiss, onAutoClose: dismiss });
  }, [liveNoticeText, liveNoticeIdentity, liveCommand]);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<{ target: typeof c.confirmation; message: TextValue }>();
  const [jumpTarget, setJumpTarget] = useState<{ id: string; teamId: string }>();
  const incomingJump = c.live?.state.jumpMessageId;
  const incomingWindow = c.live?.state.jumpWindowId;
  const [observedJump, setObservedJump] = useState<string>();
  const noKnownTeam = !c.team.joined && !c.team.readonly;
  const portraits = useMemo(() => teamDefaultAvatars(c.team.memberIds), [c.team.memberIds]);
  // Every site face in the panel resolves through this directory, including faces drawn without the controller.
  const siteIcons = c.live?.siteIcons;
  const sites = useMemo(() => ({ sites: c.sites, live: { siteIcons } }), [c.sites, siteIcons]);
  // The screen a jump into the chat came from; the first return stop leads back to it.
  const origin = jumpOrigin?.teamId === c.current ? jumpOrigin : undefined;
  // Account setup owns the whole panel, including the moment a restored account becomes signed in.
  const onboarding = c.working || onboardingScreens.includes(c.screen);
  // 聊天 ⇄ 弹幕 slide toward the side their tab is on; the screen left behind decides the direction.
  const [shownScreen, setShownScreen] = useState(c.screen);
  const [leftScreen, setLeftScreen] = useState<typeof c.screen>();
  if (shownScreen !== c.screen) { setLeftScreen(shownScreen); setShownScreen(c.screen); }
  const tabs = !onboarding && !noKnownTeam && (c.screen === 'chat' || c.screen === 'room') && panelTabsShown(c);
  // The first-run tour waits for a squad chat with nothing else open on it, once per account on this device. It saves `toured` as soon as
  // it shows, so `tourTeam` keeps that run on screen; leaving the chat ends the run, and coming back does not start it over.
  const tourFits = Boolean(c.live?.state.authenticated) && !onboarding && !noKnownTeam && c.screen === 'chat' && c.team.joined && !c.team.readonly && !c.personId && !c.confirmation && !c.image;
  const [tourTeam, setTourTeam] = useState<string>();
  if (tourTeam && (!tourFits || tourTeam !== c.current)) setTourTeam(undefined);
  const touring = tourFits && (tourTeam === c.current || !c.live?.state.preferences.toured);
  useEffect(() => {
    if (incomingJump && incomingJump === observedJump && liveCommand) void liveCommand('dismiss-jump', { messageId: incomingJump, windowId: incomingWindow }).catch(() => {});
  }, [incomingJump, incomingWindow, observedJump, liveCommand]);
  if (incomingJump !== observedJump) {
    setObservedJump(incomingJump);
    if (incomingJump) { setJumpTarget({ id: incomingJump, teamId: c.current }); setJumpOrigin(undefined); c.openNotification(); }
  }
  return <main ref={root} className={s.app} data-palside-app data-appearance={appearance} data-from={tabs ? leftScreen : undefined} onClick={event => { const link = event.target instanceof Element ? event.target.closest('a') : null; if (!event.defaultPrevented && c.live && link?.href && /^https?:/.test(link.href)) { event.preventDefault(); const live = c.live; const href = link.href; const session = captureSocialUi(); const open = () => { if (!session.current()) return Promise.resolve(); return live.openPage(href).catch(error => { if (session.current()) c.setNotice(errorMessage(error)); }); }; if (siteForUrl(href)) void open(); else c.setConfirmation({ title: uiMessage('extension.copy.openLinkTitle'), description: uiMessage('extension.dynamic.openLinkDescription', { host: new URL(href).hostname }), confirm: async () => { await open(); } }); } }} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented && c.screen !== 'chat' && !['welcome', 'password', 'nickname'].includes(c.screen)) { e.preventDefault(); c.go('chat'); } }}><TeamPortraits value={portraits}><SiteDirectoryContext value={sites}>
    {tabs && <ChatHeader c={c} tabs onTeam={id => { c.chooseTeam(id); setJumpTarget(undefined); setJumpOrigin(undefined); }} />}
    {onboarding || (c.live && !c.live.state.authenticated) ? null : noKnownTeam ? c.screen === 'chat' ? c.disconnected ? <ConnectionEmpty c={c} /> : <TeamStart c={c} /> : null : <Chat key={c.current} c={c} jumpId={jumpTarget?.teamId === c.current ? jumpTarget.id : undefined} clearJump={() => { setJumpTarget(undefined); setJumpOrigin(undefined); }} originLabel={origin ? t('extension.copy.searchMessages') : undefined} searchQuery={origin?.screen === 'search' ? c.query : undefined} onReturn={origin ? () => { c.go(origin.screen); requestAnimationFrame(() => { const element = root.current?.querySelector<HTMLElement>('[data-palside-panel-scroll]'); if (element) element.scrollTop = origin.scrollTop; }); } : undefined} />}
    {!onboarding && c.live && <DanmakuView c={c} />}
    {onboarding ? <Onboarding c={c} /> : c.screen !== 'chat' && c.screen !== 'room' ? <Suspense fallback={<div className={s.empty} role="status">{t('extension.copy.loading')}</div>}><Panels key={c.screen} c={c} onJump={id => { if (c.screen === 'search') setJumpOrigin({ screen: c.screen, scrollTop: root.current?.querySelector<HTMLElement>('[data-palside-panel-scroll]')?.scrollTop ?? 0, teamId: c.current }); setJumpTarget({ id, teamId: c.current }); c.go('chat'); }} /></Suspense> : null}
    {!onboarding && <JoinSheet c={c} />}
    {touring && <FirstRunTour key={`tour:${c.current}`} c={c} onRun={setTourTeam} />}
    <Toaster label={t('extension.copy.notices')} closeLabel={t('extension.copy.closeNotice')} />
    <AlertDialog confirmLabel={text(c.confirmation?.action) || t('common.confirm')} tone={c.confirmation?.danger ? 'danger' : undefined} cancelLabel={t('common.cancel')} placement="bottom" boundarySelector="[data-palside-app]" open={Boolean(c.confirmation)} title={text(c.confirmation?.title)} description={text(c.confirmation?.description)} onOpenChange={open => { if (!open) c.setConfirmation(undefined); }} pending={confirmBusy} error={confirmFailure?.target === c.confirmation ? text(confirmFailure?.message) : undefined} onConfirm={async () => { if (confirmBusy || !c.confirmation) return; const target = c.confirmation; setConfirmBusy(true); setConfirmFailure(undefined); try { await target.confirm(); c.setConfirmation(undefined); } catch (error) { setConfirmFailure({ target, message: error instanceof Error ? errorMessage(error) : uiMessage('common.error') }); } finally { setConfirmBusy(false); } }} />
    {c.personId && <PersonCard key={c.personId} c={c} />}
    {c.live && <PaymentSheet c={c} />}
    {c.live && <NoteSheet c={c} />}
    {c.live && <RoomPersonSheet c={c} />}
    {c.live && <InviteSheet c={c} />}
    <SitePicker c={c} />
    <GrantSheet c={c} />
    {c.live && <AllSitesSheet c={c} />}
    <ReadSheet c={c} />
    {c.image && (!c.live || c.messages.some(message => !message.recalled && message.attachment?.kind === 'image' && message.attachment.src === c.image?.src)) && <ImageEditor mode="view" src={c.image.src} name={c.image.name} teamId={c.current} command={c.live?.command} onClose={() => c.setImage(undefined)} />}
  </SiteDirectoryContext></TeamPortraits></main>;
}
