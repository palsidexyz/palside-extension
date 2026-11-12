'use client';
import { SECOND_MS } from '@palside/shared/units';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { tagLabel, tagKey } from '../../../domain/account/profile-tags';
import { chatTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { Count, CountText, Swap } from '../ui/motion-details';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionPresets } from '@palside/design/motion';
import { ArrowUp, ArrowUpRight, Ban, Check, ChevronDown, Copy, Flag, Gift, HandCoins, MessageCircle, MoreHorizontal, Undo2, UserPlus, X } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { ROOM_TEXT_MAX } from '@palside/shared/rules/rooms';
import type { InviteOptions, RoomMessage, RoomPerson } from '../../../runtime/rooms/contract-types';
import { TEAM_MEMBER_LIMIT } from '@palside/shared/rules/teams';
import type { RoomView } from '../../../runtime/rooms/state';
import { Sheet } from '@palside/ui/sheet';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { TeamAvatar } from '../teams/team-avatar';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { SettingGroup } from '../settings/setting-rows';
import { AccountId, AccountIdText, accountHandle } from '../account/account-id';
import { capability } from '../settings/access';
import { characterLength } from '../../../domain/chat/model';
import { type Person } from '../../../domain/account/model';
import { openRoom, roomElsewhere, roomPerson, roomView, roomsOn, tabRoomKey, teammateIds, useRoomRead, useRoomOpening, useRoomDrafts, tokenSiteChoice, openTokenSite, useShownRoomKey } from './rooms';
import type { Viewing } from '../../../domain/assets/model';
import { DanmakuIcon, HotIcon, LikeIcon } from '../ui/icons';
import { SiteFace, SiteLogo } from '../assets/site-logo';
import { openSiteSheet, pageSite, pageUnusable } from '../viewing/page-key';
import { allSites, siteAllows } from '../../../domain/annotations/interaction';
import { RoomPayments, TipPayment } from '../wallet/room-payments';
import { PalsAmount } from '../wallet/amount';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';
import ac from '../settings/access-sheet.module.css';
import card from '../account/person-card.module.css';
import d from './danmaku.module.css';
import { EmptyState } from '../ui/empty-state';
import { ConnectionState, pageIssue } from '../feedback/session-notice';
import { whenWalletOpen } from '../wallet/closed';
import { TokenName,tokenLabel,tokenWaiting } from '../assets/token-name';
import { RecentTokens } from './recent-tokens';
import { tokenStats } from '../assets/token-data';

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

/**
 * 弹幕 tab: 去网站 and 热门 on one row, then the messages and a one-line box. The token is the one being
 * opened, else the pinned one, else the active tab's; on other pages the tab stays here and says what it is waiting for.
 */
export function DanmakuView({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const rooms = c.live?.state.rooms;
  const opening = useRoomOpening(c);
  const drafts = useRoomDrafts(c.live?.state.authenticated ? c.data.self : '');
  const key = useShownRoomKey(c);
  const room = key && rooms?.current?.key === key ? rooms.current : undefined;
  const screen = c.screen, go = c.go, on = roomsOn(c);
  // 弹幕 cannot follow this site — Chrome has not allowed it, or 弹幕 is off there. Ask where it may be a token page: any page Chrome
  // hides, or a token page it names. A page Chrome names but Palside cannot use (local, private, a browser page) says so instead.
  const unusable = pageUnusable(c);
  const blocked = siteBlocked(c);
  const gate = Boolean(c.live) && !unusable && Boolean(blocked) && (!c.pageHost || Boolean(tabRoomKey(c)));
  useEffect(() => { if (screen === 'room' && !on) go('chat'); }, [screen, on, go]);
  // 弹幕 is live server data only: without the service the token's view is the connection state, never a list that may be stale.
  const offline = Boolean(key) && Boolean(pageIssue(c, 'service'));
  if (c.screen !== 'room') return null;
  return <div className={d.view} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); c.go('chat'); } }}>
    {!offline && <RoomToolbar c={c} roomKey={key} room={room} />}
    {key && !offline && <RoomPayments c={c} roomKey={key} />}
    <SwitchRow c={c} shown={key} />
    {!offline && opening?.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => openRoom(c, opening.key) }}>{t('common.error')}</InlineFeedback>}
    {!offline && room?.failed && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => { void c.live?.command('room-retry').catch(() => {}); } }}>{t('extension.room.loadFailed')}</InlineFeedback>}
    {!key ? <Skeleton /> : offline ? <ConnectionState c={c} /> : room ? <RoomList key={room.key} c={c} room={room} /> : opening?.status !== 'error' ? <div className={d.empty}><p>{t('extension.copy.loading')}</p></div> : null}
    {room && !offline && !room.failed ? <RoomBar key={`bar-${room.key}`} c={c} room={room} drafts={drafts} /> : <IdleBar />}
    <AnimatePresence initial={false}>{!key && <Frost key="frost" c={c} reason={roomElsewhere(c) ? 'elsewhere' : gate ? 'gate' : unusable ? 'unusable' : 'idle'} />}</AnimatePresence>
  </div>;
}

