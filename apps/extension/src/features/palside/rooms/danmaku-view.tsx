'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { tagLabel, tagKey } from '../../../domain/account/profile-tags';
import { chatTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { Count, CountText, Swap } from '../ui/motion-details';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowUp, Ban, Copy, Flag, Flame, Gift, HandCoins, Lock, MessageCircle, MonitorPlay, MoreHorizontal, Quote, Undo2, UserPlus, X } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { ROOM_TEXT_MAX } from '@palside/shared/contracts/limits';
import type { InviteOptions, RoomMessage, RoomPerson } from '../../../runtime/rooms/contract-types';
import { TEAM_MEMBER_LIMIT } from '@palside/shared/contracts/limits';
import type { RoomView } from '../../../runtime/rooms/state';
import { requestSitesAccess } from '../../../runtime/browser/permissions';
import { Sheet } from '@palside/ui/sheet';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { TeamAvatar } from '../teams/team-avatar';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { SettingGroup } from '../settings/setting-rows';
import { accountLabel } from '../account/account-label';
import { capability } from '../settings/access';
import { characterLength } from '../../../domain/chat/model';
import { type Person } from '../../../domain/account/model';
import { openRoom, roomPerson, roomView, roomsOn, tabRoomKey, tabView, teammateIds, useRoomRead, useRoomOpening, useRoomDrafts, roomQuoteReturn } from './rooms';
import { StancePoll } from './stance-poll';
import { RoomPayments, TipPayment } from '../wallet/room-payments';
import type { WalletPerson } from '@palside/shared/contracts/profiles';
import { PalsAmount } from '../wallet/amount';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';
import ac from '../settings/access-sheet.module.css';
import card from '../account/person-card.module.css';
import d from './danmaku.module.css';
import { EmptyState } from '../chat/history-scope';
import { whenWalletOpen } from '../wallet/closed';

/** Today as hour:minute, earlier days as the short date and time. */
export function roomTime(at: number, now: number, locale: string) {
  return chatTime(at, localeOrEnglish(locale), now);
}

/** Overlapping faces, teammates first and ringed; the count after them when given. */
export function Faces({ c, people, count }: { c: PalsideController; people: RoomPerson[]; count?: number }) {
  const t = useTranslations();
  const mates = teammateIds(c);
  const drawn = people.map(person => roomPerson(c, person, t('common.member'), mates)).sort((a, b) => Number(b.mate) - Number(a.mate));
  return <span className={d.faces}>{drawn.map(person => <span key={person.id} data-mate={person.mate || undefined}><PersonAvatar person={person} size="xs" /></span>)}{count !== undefined && <b><Count value={count} /></b>}</span>;
}

/** 弹幕: the whole panel for one token — back to the team, the token, who is here, 热门; then 看法, the messages and a one-line box. */
export function DanmakuView({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const rooms = c.live?.state.rooms;
  const opening = useRoomOpening(c);
  const drafts = useRoomDrafts(c.live?.state.authenticated ? c.data.self : '');
  const pinned = opening?.key ?? rooms?.pinned;
  const room = rooms?.current?.key === pinned ? rooms?.current : undefined;
  const screen = c.screen, go = c.go, on = roomsOn(c);
  useEffect(() => { if (screen === 'room' && (!on || !pinned)) go('chat'); }, [screen, on, pinned, go]);
  if (c.screen !== 'room' || !pinned) return null;
  const back = () => { void c.run('room-close'); c.go('chat'); };
  return <div className={d.view} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); back(); } }}>
    <RoomHead c={c} roomKey={pinned} room={room} onBack={back} />
    {room && <div className={d.pollWrap}><StancePoll c={c} roomKey={room.key} stance={room.stance} /></div>}
    <RoomPayments c={c} roomKey={pinned} />
    <SwitchRow c={c} pinned={pinned} />
    {opening?.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => openRoom(c, opening.key, opening.profile) }}>{t('common.error')}</InlineFeedback>}
    {room ? <RoomList key={room.key} c={c} room={room} /> : opening?.status !== 'error' ? <div className={d.empty}><p>{t('extension.copy.loading')}</p></div> : null}
    {room && <RoomBar key={`bar-${room.key}`} c={c} room={room} drafts={drafts} />}
  </div>;
}

