'use client';
import { errorMessage, type TextValue, message as uiMessage } from '@palside/i18n';

import { useText } from '../ui/text';

import { useTranslations } from 'use-intl';
import { useAppearance } from '../settings/appearance';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionPresets } from '@palside/design/motion';
import { X } from 'lucide-react';
import { AlertDialog } from '@palside/ui/dialog';
import { Button } from '@palside/ui/button';
import { ImageEditor } from '../media/image-editor';
import { usePalside, type PalsideProps } from './use-palside';
import { PersonCard } from '../account/person-card';
import { PaymentSheet, usePaymentSession } from '../wallet/payment-sheet';
import { teamDefaultAvatars, TeamPortraits } from '../account/default-avatar';
import { SocialSession, captureSocialUi, observeSocialPage, openWithReturn, useSocialUi } from '../annotations/social-state';
import { NoteSheet } from '../annotations/sticky-list';
import { AllSitesSheet, GrantSheet, SitePicker } from '../settings/access-sheet';
import { ReadSheet } from '../settings/privacy';
import { Chat } from '../chat/chat';
import { DanmakuView, InviteSheet, RoomPersonSheet } from '../rooms/danmaku-view';
import { openRoom } from '../rooms/rooms';
import { Onboarding, onboardingScreens } from '../account/onboarding';
const Panels = lazy(() => import('./panels').then(module => ({ default: module.Panels })));
import { JoinSheet, TeamStart } from '../teams/team-start';
import { ConnectionEmpty } from '../feedback/connection-empty';
import { Action } from '../ui/primitives';
import { siteForUrl } from '../settings/site-catalog';
import s from './palside.module.css';

export function PalsideApp(props: PalsideProps) {
  const [working, setWorking] = useState(false);
  const [flow, setFlow] = useState<'create' | 'restore'>('create');
  const accountId = props.live ? props.live.state.account?.id ?? 'signed-out' : props.data.self;
  return <SocialSession key={`${accountId}:${props.live?.state.authenticated ?? 'preview'}`} accountId={accountId}><PalsideSession {...props} onboarding={{ working, setWorking, flow, setFlow }} /></SocialSession>;
}