/** When the tab is not on this token's page: which token this 弹幕 is, and 去网站 at the row's end. No row on its own page. */
function RoomToolbar({ c, roomKey, room }: { c: PalsideController; roomKey?: string; room?: RoomView }) {
  const view = roomKey ? roomView(c, roomKey) : undefined;
  const choice = view && tabRoomKey(c) !== roomKey ? tokenSiteChoice(c, view, room?.site) : undefined;
  if (!view || !choice?.site) return null;
  return <div className={d.toolbar}>
    <Token view={view} size="sm" waiting={tokenWaiting(c, view)} /><strong><TokenName c={c} view={view} /></strong>
    <TokenSites c={c} view={view} sites={choice.sites} site={choice.site} />
  </div>;
}

type TokenSite = ReturnType<typeof tokenSiteChoice>['sites'][number];
/** 去网站, one pill: the default site's logo and name open the token there; ⌄ lists every site that shows it, the default ticked. A choice opens there and becomes the default. */
function TokenSites({ c, view, sites, site }: { c: PalsideController; view: Viewing; sites: TokenSite[]; site: TokenSite }) {
  const t = useTranslations();
  const label = t('extension.room.openOn', { name: site.name });
  const menuLabel = t('extension.dynamic.openSource', { name: tokenLabel(view, t, c) });
  return <span className={d.sites}>
    <Tooltip content={label}><button type="button" className={d.siteOpen} aria-label={label} onClick={() => openTokenSite(c, site)}>
      <SiteLogo site={site} size="xs" /><span className={d.siteName}>{site.name}</span><ArrowUpRight className={d.siteArrow} size={13} strokeWidth={2.4} aria-hidden="true" />
    </button></Tooltip>
    <Menu boundarySelector="[data-palside-app]" align="end">
      <Tooltip content={t('extension.room.otherSite')}><MenuTrigger asChild><button type="button" className={d.siteMore} aria-label={t('extension.room.otherSite')}><ChevronDown size={14} aria-hidden="true" /></button></MenuTrigger></Tooltip>
      <MenuContent aria-label={menuLabel} className={d.siteMenu}>
        <div className={d.siteMenuHead}>{menuLabel}</div>
        {[site, ...sites.filter(item => item.id !== site.id)].map(item => <MenuItem key={item.id} icon={<SiteLogo site={item} size="xs" />} aria-current={item.id === site.id || undefined} onClick={() => openTokenSite(c, item)}>
          <span className={d.chainOption}>{item.name}{item.id === site.id && <Check size={14} aria-hidden="true" />}</span>
        </MenuItem>)}
      </MenuContent>
    </Menu>
  </span>;
}

/** 开启 opens the site's sheet; 弹幕 switched off for every site in 设置 › 网页互动 has no tile there, so it opens that page instead. */
function turnOnDanmaku(c: PalsideController) {
  if (siteBlocked(c) === 'site' && !allSites(c.siteInteraction).danmaku) { setSocialUi({ settingsTab: 'danmaku' }); c.go('interaction'); return; }
  openSiteSheet(c, false);
}

/** Why 弹幕 cannot follow this tab's site: Chrome has not allowed it (or hides which it is), or 网页互动 or 弹幕 is off there. */
function siteBlocked(c: PalsideController): 'chrome' | 'site' | undefined {
  if (capability(c, 'interact').state === 'access') return 'chrome';
  if (c.pageHost && !siteAllows(c.siteInteraction, c.pageHost, 'danmaku')) return 'site';
}

/** The box before there is a token to talk about: the same shape, nothing to type into. */
function IdleBar() {
  const t = useTranslations();
  return <div className={d.bar} aria-disabled="true">
    <IconButton size="sm" variant="quiet" label={t('extension.wallet.createPacket')} disabled><Gift size={16} /></IconButton>
    <input className={d.input} aria-label={t('extension.room.placeholder')} placeholder={t('extension.room.placeholder')} disabled />
    <IconButton size="sm" variant="solid" className={d.send} label={t('extension.copy.sendMessage')} disabled><ArrowUp size={16} /></IconButton>
  </div>;
}