function RoomHead({ c, roomKey, room, onBack }: { c: PalsideController; roomKey: string; room?: RoomView; onBack: () => void }) {
  const t = useTranslations();
  const view = roomView(c, roomKey, room?.profile);
  const unread = c.teams.some(team => team.joined && !team.muted && (team.unread > 0 || (team.mentions ?? 0) > 0));
  const backLabel = c.team.joined ? t('extension.room.back', { name: c.team.name }) : t('common.back');
  const count = room?.count ?? 0;
  return <header className={d.head}>
    <VisuallyHidden asChild><h1>{view.name}</h1></VisuallyHidden>
    <Tooltip content={backLabel}><button type="button" className={d.back} aria-label={backLabel} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{c.team.joined && <TeamAvatar team={c.team} size="xs" />}{unread && <span className={d.backDot} />}</button></Tooltip>
    <Tooltip content={t('extension.current.detail', { name: view.name })}><button type="button" className={d.title} aria-label={t('extension.current.detail', { name: view.name })} onClick={() => c.selectAsset(view.id, view)}>
      <Token view={view} size="sm" /><span><strong>{view.name}</strong><small>{view.chain}</small></span>
    </button></Tooltip>
    <Tooltip content={t('extension.room.watching', { count })}><button type="button" className={d.watch} aria-label={t('extension.room.watching', { count })} onClick={() => { setSocialUi({ people: undefined }); c.go('room-people'); }}><Faces c={c} people={room?.faces ?? []} count={count} /></button></Tooltip>
    <Tooltip content={t('extension.hot.title')}><IconButton size="sm" variant="quiet" label={t('extension.hot.title')} onClick={() => c.go('hot')}><Flame size={18} /></IconButton></Tooltip>
  </header>;
}

/** The tab moved to another token: offer it, and keep counting the pinned one until the user switches. */
function SwitchRow({ c, pinned }: { c: PalsideController; pinned: string }) {
  const t = useTranslations();
  const key = tabRoomKey(c);
  const page = c.live?.page;
  const view = key && key !== pinned ? tabView(page, page?.asset) : undefined;
  if (!key || !view) return null;
  return <div className={d.switchRow}>
    <Token view={view} size="sm" /><strong>{view.name}</strong>
    <Button size="sm" variant="surface" className={d.switchButton} onClick={() => openRoom(c, key)}>{t('extension.room.switch')}</Button>
  </div>;
}

function RoomList({ c, room }: { c: PalsideController; room: RoomView }) {
  const t = useTranslations();
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const paging = useRef(false);
  const height = useRef(0);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const blocked = new Set((c.live?.state.rooms.blocked ?? []).map(person => person.id));
  const messages = room.messages.filter(message => !blocked.has(message.author.id));
  const mates = teammateIds(c);
  const newest = messages.at(-1)?.id, oldest = messages[0]?.id;
  const { roomLine } = useSocialUi();
  const [focus, setFocus] = useState<{ id: string }>();
  const positioned = useRef<typeof focus>(undefined);
  const command = c.live?.command, setNotice = c.setNotice;
  // Resolve the quoted line through retained history before positioning its rendered row.
  useEffect(() => {
    if (!roomLine || room.loading || !command) return;
    let cancelled = false;
    following.current = false;
    void command('room-find', { key: room.key, id: roomLine }).then(result => {
      if (cancelled) return;
      setSocialUi({ roomLine: undefined });
      paging.current = false;
      if (result.found) setFocus({ id: roomLine });
      else setNotice(uiMessage('extension.copy.messageUnavailable'));
    }, error => {
      if (!cancelled) { setSocialUi({ roomLine: undefined }); setNotice(errorMessage(error)); }
    });
    return () => { cancelled = true; };
  }, [roomLine, room.loading, room.key, command, setNotice]);
  useLayoutEffect(() => {
    if (!focus || positioned.current === focus) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-room-line="${CSS.escape(focus.id)}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); positioned.current = focus; }
  }, [focus, oldest, newest]);
  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => setFocus(undefined), 1600);
    return () => clearTimeout(timer);
  }, [focus]);
  // Older pages keep the reading position; new messages follow only while the reader is at the bottom.
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    if (paging.current) { element.scrollTop += element.scrollHeight - height.current; paging.current = false; }
    else if (following.current) element.scrollTop = element.scrollHeight;
  }, [newest, oldest]);
  function scroll() {
    const element = list.current; if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (element.scrollTop < 24 && room.hasMore && !paging.current && !room.loading) {
      paging.current = true; height.current = element.scrollHeight;
      void c.run('room-more').then(() => { if (paging.current && list.current?.scrollHeight === height.current) paging.current = false; });
    }
  }
  if (!messages.length) return <div className={d.empty}><MessageCircle aria-hidden="true" /><p>{room.loading ? t('extension.copy.loading') : t('extension.room.empty')}</p></div>;
  return <div ref={list} className={d.list} role="log" aria-label={t('extension.room.name')} tabIndex={0} onScroll={scroll}>
    {room.hasMore && <span className={d.more}>{t('extension.copy.loading')}</span>}
    {messages.map(message => <RoomLine key={message.id} c={c} message={message} mate={mates.has(message.author.id)} focus={focus?.id === message.id} open={shown.has(message.id)} onShow={() => setShown(old => new Set(old).add(message.id))} />)}
  </div>;
}