function PalsideSession(props: PalsideProps) {
  const t = useTranslations();
  const text = useText();
  const root = useRef<HTMLElement>(null);
  const [jumpOrigin, setJumpOrigin] = useState<{ screen: 'shared' | 'search'; scrollTop: number; teamId: string }>();
  const reduced = useReducedMotion();
  const c = usePalside(props);
  usePaymentSession(c.live?.state.authenticated ? c.live.state.account?.id : undefined);
  const { returnTo } = useSocialUi();
  const pageUrl = c.live?.page?.url;
  useEffect(() => { observeSocialPage(pageUrl); }, [pageUrl, returnTo]);
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
  useEffect(() => { if (!liveNoticeIdentity || !liveCommand) return; const timer = setTimeout(() => { void liveCommand('dismiss-notice').catch(() => {}); }, 6000); return () => clearTimeout(timer); }, [liveNoticeIdentity, liveCommand]);
  const notice = c.notice || text(liveNotice);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<{ target: typeof c.confirmation; message: TextValue }>();
  const [jumpTarget, setJumpTarget] = useState<{ id: string; teamId: string }>();
  const incomingJump = c.live?.state.jumpMessageId;
  const incomingWindow = c.live?.state.jumpWindowId;
  const [observedJump, setObservedJump] = useState<string>();
  const noKnownTeam = !c.team.joined && !c.team.readonly;
  const portraits = useMemo(() => teamDefaultAvatars(c.team.memberIds), [c.team.memberIds]);
  // The screen a jump into the chat came from; the first return stop leads back to it.
  const origin = jumpOrigin?.teamId === c.current ? jumpOrigin : undefined;
  // Account setup owns the whole panel, including the moment a restored account becomes signed in.
  const onboarding = c.working || onboardingScreens.includes(c.screen);
  useEffect(() => {
    if (incomingJump && incomingJump === observedJump && liveCommand) void liveCommand('dismiss-jump', { messageId: incomingJump, windowId: incomingWindow }).catch(() => {});
  }, [incomingJump, incomingWindow, observedJump, liveCommand]);
  if (incomingJump !== observedJump) {
    setObservedJump(incomingJump);
    if (incomingJump) { setJumpTarget({ id: incomingJump, teamId: c.current }); setJumpOrigin(undefined); c.openNotification(); }
  }
  return <main ref={root} className={s.app} data-palside-app data-appearance={appearance} onClick={event => { const link = event.target instanceof Element ? event.target.closest('a') : null; if (!event.defaultPrevented && c.live && link?.href && /^https?:/.test(link.href)) { event.preventDefault(); const live = c.live; const href = link.href; const source = link.hasAttribute('data-palside-source'); const session = captureSocialUi(); const open = () => { if (!session.current()) return Promise.resolve(); return (source ? openWithReturn(live, href) : live.openPage(href, source)).catch(error => { if (session.current()) c.setNotice(errorMessage(error)); }); }; if (siteForUrl(href)) void open(); else c.setConfirmation({ title: uiMessage('extension.copy.openLinkTitle'), description: uiMessage('extension.dynamic.openLinkDescription', { host: new URL(href).hostname }), confirm: async () => { await open(); } }); } }} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented && c.screen !== 'chat' && !['welcome', 'password', 'nickname'].includes(c.screen)) { e.preventDefault(); c.go('chat'); } }}><TeamPortraits value={portraits}>
    {onboarding || (c.live && !c.live.state.authenticated) ? null : noKnownTeam ? c.screen === 'chat' ? c.disconnected ? <ConnectionEmpty c={c} /> : <TeamStart c={c} /> : null : <Chat key={c.current} c={c} jumpId={jumpTarget?.teamId === c.current ? jumpTarget.id : undefined} clearJump={() => { setJumpTarget(undefined); setJumpOrigin(undefined); }} originLabel={origin ? t(origin.screen === 'shared' ? 'extension.copy.sharedItems' : 'extension.copy.searchMessages') : undefined} searchQuery={origin?.screen === 'search' ? c.query : undefined} onReturn={origin ? () => { c.go(origin.screen); requestAnimationFrame(() => { const element = root.current?.querySelector<HTMLElement>('[data-palside-panel-scroll]'); if (element) element.scrollTop = origin.scrollTop; }); } : undefined} />}
    {!onboarding && c.live && <DanmakuView c={c} />}
    {onboarding ? <Onboarding c={c} /> : c.screen !== 'chat' && c.screen !== 'room' ? <Suspense fallback={<div className={s.empty} role="status">{t('extension.copy.loading')}</div>}><Panels key={c.screen} c={c} onJump={id => { if (c.screen === 'shared' || c.screen === 'search') setJumpOrigin({ screen: c.screen, scrollTop: root.current?.querySelector<HTMLElement>('[data-palside-panel-scroll]')?.scrollTop ?? 0, teamId: c.current }); setJumpTarget({ id, teamId: c.current }); c.go('chat'); }} /></Suspense> : null}
    {!onboarding && <JoinSheet c={c} />}
    <AnimatePresence initial={false}>{notice && <motion.div key="notice" initial={{ opacity: 0, y: reduced ? 0 : -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }} transition={reduced ? motionPresets.reduced : motionPresets.expand} className={s.toast} role="status" aria-live="polite" aria-atomic="true"><span>{notice}</span>{c.notice && c.noticeUndo && <Button size="sm" variant="surface" className={s.toastAction} onClick={() => { const undo = c.noticeUndo; c.setNotice(''); undo?.(); }}>{t('extension.sites.undo')}</Button>}<Action className={s.toastClose} label={t('extension.copy.closeNotice')} onClick={() => { c.setNotice(''); if (liveCommand) void liveCommand('dismiss-notice'); }}><X size={14} /></Action></motion.div>}</AnimatePresence>
    <AlertDialog confirmLabel={text(c.confirmation?.action) || t('common.confirm')} tone={c.confirmation?.danger ? 'danger' : undefined} cancelLabel={t('common.cancel')} placement="bottom" boundarySelector="[data-palside-app]" open={Boolean(c.confirmation)} title={text(c.confirmation?.title)} description={text(c.confirmation?.description)} onOpenChange={open => { if (!open) c.setConfirmation(undefined); }} pending={confirmBusy} error={confirmFailure?.target === c.confirmation ? text(confirmFailure?.message) : undefined} onConfirm={async () => { if (confirmBusy || !c.confirmation) return; const target = c.confirmation; setConfirmBusy(true); setConfirmFailure(undefined); try { await target.confirm(); c.setConfirmation(undefined); } catch (error) { setConfirmFailure({ target, message: error instanceof Error ? errorMessage(error) : uiMessage('common.error') }); } finally { setConfirmBusy(false); } }} />
    {c.personId && <PersonCard key={c.personId} c={c} />}
    {c.live && <PaymentSheet c={c} />}
    {c.live && <NoteSheet c={c} />}
    {c.live && <RoomPersonSheet c={c} />}
    {c.live && <InviteSheet c={c} />}
    <SitePicker c={c} />
    {c.live && <GrantSheet c={c} />}
    {c.live && <AllSitesSheet c={c} />}
    <ReadSheet c={c} />
    {c.image && (!c.live || c.messages.some(message => !message.recalled && message.attachment?.kind === 'image' && message.attachment.src === c.image?.src)) && <ImageEditor mode="view" src={c.image.src} name={c.image.name} teamId={c.current} command={c.live?.command} onClose={() => c.setImage(undefined)} />}
  </TeamPortraits></main>;
}