/**
 * The row under the toolbar. The tab moved to another token: offer it, and 切换 lets the 弹幕 follow the tab again. On this token's own
 * page, when 弹幕 cannot show there: say the page shows none of it, and 授权 / 开启 opens the site's sheet.
 */
function SwitchRow({ c, shown }: { c: PalsideController; shown?: string }) {
  const t = useTranslations();
  const key = tabRoomKey(c);
  if (!key || !shown) return null;
  if (key === shown) {
    const blocked = siteBlocked(c);
    if (!c.pageHost || !blocked) return null;
    return <div className={d.switchRow} data-notice="">
      <SiteFace site={pageSite(c)} off className={d.noticeLogo} /><strong>{t('extension.room.notOnPage')}</strong>
      <Button size="sm" variant="solid" className={d.switchButton} aria-haspopup="dialog" onClick={() => openSiteSheet(c, false)}>{t(blocked === 'chrome' ? 'extension.grant.allow' : 'extension.grant.turnOn')}</Button>
    </div>;
  }
  // 切换 follows the tab, which 弹幕 can do only where Chrome allows the site.
  if (!c.live?.page?.access.site) return null;
  const view = roomView(c, key);
  return <div className={d.switchRow}>
    <Token view={view} size="sm" waiting={tokenWaiting(c, view)} /><strong><TokenName c={c} view={view} /></strong>
    <Button size="sm" variant="solid" className={d.switchButton} onClick={() => { void c.run('room-close'); }}>{t('extension.room.switch')}</Button>
  </div>;
}

/** The shape of a room under the frost: grey avatars and lines only, so nothing unproven shows through. */
function Skeleton() {
  return <div className={d.skeleton} aria-hidden="true">
    {[[34, 72], [48, 46], [40, 84], [56, 58], [44, 38]].map(([name, line], index) => <div key={index}><i /><span><b style={{ width: name }} /><b style={{ width: `${line}%` }} /></span></div>)}
  </div>;
}

/**
 * No token to show: the room frosts over and says why, with the way on. 热门 opens any token's room from anywhere; where Chrome has not
 * allowed the site (or hides which it is) the page may be a token's, so 授权 comes first. It thaws as soon as a token arrives.
 */
function Frost({ c, reason }: { c: PalsideController; reason: 'idle' | 'unusable' | 'gate' | 'elsewhere' }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const hot = () => c.go('hot');
  return <motion.div className={d.frost} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>
    <motion.div key={reason} className={d.frostBody} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>
      {reason === 'gate' ? <SiteFace site={pageSite(c)} off className={d.gateLogo} /> : <span className={d.frostGlyph}>{reason === 'unusable' ? <Ban /> : <DanmakuIcon size={22} />}</span>}
      <strong>{t(reason === 'gate' ? 'extension.room.gateTitle' : reason === 'unusable' ? 'extension.room.pageUnusable' : reason === 'elsewhere' ? 'extension.room.elsewhere' : 'extension.room.noToken')}</strong>
      {(reason === 'idle' || reason === 'unusable') && <RecentTokens c={c} />}
      {reason === 'gate'
        ? <><Button variant="primary" className={d.frostAction} aria-haspopup="dialog" onClick={() => turnOnDanmaku(c)}>{t(siteBlocked(c) === 'site' ? 'extension.grant.turnOn' : 'extension.grant.allow')}</Button>
          <button type="button" className={d.frostLink} onClick={hot}><HotIcon size={14} />{t('extension.hot.tokens')}</button></>
        : <Button variant={reason === 'unusable' ? 'surface' : 'primary'} className={d.frostAction} leadingIcon={<HotIcon size={16} />} onClick={hot}>{t('extension.hot.tokens')}</Button>}
    </motion.div>
  </motion.div>;
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
    {messages.map(message => <RoomLine key={message.id} c={c} message={message} mate={mates.has(message.author.id)} open={shown.has(message.id)} onShow={() => setShown(old => new Set(old).add(message.id))} />)}
  </div>;
}