function RoomLine({ c, message, mate, focus, open, onShow }: { c: PalsideController; message: RoomMessage; mate: boolean; focus: boolean; open: boolean; onShow: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const self = message.author.id === c.data.self;
  const person = roomPerson(c, message.author, t('common.member'));
  const name = self ? t('extension.page.you') : person.name;
  return <div className={d.row} data-room-line={message.id} data-focus={focus || undefined} data-mate={mate || undefined} data-self={self || undefined}>
    <button type="button" data-mate={mate || undefined} aria-label={t('extension.copy.openProfile', { name: person.name })} onClick={() => showPerson(c, person, message.id)}><PersonAvatar person={person} size="room" /></button>
    <div className={d.messageBody}>
      <div className={d.messageHead}><b>{name}</b>{message.tips?.length ? <TipChip value={message.tips.reduce((total, item) => total + BigInt(item.amount), 0n).toString()} /> : null}<time dateTime={new Date(message.createdAt).toISOString()}>{roomTime(message.createdAt, c.now, locale)}</time></div>
      <p>{message.folded && !open ? <span className={d.folded}>{t('extension.room.folded')}<Button size="sm" variant="surface" className={d.foldedAction} onClick={onShow}>{t('extension.room.show')}</Button></span> : message.text}</p>
      {message.tips?.map(group => <TipGroupLine key={group.id} c={c} accountIds={group.accountIds} amount={group.amount} />)}
    </div>
    <span className={d.menu}><LineMenu c={c} message={message} name={person.name} self={self} /></span>
  </div>;
}

/** The line's tip total: springs in, then the coin pops while the amount rolls up as more tips land. */
function TipChip({ value }: { value: string }) {
  const reduced = useReducedMotion();
  return <motion.span className={d.tipChip} initial={reduced ? false : { scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
    <motion.span key={value} className={d.tipCoin} initial={reduced ? false : { scale: 1.35, rotate: -18 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }}><HandCoins aria-hidden="true" /></motion.span>
    <PalsAmount value={value} />
  </motion.span>;
}

/** Tips to one line within 30 seconds: one public line where faces stack, names fold into “等 N 人”, and the total rolls. */
function TipGroupLine({ c, accountIds, amount }: { c: PalsideController; accountIds: string[]; amount: string }) {
  const t = useTranslations();
  const room = c.live?.state.rooms;
  const known = [...room?.current?.faces ?? [], ...room?.people?.people ?? [], ...room?.current?.messages.map(message => message.author) ?? []];
  const people = accountIds.map(id => known.find(person => person.id === id) ?? { id, nickname: '', avatarId: null });
  const names = people.map(person => person.id === c.data.self ? t('extension.page.you') : roomPerson(c, person, t('common.member')).name);
  const label = names.length > 2 ? t('extension.wallet.tipPeople', { names: names.slice(0, 2).join('、'), count: names.length }) : names.join('、');
  return <div className={d.tipLine}><Faces c={c} people={people.slice(-3)} /><Swap k={String(names.length)}><span>{label}</span></Swap><span>{t('extension.wallet.tipped')}</span><PalsAmount value={amount} /></div>;
}

/** Public-room profiles keep invitation and moderation actions for every other person. */
function showPerson(c: PalsideController, person: Person & { mate: boolean }, messageId?: string) {
  if (person.id === c.data.self) c.setPersonId(person.id);
  else setSocialUi({ roomPerson: person.id, roomPersonMessage: messageId });
}

/** 引用到小队 / 复制 / 举报 / 撤回. Quoting returns to the team with the line in its message box. */
function LineMenu({ c, message, name, self }: { c: PalsideController; message: RoomMessage; name: string; self: boolean }) {
  const t = useTranslations();
  const [tipping, setTipping] = useState(false);
  const token = c.live?.state.rooms.current?.profile?.name ?? '';
  function quote() {
    const room = c.live?.state.rooms.current;
    const view = room && roomView(c, room.key, room.profile);
    if (!room) return;
    const { owns, back } = roomQuoteReturn(c, room.key);
    // A token known only by its room key has no page to point at: the line goes in as text.
    if (!view?.url) {
      const line = t('extension.room.quoteLine', { text: message.text, name, room: token });
      c.updateDraft({ text: c.draft.text ? `${line}\n${c.draft.text}` : `${line}\n` }); back(); return;
    }
    const target = { kind: 'danmaku' as const, id: message.id, author: message.author.id, name: message.author.nickname, at: message.createdAt };
    void c.live?.command('attach-ref', { teamId: c.current, url: view.url, target, caption: message.text }).then(back, error => { if (owns()) c.setNotice(errorMessage(error)); });
  }
  function report() {
    c.setConfirmation({ title: uiMessage('extension.room.reportTitle', { name }), description: uiMessage('extension.room.reportDescription'), action: uiMessage('extension.copy.report'), danger: true,
      confirm: async () => { await c.live?.command('room-report', { id: message.id }); c.setNotice(uiMessage('extension.room.reported')); } });
  }
  function retract() {
    c.setConfirmation({ title: uiMessage('extension.room.retractTitle'), description: uiMessage('extension.room.retractDescription'), action: uiMessage('extension.copy.recall'), danger: true,
      confirm: async () => { await c.live?.command('room-retract', { id: message.id }); } });
  }
  const label = t('extension.dynamic.messageActions', { content: message.text.slice(0, 15) });
  return <><Menu boundarySelector="[data-palside-app]" align="end">
    <MenuTrigger asChild><IconButton label={label} size="sm" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
    <MenuContent aria-label={label} className={d.messageMenu}>
      {c.team.joined && c.canWrite && <MenuItem className={d.messageAction} icon={<Quote size={16} />} onClick={quote}>{t('extension.sticky.quote')}</MenuItem>}
      <MenuItem className={d.messageAction} icon={<Copy size={16} />} onClick={() => { void c.copy(message.text); }}>{t('extension.copy.copy')}</MenuItem>
      {!self && !message.folded && <MenuItem className={d.messageAction} icon={<Gift size={16} />} onClick={() => whenWalletOpen(c, () => setTipping(true))}>{t('extension.wallet.tip')}</MenuItem>}
      {!self && <MenuItem className={d.messageAction} icon={<Flag size={16} />} tone="danger" disabled={message.reported} onClick={report}>{message.reported ? t('extension.room.reported') : t('extension.copy.report')}</MenuItem>}
      {self && <MenuItem className={d.messageAction} icon={<Undo2 size={16} />} tone="danger" onClick={retract}>{t('extension.copy.recall')}</MenuItem>}
    </MenuContent>
  </Menu>{tipping && <TipPayment c={c} messageId={message.id} onClose={() => setTipping(false)} />}</>;
}

/**
 * 在网页上显示 on this tab: `off`, `on`, `need` (on, but Chrome has not allowed the site the tab shows) or `paused` (网页互动 is off, so
 * nothing is drawn on any page whatever this says).
 */
function danmakuState(c: PalsideController): 'on' | 'off' | 'need' | 'paused' {
  if (!c.web.interact) return 'paused';
  if (!c.live?.danmaku?.enabled) return 'off';
  return capability(c, 'danmaku').state === 'access' ? 'need' : 'on';
}

/**
 * One press of 在网页上显示: on → off; off → on, asking Chrome for this site in the same click; unauthorised opens the grant sheet.
 * While 网页互动 is off it turns nothing on behind the user's back: it opens 设置, where 网页互动 is.
 */
function pressDanmaku(c: PalsideController) {
  const state = danmakuState(c), live = c.live;
  if (!live) return;
  if (state === 'paused') { c.go('settings'); return; }
  if (state === 'need') { setSocialUi({ grant: 'danmaku' }); return; }
  const save = (enabled: boolean) => live.command('danmaku-settings', { settings: { enabled } }).catch(error => c.setNotice(errorMessage(error)));
  if (state === 'on') { void save(false); return; }
  if (capability(c, 'danmaku').state === 'access' && c.pageHost) void requestSitesAccess([c.pageHost]).catch(() => false);
  void save(true);
}

function RoomBar({ c, room, drafts }: { c: PalsideController; room: RoomView; drafts: ReturnType<typeof useRoomDrafts> }) {
  const t = useTranslations();
  const text = useSyncExternalStore(listener => { drafts.listeners.add(listener); return () => { drafts.listeners.delete(listener); }; }, () => drafts.values.get(room.key) ?? '', () => '');
  function setText(value: string) {
    if (value) drafts.values.set(room.key, value); else drafts.values.delete(room.key);
    for (const listener of drafts.listeners) listener();
  }
  const sending = useSyncExternalStore(listener => { drafts.listeners.add(listener); return () => { drafts.listeners.delete(listener); }; }, () => drafts.sending.has(room.key), () => false);
  function setSending(value: boolean) {
    if (value) drafts.sending.add(room.key); else drafts.sending.delete(room.key);
    for (const listener of drafts.listeners) listener();
  }
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const waiting = room.slowUntil > now;
  useEffect(() => { if (!waiting) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [waiting]);
  const length = characterLength(text.trim());
  const slow = Math.ceil((room.slowUntil - now) / 1000);
  const ready = length > 0 && length <= ROOM_TEXT_MAX && !sending && slow <= 0 && !c.disconnected;
  const state = danmakuState(c);
  const switchLabel = state === 'need' ? (c.pageHost ? t('extension.toggle.interactNeed', { host: c.pageHost }) : t('extension.toggle.interactNeedHere')) : t(state === 'on' ? 'extension.room.pageOn' : state === 'paused' ? 'extension.room.pagePaused' : 'extension.room.pageOff');
  async function send() {
    if (!ready || drafts.sending.has(room.key)) return;
    setSending(true);
    const value = text.trim();
    try { if (await c.run('room-send', { text: value }) !== undefined && drafts.values.get(room.key) === text) setText(''); }
    finally { setSending(false); setNow(Date.now()); input.current?.focus(); }
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); void send(); }
  }
  const sendLabel = slow > 0 ? t('extension.room.slow', { seconds: slow }) : c.disconnected ? t('extension.copy.sendWhenConnected') : t('extension.copy.sendMessage');
  return <div className={d.bar}>
    <Tooltip content={switchLabel}>{state === 'need'
      ? <button type="button" className={d.grant} aria-label={switchLabel} aria-haspopup="dialog" onClick={() => pressDanmaku(c)}><Lock aria-hidden="true" />{t('extension.grant.allow')}</button>
      : <button type="button" className={d.toggle} data-state={state} aria-label={switchLabel} aria-pressed={state === 'on'} onClick={() => pressDanmaku(c)}><MonitorPlay size={17} /></button>}
    </Tooltip>
    <Tooltip content={t('extension.wallet.createPacket')}><IconButton size="sm" variant="quiet" label={t('extension.wallet.createPacket')} onClick={() => whenWalletOpen(c, () => c.go('wallet-packet'))}><Gift size={16} /></IconButton></Tooltip>
    <input ref={input} className={d.input} value={text} aria-label={t('extension.room.placeholder')} placeholder={t('extension.room.placeholder')} onChange={event => setText(event.target.value)} onKeyDown={key} />
    {length > ROOM_TEXT_MAX - 10 && <small className={d.counter} data-over={length > ROOM_TEXT_MAX || undefined}><Count value={length} />/{ROOM_TEXT_MAX}</small>}
    <Tooltip content={sendLabel}><IconButton size="sm" variant="surface" className={d.send} label={sendLabel} disabled={!ready} onClick={() => void send()}>{slow > 0 ? <span role="timer"><Count value={slow} /></span> : <ArrowUp size={16} aria-hidden="true" />}</IconButton></Tooltip>
  </div>;
}

/** Someone met in 弹幕: who they are, and 邀请进小队 / 屏蔽 / 举报 (this account). */
export function RoomPersonSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const social = useSocialUi(), id = social.roomPerson;
  const [tipping, setTipping] = useState(false);
  const tipMessage = c.live?.state.rooms.current?.messages.find(item => item.id === social.roomPersonMessage && item.author.id === id && !item.folded);
  const command = c.live?.command, chainEnabled = c.live?.state.wallet?.config?.enabled, chainRevision = c.live?.state.chainRevision;
  const [chainPerson, setChainPerson] = useState<{ id: string; value: WalletPerson }>();
  useEffect(() => { if (!id || !chainEnabled) return; let current = true; void command?.('wallet-person', { accountId: id }).then(value => { if (current) setChainPerson({ id, value }); }, () => { if (current) setChainPerson(undefined); }); return () => { current = false; }; }, [command, id, chainEnabled, chainRevision]);
  const chain = chainPerson?.id === id ? chainPerson?.value : undefined;
  const close = () => setSocialUi({ roomPerson: undefined });
  const rooms = c.live?.state.rooms;
  const found = id ? [...rooms?.current?.faces ?? [], ...rooms?.people?.people ?? [], ...rooms?.current?.messages.map(message => message.author) ?? []].find(person => person.id === id) : undefined;
  const person = found && roomPerson(c, found, t('common.member'));
  const blocked = Boolean(person && rooms?.blocked.some(item => item.id === person.id));
  function report() {
    if (!person) return;
    close(); c.setReportTarget({ kind: 'account', targetId: person.id, preview: `${person.name} ${accountLabel(person.id)}` }); c.go('report');
  }
  if (tipping && tipMessage) return <TipPayment c={c} messageId={tipMessage.id} onClose={() => { setTipping(false); close(); }} />;
  return <Sheet open={Boolean(person)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="room-person-title" className={`${ac.sheet} ${card.person}`}>
    {person && <>
      <header className={card.head}>
        <PersonAvatar person={person} size="lg" />
        <div className={card.name}><h2 id="room-person-title">{person.name}</h2><p><span className={card.handle}>{accountLabel(person.id)}</span></p></div>
        <Action label={t('extension.copy.closeProfile')} onClick={close}><X /></Action>
      </header>
      {chain?.wallet && <button type="button" className={card.walletAddress} aria-label={t('extension.wallet.address')} onClick={() => void c.copy(chain.wallet!.address)}>{chain.wallet.address}</button>}
      {(person.bio || person.tags?.length) && <div className={card.about}>{person.bio && <p className={card.bio}>{person.bio}</p>}{person.tags?.length ? <ul className={card.tags}>{person.tags.map(tag => <li key={tagKey(tag)}>{tagLabel(tag, t)}</li>)}</ul> : null}</div>}
      <div className={card.actions}>
        {tipMessage && <button type="button" className={card.action} onClick={() => whenWalletOpen(c, () => setTipping(true))}><Gift size={18} /><span>{t('extension.wallet.tip')}</span></button>}
        <button type="button" className={card.action} aria-disabled={!c.teams.some(team => team.joined) || undefined} onClick={() => { if (!c.teams.some(team => team.joined)) return; close(); setSocialUi({ invite: person.id }); }}><UserPlus size={18} /><span>{t('extension.invite.action')}</span></button>
        <button type="button" className={card.action} onClick={() => { close(); setBlocked(c, person.id, person.name, !blocked); }}><Ban size={18} /><span>{blocked ? t('extension.room.unblock') : t('extension.room.block')}</span></button>
        <button type="button" className={card.action} onClick={report}><Flag size={18} /><span>{t('extension.copy.report')}</span></button>
      </div>
    </>}
  </Sheet>;
}

function setBlocked(c: PalsideController, accountId: string, name: string, blocked: boolean) {
  void c.run('room-block', { accountId, blocked }).then(result => {
    if (result !== undefined && blocked) c.setNotice(uiMessage('extension.room.blockedName', { name }), () => { void c.run('room-block', { accountId, blocked: false }); });
  });
}

/** 邀请进小队: my teams for one person. Teams I cannot invite to stay listed, greyed, with why on hover. */
export function InviteSheet({ c }: { c: PalsideController }) {
  const id = useSocialUi().invite;
  return <InviteChoices c={c} id={id} />;
}

function InviteChoices({ c, id }: { c: PalsideController; id?: string }) {
  const t = useTranslations();
  const close = () => setSocialUi({ invite: undefined });
  const live = c.live, command = live?.command, accountId = live?.state.account?.id;
  const [opening, setOpening] = useState({ id, accountId });
  if (opening.id !== id || opening.accountId !== accountId) setOpening({ id, accountId });
  const [options, setOptions] = useState<{ opening: typeof opening; value?: InviteOptions; status: 'error' | 'success'; eligibility: string; revision: number }>();
  const [revision, setRevision] = useState(0);
  const [pick, setPick] = useState<{ team: string; options: typeof options }>();
  const [sending, setSending] = useState<typeof opening>();
  const eligibility = JSON.stringify(c.teams.map(team => [team.id, team.joined, team.memberIds, team.owner, team.readonly, live?.state.remoteTeams.find(item => item.id === team.id)?.membersCanInvite]));
  const active = useRef<typeof opening | undefined>(opening);
  useLayoutEffect(() => { active.current = opening; return () => { active.current = undefined; }; }, [opening]);
  useEffect(() => {
    if (!command || !id) return;
    let current = true;
    void command('invite-options', { accountId: id }).then(value => { if (current) setOptions({ opening, value, status: 'success', eligibility, revision }); }, () => { if (current) setOptions(old => ({ value: old?.opening.id === id && old.opening.accountId === accountId ? old.value : undefined, opening, status: 'error', eligibility, revision })); });
    return () => { current = false; };
  }, [id, command, accountId, opening, eligibility, revision]);
  const rooms = live?.state.rooms;
  const found = id ? [...rooms?.current?.faces ?? [], ...rooms?.people?.people ?? [], ...rooms?.current?.messages.map(message => message.author) ?? []].find(person => person.id === id) : undefined;
  const person = found && roomPerson(c, found, t('common.member'));
  const value = options && options.opening.id === id && options.opening.accountId === accountId ? options.value : undefined;
  const status = options?.opening === opening && options?.eligibility === eligibility && options.revision === revision ? options.status : 'loading';
  const currentOptions = status === 'success';
  const teams = c.teams.filter(team => team.joined);
  const eligible = (teamId: string) => currentOptions && value?.accepts === true && value.teams.some(item => item.teamId === teamId && item.state === 'can') && teams.some(team => team.id === teamId && !team.readonly && team.memberIds.length < TEAM_MEMBER_LIMIT);
  const chosen = pick?.options === options && pick && eligible(pick.team) ? pick.team : undefined;
  const latest = useRef({ chosen, id });
  useLayoutEffect(() => { latest.current = { chosen, id }; });
  const stateLabel = { invited: t('extension.invite.invited'), member: t('extension.invite.member'), full: t('extension.invite.full'), 'no-permission': t('extension.invite.noPermission'), unavailable: t('extension.invite.unavailable') } as const;
  async function send() {
    if (!id || active.current !== opening || !chosen || latest.current.chosen !== chosen || latest.current.id !== id || !eligible(chosen) || sending === opening) return;
    setSending(opening);
    try { if (await c.run('invite-send', { teamId: chosen, accountId: id }) !== undefined && active.current === opening) { close(); c.setNotice(uiMessage('extension.invite.sent', { name: person?.name ?? '' })); } }
    finally { setSending(current => current === opening ? undefined : current); }
  }
  return <Sheet open={Boolean(person)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="invite-title" className={ac.sheet}>
    {person && <>
      <header className={ac.head}>
        <PersonAvatar person={person} size="md" />
        <h2 id="invite-title" className={ac.title}>{t('extension.invite.title', { name: person.name })}<small>{t('extension.invite.choose')}</small></h2>
        <IconButton size="sm" variant="quiet" className={ac.close} label={t('common.close')} onClick={close}><X size={16} /></IconButton>
      </header>
      <div className={d.choices} role="radiogroup" aria-label={t('extension.invite.choose')}>
        {teams.map(team => {
          const option = value?.teams.find(item => item.teamId === team.id);
          const state = value && !value.accepts ? 'refuses' : option?.state;
          const usable = eligible(team.id);
          const row = <button key={team.id} type="button" role="radio" className={d.choice} aria-checked={chosen === team.id} aria-disabled={!usable} onClick={() => { if (usable && id) setPick({ team: team.id, options }); }}>
            <TeamAvatar team={team} size="sm" />
            <span><strong>{team.name}</strong><small><CountText text={t('extension.invite.members', { count: team.memberIds.length, limit: TEAM_MEMBER_LIMIT })} value={team.memberIds.length} /></small></span>
            {state && state !== 'can' && state !== 'refuses' ? <span className={d.state}>{stateLabel[state]}</span> : <span className={d.radio} aria-hidden="true" />}
          </button>;
          return state === 'refuses' ? <Tooltip key={team.id} content={t('extension.invite.refuses')}>{row}</Tooltip> : row;
        })}
      </div>
      {status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => setRevision(value => value + 1) }}>{t('common.error')}</InlineFeedback>}
      <div className={d.actions}>
        <Button size="lg" variant="surface" className={d.inviteCancel} onClick={close}>{t('common.cancel')}</Button>
        <Button size="lg" variant="surface" className={d.inviteSend} disabled={!chosen || sending === opening} onClick={() => void send()}>{t('extension.invite.send')}</Button>
      </div>
    </>}
  </Sheet>;
}

/** 在看: the count, then who spoke in the last 24 hours; teammates first. */
export function RoomPeople({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const rooms = c.live?.state.rooms;
  const key = useSocialUi().people ?? rooms?.pinned ?? rooms?.leased;
  const read = useRoomRead(c, 'people', key);
  if (!key) return <EmptyState title={t('extension.room.noSpeakers')} />;
  const people = rooms?.people?.key === key ? rooms.people : undefined;
  const mates = teammateIds(c);
  const view = roomView(c, key, rooms?.current?.key === key ? rooms.current.profile : rooms?.summaries[key]?.profile);
  const drawn = (people?.people ?? []).map(person => roomPerson(c, person, t('common.member'), mates)).sort((a, b) => Number(b.mate) - Number(a.mate));
  return <>
    <div className={d.peopleHead}><Token view={view} size="sm" /><span className={d.peopleText}><strong>{view.name}</strong><small>{(count => <CountText text={t('extension.room.watching', { count })} value={count} />)(rooms?.current?.key === key ? rooms.current.count : rooms?.summaries[key]?.count ?? people?.count ?? 0)}</small></span><Faces c={c} people={rooms?.current?.key === key ? rooms.current.faces : rooms?.summaries[key]?.faces ?? []} /></div>
    {read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    {drawn.length ? <SettingGroup title={t('extension.room.speakers')}>{drawn.map(person => <button key={person.id} type="button" className={d.personRow} onClick={() => showPerson(c, person)}>
      <PersonAvatar person={person} size="sm" />
      <span><strong>{person.id === c.data.self ? t('extension.page.you') : person.name}</strong><small>{accountLabel(person.id)}</small></span>
      {person.mate && <span className={d.mate}>{t('extension.room.mate')}</span>}
    </button>)}</SettingGroup> : read.status !== 'error' ? <EmptyState title={people ? t('extension.room.noSpeakers') : t('extension.copy.loading')} fill={false} /> : null}
  </>;
}

/** 已屏蔽: people whose 弹幕 are hidden on every device of this account. */
export function BlockedPeople({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const read = useRoomRead(c, 'blocks');
  const people = c.live?.state.rooms.blocked ?? [];
  const feedback = read.status === 'error' ? <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback> : null;
  if (!people.length) return feedback ?? <EmptyState icon={<Ban />} title={t(read.status === 'loading' ? 'extension.copy.loading' : 'extension.room.noBlocked')} />;
  return <>{feedback}<SettingGroup>{people.map(item => {
    const person = roomPerson(c, item, t('common.member'));
    return <div key={person.id} className={d.personRow}>
      <PersonAvatar person={person} size="sm" />
      <span><strong>{person.name}</strong><small>{accountLabel(person.id)}</small></span>
      <Button size="sm" variant="surface" className={d.unblock} onClick={() => void c.run('room-block', { accountId: person.id, blocked: false })}>{t('extension.room.unblock')}</Button>
    </div>;
  })}</SettingGroup></>;
}