function RoomLine({ c, message, mate, open, onShow }: { c: PalsideController; message: RoomMessage; mate: boolean; open: boolean; onShow: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const self = message.author.id === c.data.self;
  const person = roomPerson(c, message.author, t('common.member'));
  const name = self ? t('extension.page.you') : person.name;
  return <div className={d.row} data-room-line={message.id} data-mate={mate || undefined} data-self={self || undefined}>
    <button type="button" data-mate={mate || undefined} aria-label={t('extension.copy.openProfile', { name: person.name })} onClick={() => showPerson(c, person, message.id)}><PersonAvatar person={person} size="room" /></button>
    <div className={d.messageBody}>
      <div className={d.messageHead}><b>{name}</b>{message.tips?.length ? <TipChip value={message.tips.reduce((total, item) => total + BigInt(item.amount), 0n).toString()} /> : null}<time dateTime={new Date(message.createdAt).toISOString()}>{roomTime(message.createdAt, c.now, locale)}</time></div>
      <p>{message.folded && !open ? <span className={d.folded}>{t('extension.room.folded')}<Button size="sm" variant="surface" className={d.foldedAction} onClick={onShow}>{t('extension.room.show')}</Button></span> : message.text}</p>
      {message.tips?.map(group => <TipGroupLine key={group.id} c={c} accountIds={group.accountIds} amount={group.amount} />)}
    </div>
    {(!message.folded || open) && <LineLike c={c} message={message} self={self} />}
    <span className={d.menu}><LineMenu c={c} message={message} name={person.name} self={self} /></span>
  </div>;
}

/** 点赞: always on the line's right, at the foot of the text. One press likes and fills the thumb (it pops with a small burst); again takes it back. Own lines show their count only. */
function LineLike({ c, message, self }: { c: PalsideController; message: RoomMessage; self: boolean }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  // Only a press of this button animates; a liked state that arrives from the server or on mount just shows.
  const [pressed, setPressed] = useState(false);
  const like = c.live?.state.rooms.current?.likes?.[message.id];
  const count = like?.count ?? 0, liked = Boolean(like?.liked);
  const label = count ? t('extension.room.likes', { count }) : t('extension.room.like');
  const pop = liked && pressed && !reduced;
  const body = <>
    <motion.span key={String(liked)} className={d.likeIcon} initial={pop ? { scale: .55, rotate: -18 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 560, damping: 14 }}>
      <LikeIcon size={15} filled={liked} />
      {pop && <span className={d.likeBurst} aria-hidden="true">{LIKE_SPARKS.map(([x, y]) => <motion.i key={`${x},${y}`} initial={{ x: 0, y: 0, scale: 1, opacity: 1 }} animate={{ x, y, scale: .3, opacity: 0 }} transition={{ duration: .5, ease: 'easeOut' }} />)}</span>}
    </motion.span>
    {count > 0 && <Count value={count} />}
  </>;
  if (self) return count ? <span className={d.like} data-count="" role="img" aria-label={label}>{body}</span> : null;
  const toggle = () => { setPressed(true); void c.live?.command('room-like', { key: message.key, id: message.id, liked: !liked }).catch(error => c.setNotice(errorMessage(error))); };
  return <Tooltip content={liked ? t('extension.room.unlike') : label}>
    <button type="button" className={d.like} data-count={count ? '' : undefined} aria-pressed={liked} aria-label={liked ? t('extension.room.unlike') : t('extension.room.like')} onClick={toggle}>{body}</button>
  </Tooltip>;
}
/** Six sparks 12px out, the first straight up. */
const LIKE_SPARKS = Array.from({ length: 6 }, (_, index) => { const angle = index / 6 * Math.PI * 2 - Math.PI / 2; return [Math.round(Math.cos(angle) * 12), Math.round(Math.sin(angle) * 12)] as const; });

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
  const people = accountIds.map(id => known.find(person => person.id === id) ?? { id, nickname: '', avatarId: null, wallet: null });
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
      <MenuItem className={d.messageAction} icon={<Copy size={16} />} onClick={() => { void c.copy(message.text); }}>{t('extension.copy.copy')}</MenuItem>
      {!self && !message.folded && <MenuItem className={d.messageAction} icon={<Gift size={16} />} onClick={() => whenWalletOpen(c, () => setTipping(true))}>{t('extension.wallet.tip')}</MenuItem>}
      {!self && <MenuItem className={d.messageAction} icon={<Flag size={16} />} tone="danger" disabled={message.reported} onClick={report}>{message.reported ? t('extension.room.reported') : t('extension.copy.report')}</MenuItem>}
      {self && <MenuItem className={d.messageAction} icon={<Undo2 size={16} />} tone="danger" onClick={retract}>{t('extension.copy.recall')}</MenuItem>}
    </MenuContent>
  </Menu>{tipping && <TipPayment c={c} messageId={message.id} onClose={() => setTipping(false)} />}</>;
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
  const slow = Math.ceil((room.slowUntil - now) / SECOND_MS);
  const ready = length > 0 && length <= ROOM_TEXT_MAX && !sending && slow <= 0 && !c.disconnected;
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
    <Tooltip content={t('extension.wallet.createPacket')}><IconButton size="sm" variant="quiet" label={t('extension.wallet.createPacket')} onClick={() => whenWalletOpen(c, () => c.go('wallet-packet'))}><Gift size={16} /></IconButton></Tooltip>
    <input ref={input} className={d.input} value={text} aria-label={t('extension.room.placeholder')} placeholder={t('extension.room.placeholder')} onChange={event => setText(event.target.value)} onKeyDown={key} />
    {length > ROOM_TEXT_MAX - 10 && <small className={d.counter} data-over={length > ROOM_TEXT_MAX || undefined}><Count value={length} />/{ROOM_TEXT_MAX}</small>}
    <Tooltip content={sendLabel}><IconButton size="sm" variant="solid" className={d.send} label={sendLabel} disabled={!ready} onClick={() => void send()}>{slow > 0 ? <span role="timer"><Count value={slow} /></span> : <ArrowUp size={16} aria-hidden="true" />}</IconButton></Tooltip>
  </div>;
}

/** Someone met in 弹幕: who they are, and 邀请进小队 / 屏蔽 / 举报 (this account). */
export function RoomPersonSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const social = useSocialUi(), id = social.roomPerson;
  const [tipping, setTipping] = useState(false);
  const tipMessage = c.live?.state.rooms.current?.messages.find(item => item.id === social.roomPersonMessage && item.author.id === id && !item.folded);
  const close = () => setSocialUi({ roomPerson: undefined });
  const rooms = c.live?.state.rooms;
  const found = id ? [...rooms?.current?.faces ?? [], ...rooms?.people?.people ?? [], ...rooms?.current?.messages.map(message => message.author) ?? []].find(person => person.id === id) : undefined;
  const person = found && roomPerson(c, found, t('common.member')), address = person?.walletAddress;
  const blocked = Boolean(person && rooms?.blocked.some(item => item.id === person.id));
  function report() {
    if (!person) return;
    close(); c.setReportTarget({ kind: 'account', targetId: person.id, preview: [person.name, accountHandle(person)].filter(Boolean).join(' ') }); c.go('report');
  }
  if (tipping && tipMessage) return <TipPayment c={c} messageId={tipMessage.id} onClose={() => { setTipping(false); close(); }} />;
  return <Sheet open={Boolean(person)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="room-person-title" className={`${ac.sheet} ${card.person}`}>
    {person && <>
      <header className={card.head}>
        <PersonAvatar person={person} size="lg" />
        <div className={card.name}><h2 id="room-person-title">{person.name}</h2>{address && <p><span className={card.handle}><AccountId c={c} address={address} /></span></p>}</div>
        <Action label={t('extension.copy.closeProfile')} onClick={close}><X /></Action>
      </header>
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
        <Button size="lg" variant="solid" className={d.inviteSend} disabled={!chosen || sending === opening} onClick={() => void send()}>{t('extension.invite.send')}</Button>
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
  const view = roomView(c, key);
  const drawn = (people?.people ?? []).map(person => roomPerson(c, person, t('common.member'), mates)).sort((a, b) => Number(b.mate) - Number(a.mate));
  return <>
    <div className={d.peopleHead}><Token view={view} size="sm" waiting={tokenWaiting(c, view)} /><span className={d.peopleText}><strong><TokenName c={c} view={view} /></strong><small>{(count => <CountText text={t('extension.room.watching', { count })} value={count} />)(tokenStats(c, key)?.count ?? people?.count ?? 0)}</small></span><Faces c={c} people={tokenStats(c, key)?.faces ?? []} /></div>
    {read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    {drawn.length ? <SettingGroup title={t('extension.room.speakers')}>{drawn.map(person => <button key={person.id} type="button" className={d.personRow} onClick={() => showPerson(c, person)}>
      <PersonAvatar person={person} size="sm" />
      <span><strong>{person.id === c.data.self ? t('extension.page.you') : person.name}</strong><AccountIdText address={person.walletAddress} /></span>
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
      <span><strong>{person.name}</strong><AccountIdText address={person.walletAddress} /></span>
      <Button size="sm" variant="surface" className={d.unblock} onClick={() => void c.run('room-block', { accountId: person.id, blocked: false })}>{t('extension.room.unblock')}</Button>
    </div>;
  })}</SettingGroup></>;
}
