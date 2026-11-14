'use client';
import { SECOND_MS } from '@palside/shared/units';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { tagLabel, tagKey } from '../../../domain/account/profile-tags';
import { chatTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { Count, CountText, Swap } from '../ui/motion-details';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Ban, Check, ChevronDown, Copy, Flag, Gift, HandCoins, MessageCircle, MoreHorizontal, Undo2, UserPlus, X } from 'lucide-react';
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
import { personFor, type Person } from '../../../domain/account/model';
import { roomKnownPeople, roomPerson, roomView, teammateIds, useRoomRead, useRoomDrafts, openTokenSite, tokenSiteChoice } from './rooms';
import type { Viewing } from '../../../domain/assets/model';
import { LikeIcon } from '../ui/icons';
import { SiteLogo } from '../assets/site-logo';
import { openSiteSheet } from '../viewing/page-key';
import { allSites, siteAllows } from '../../../domain/annotations/interaction';
import { TipPayment, useRoomPackets, type RoomPacket } from '../wallet/room-payments';
import { PacketDetail } from '../wallet/packet';
import { PalsAmount } from '../wallet/amount';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';
import ac from '../settings/access-sheet.module.css';
import card from '../account/person-card.module.css';
import d from './danmaku.module.css';
import { EmptyState } from '../ui/empty-state';
import { whenWalletOpen } from '../wallet/closed';
import { TokenName,tokenLabel,tokenWaiting } from '../assets/token-name';
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

type TokenSite = ReturnType<typeof tokenSiteChoice>['sites'][number];
/** 去网站, one pill: the default site's logo and name open the token there; ⌄ lists every site that shows it, the default ticked. A choice opens there and becomes the default. */
export function TokenSites({ c, view, sites, site }: { c: PalsideController; view: Viewing; sites: TokenSite[]; site: TokenSite }) {
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
export function turnOnDanmaku(c: PalsideController) {
  if (siteBlocked(c) === 'site' && !allSites(c.siteInteraction).danmaku) { setSocialUi({ settingsTab: 'danmaku' }); c.go('interaction'); return; }
  openSiteSheet(c, false);
}

/** Why 弹幕 cannot follow this tab's site: Chrome has not allowed it (or hides which it is), or 网页互动 or 弹幕 is off there. */
export function siteBlocked(c: PalsideController): 'chrome' | 'site' | undefined {
  if (capability(c, 'interact').state === 'access') return 'chrome';
  if (c.pageHost && !siteAllows(c.siteInteraction, c.pageHost, 'danmaku')) return 'site';
}

/** The 弹幕 and the 红包 sent here, in the order they came; older pages load as the list reaches its top. */
export function RoomList({ c, room }: { c: PalsideController; room: RoomView }) {
  const t = useTranslations();
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const paging = useRef(false);
  const height = useRef(0);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const blocked = new Set((c.live.state.rooms.blocked ?? []).map(person => person.id));
  const messages = room.messages.filter(message => !blocked.has(message.author.id));
  // 红包 stand in the stream at the moment they were sent, like a squad's packet cards; older than the loaded lines they wait above.
  const packets = useRoomPackets(c, room.key).filter(packet => !(packet.accountId && blocked.has(packet.accountId)) && (!room.hasMore || !messages[0] || packet.createdAt >= messages[0].createdAt));
  const items: { at: number; id: string; message?: RoomMessage; packet?: RoomPacket }[] = [...messages.map(message => ({ at: message.createdAt, id: message.id, message })), ...packets.map(packet => ({ at: packet.createdAt, id: packet.id, packet }))]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const mates = teammateIds(c);
  const newest = items.at(-1)?.id, oldest = items[0]?.id;
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
  if (!items.length) return <div className={d.empty}><MessageCircle aria-hidden="true" /><p>{room.loading ? t('extension.copy.loading') : t('extension.room.empty')}</p></div>;
  return <div ref={list} className={d.list} role="log" aria-label={t('extension.room.name')} tabIndex={0} onScroll={scroll}>
    {room.hasMore && <span className={d.more}>{t('extension.copy.loading')}</span>}
    {items.map(item => item.message
      ? <RoomLine key={item.id} c={c} message={item.message} mate={mates.has(item.message.author.id)} open={shown.has(item.id)} onShow={() => setShown(old => new Set(old).add(item.id))} />
      : <RoomPacketRow key={item.id} c={c} packet={item.packet!} mate={Boolean(item.packet!.accountId && mates.has(item.packet!.accountId))} />)}
  </div>;
}

/**
 * A 红包 in the stream is a 弹幕 line of its own: the sender's face and name, then the wish in packet red after a small envelope, and
 * on the right where it stands — a gold 开 while I can grab it, else 已领取 / 红包已结束 / 你发出的红包 (a quiet 开 when it is not mine to
 * grab yet; the envelope says why). The words and the seal both open the envelope.
 */
/** Who sent a 红包, as the room knows them (its faces, speakers and lines), else as my squads do. */
function packetSender(c: PalsideController, id: string | null, member: string, deleted: string) {
  const known = roomKnownPeople(c).find(person => person.id === id);
  return { known: Boolean(known), person: known ? roomPerson(c, known, member) : { ...personFor(c.people, id, member, deleted), mate: teammateIds(c).has(id ?? '') } };
}

function RoomPacketRow({ c, packet, mate }: { c: PalsideController; packet: RoomPacket; mate: boolean }) {
  const t = useTranslations();
  const self = packet.accountId === c.data.self;
  const { person, known } = packetSender(c, packet.accountId, t('common.member'), t('common.deletedMember'));
  const look = usePacketLook(c, packet), state = packetState(t, packet, self, look);
  const open = () => setSocialUi({ roomPacket: { key: packet.scope, id: packet.id } });
  return <div className={d.row} data-room-line="" data-room-packet={packet.id} data-self={self || undefined}>
    <button type="button" data-mate={mate || undefined} aria-label={t('extension.copy.openProfile', { name: person.name })} disabled={!known && !self} onClick={() => showPerson(c, person)}><PersonAvatar person={person} size="room" /></button>
    <div className={d.messageBody}><div className={d.messageHead}><b>{self ? t('extension.page.you') : person.name}</b></div>
      <p><button type="button" className={d.packetWords} onClick={open}><span className={d.packetGlyph} aria-hidden="true" />{look?.blessing || t('extension.wallet.packet')}</button></p></div>
    <button type="button" className={d.packetSeal} data-live={state.live || undefined} onClick={open}>{state.word}</button><span aria-hidden="true" className={d.packetSpacer} />
  </div>;
}

type PacketLook = { blessing: string; eligibility: string };
/** The packet's wish and my standing, read once it shows and again when it changes. */
function usePacketLook(c: PalsideController, packet: RoomPacket) {
  const command = c.live.command, revision = c.live.state.chainRevision;
  const [look, setLook] = useState<PacketLook>();
  useEffect(() => {
    if (packet.status === 'pending') return;
    let on = true;
    void command('wallet-packet', { id: packet.id }).then(value => { if (on && value) setLook(value as PacketLook); }, () => {});
    return () => { on = false; };
  }, [command, packet.id, packet.status, packet.claimedCount, revision]);
  return look;
}
/** What the 红包's seal says — 开 while I can grab it, else where it stands. */
function packetState(t: ReturnType<typeof useTranslations>, packet: RoomPacket, self: boolean, look?: PacketLook) {
  if (packet.status === 'pending') return { word: t('extension.copy.sending'), live: false };
  if (self) return { word: t('extension.wallet.eligibility.sender'), live: false };
  if (look?.eligibility === 'claimed') return { word: t('extension.wallet.eligibility.claimed'), live: false };
  if (packet.status !== 'active' || packet.claimedCount >= packet.count || look?.eligibility === 'unavailable') return { word: t('extension.wallet.eligibility.unavailable'), live: false };
  // Not mine to grab yet (too new, joined late, …): a quiet 开 — the envelope says why.
  return { word: t('extension.wallet.open'), live: !look || look.eligibility === 'eligible' };
}

/** The 红包 here I can still grab, newest first — live, not mine, and the server says I am eligible and have not claimed. */
function useClaimable(c: PalsideController, room: RoomView) {
  const command = c.live.command, revision = c.live.state.chainRevision;
  const live = useRoomPackets(c, room.key).filter(packet => packet.status === 'active' && packet.claimedCount < packet.count && packet.expiresAt > c.now && packet.accountId !== c.data.self).reverse();
  const [standing, setStanding] = useState<Record<string, string>>({});
  const ids = live.map(packet => `${packet.id}:${packet.claimedCount}`).join();
  useEffect(() => {
    let on = true;
    for (const packet of live) void command('wallet-packet', { id: packet.id }).then(value => { const eligibility = (value as PacketLook | undefined)?.eligibility; if (on && eligibility) setStanding(old => old[packet.id] === eligibility ? old : { ...old, [packet.id]: eligibility }); }, () => {});
    return () => { on = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, ids, revision]);
  return live.filter(packet => standing[packet.id] === 'eligible');
}

/**
 * The 红包 I can still grab ride one bar between the token card and the 弹幕 — the newest with its wish, +N for the rest.
 * Each 红包 is its own draw (its own share, its own claim), so they open one by one; the bar steps to the next once one is
 * grabbed, and the result sheet offers the next straight away. The red lines in the stream open the same envelope.
 */
export function PacketBar({ c, room }: { c: PalsideController; room: RoomView }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const asked = useSocialUi().roomPacket, opened = asked?.key === room.key ? asked.id : undefined;
  const open = (id: string) => setSocialUi({ roomPacket: { key: room.key, id } });
  const queue = useClaimable(c, room);
  const all = useRoomPackets(c, room.key);
  const shown = queue.filter(packet => packet.id !== opened), packet = shown[0];
  const wish = useWish(c, packet);
  const next = shown[0] && { count: shown.length, open: () => open(shown[0]!.id) };
  return <>
    <AnimatePresence initial={false}>{packet && <motion.div key="bar" className={d.packetBarSlot} data-room-packet=""
      initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: .24, ease: [.22, 1, .36, 1] }}>
      <button type="button" className={d.packetStrip} data-live="" onClick={() => open(packet.id)}>
        <span className={d.packetGlyph} aria-hidden="true" />
        <AnimatePresence mode="popLayout" initial={false}><motion.span key={packet.id} className={d.packetBarText}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }} transition={{ duration: .2 }}>
          <b>{t('extension.wallet.packetFrom', { name: packetSender(c, packet.accountId, t('common.member'), t('common.deletedMember')).person.name })}</b><span className={d.packetWish}>{wish}</span>
        </motion.span></AnimatePresence>
        {shown.length > 1 && <span className={d.packetMore}>+<Count value={shown.length - 1} /></span>}
        <span className={d.packetSeal} data-live="">{t('extension.wallet.open')}</span>
      </button>
    </motion.div>}</AnimatePresence>
    {opened && <PacketDetail key={opened} c={c} id={opened} summary={all.find(item => item.id === opened)} next={next} onClose={() => setSocialUi({ roomPacket: undefined })} />}
  </>;
}
function useWish(c: PalsideController, packet?: RoomPacket) {
  const look = usePacketLook(c, packet ?? { id: '', status: 'pending' } as RoomPacket);
  return packet ? look?.blessing ?? '' : '';
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
      <div className={d.messageHead}><b>{name}</b><time dateTime={new Date(message.createdAt).toISOString()}>{roomTime(message.createdAt, c.now, locale)}</time></div>
      <p>{message.folded && !open ? <span className={d.folded}>{t('extension.room.folded')}<Button size="sm" variant="surface" className={d.foldedAction} onClick={onShow}>{t('extension.room.show')}</Button></span> : message.text}</p>
      {message.tips?.length ? <TipNote c={c} tips={message.tips} /> : null}
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
  const like = c.live.state.rooms.current?.likes?.[message.id];
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
  const toggle = () => { setPressed(true); void c.live.command('room-like', { key: message.key, id: message.id, liked: !liked }).catch(error => c.setNotice(errorMessage(error))); };
  return <Tooltip content={liked ? t('extension.room.unlike') : label}>
    <button type="button" className={d.like} data-count={count ? '' : undefined} aria-pressed={liked} aria-label={liked ? t('extension.room.unlike') : t('extension.room.like')} onClick={toggle}>{body}</button>
  </Tooltip>;
}
/** Six sparks 12px out, the first straight up. */
const LIKE_SPARKS = Array.from({ length: 6 }, (_, index) => { const angle = index / 6 * Math.PI * 2 - Math.PI / 2; return [Math.round(Math.cos(angle) * 12), Math.round(Math.sin(angle) * 12)] as const; });

type TipGroups = NonNullable<RoomMessage['tips']>;
/** Everyone who tipped the line across its 30-second groups, names folded into “等 N 人”, and the total. */
function useTippers(c: PalsideController, tips: TipGroups) {
  const t = useTranslations();
  const known = roomKnownPeople(c);
  const ids = [...new Set(tips.flatMap(group => group.accountIds))];
  const people = ids.map(id => known.find(person => person.id === id) ?? { id, nickname: '', avatarId: null, wallet: null });
  const names = people.map(person => person.id === c.data.self ? t('extension.page.you') : roomPerson(c, person, t('common.member')).name);
  const label = names.length > 2 ? t('extension.wallet.tipPeople', { names: names.slice(0, 2).join('、'), count: names.length }) : names.join('、');
  const total = tips.reduce((sum, group) => sum + BigInt(group.amount), 0n).toString();
  return { label, total };
}

/** 打赏 under the text, once per line: the coin, who tipped (“A、B 等 N 人”), the total. It springs in; on each new tip the coin pops and the total rolls. */
function TipNote({ c, tips }: { c: PalsideController; tips: TipGroups }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const { label, total } = useTippers(c, tips);
  return <motion.div className={d.tipNote} initial={reduced ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
    <motion.span key={total} className={d.tipCoin} initial={reduced ? false : { scale: 1.35, rotate: -18 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }}><HandCoins aria-hidden="true" /></motion.span>
    <Swap k={label}><span>{label}</span></Swap><span>{t('extension.wallet.tipped')}</span><b><PalsAmount value={total} /></b>
  </motion.div>;
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
      confirm: async () => { await c.live.command('room-report', { id: message.id }); c.setNotice(uiMessage('extension.room.reported')); } });
  }
  function retract() {
    c.setConfirmation({ title: uiMessage('extension.room.retractTitle'), description: uiMessage('extension.room.retractDescription'), action: uiMessage('extension.copy.recall'), danger: true,
      confirm: async () => { await c.live.command('room-retract', { id: message.id }); } });
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

/** One 弹幕 draft and its send rules — length, the slow-mode countdown, one send at a time — shared by the 弹幕 page's box and the composer's 弹幕 line. */
export function useRoomSend(c: PalsideController, room: RoomView, drafts: ReturnType<typeof useRoomDrafts>, input: RefObject<HTMLInputElement | null>) {
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
  return { text, setText, length, slow, ready, send, key, sendLabel };
}

/** Someone met in 弹幕: who they are, and 邀请进小队 / 屏蔽 / 举报 (this account). */
export function RoomPersonSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const social = useSocialUi(), id = social.roomPerson;
  const [tipping, setTipping] = useState(false);
  const tipMessage = c.live.state.rooms.current?.messages.find(item => item.id === social.roomPersonMessage && item.author.id === id && !item.folded);
  const close = () => setSocialUi({ roomPerson: undefined });
  const rooms = c.live.state.rooms;
  const found = id ? roomKnownPeople(c).find(person => person.id === id) : undefined;
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
  const live = c.live, command = live.command, accountId = live.state.account?.id;
  const [opening, setOpening] = useState({ id, accountId });
  if (opening.id !== id || opening.accountId !== accountId) setOpening({ id, accountId });
  const [options, setOptions] = useState<{ opening: typeof opening; value?: InviteOptions; status: 'error' | 'success'; eligibility: string; revision: number }>();
  const [revision, setRevision] = useState(0);
  const [pick, setPick] = useState<{ team: string; options: typeof options }>();
  const [sending, setSending] = useState<typeof opening>();
  const eligibility = JSON.stringify(c.teams.map(team => [team.id, team.joined, team.memberIds, team.owner, team.readonly, live.state.remoteTeams.find(item => item.id === team.id)?.membersCanInvite]));
  const active = useRef<typeof opening | undefined>(opening);
  useLayoutEffect(() => { active.current = opening; return () => { active.current = undefined; }; }, [opening]);
  useEffect(() => {
    if (!command || !id) return;
    let current = true;
    void command('invite-options', { accountId: id }).then(value => { if (current) setOptions({ opening, value, status: 'success', eligibility, revision }); }, () => { if (current) setOptions(old => ({ value: old?.opening.id === id && old.opening.accountId === accountId ? old.value : undefined, opening, status: 'error', eligibility, revision })); });
    return () => { current = false; };
  }, [id, command, accountId, opening, eligibility, revision]);
  const rooms = live.state.rooms;
  const found = id ? roomKnownPeople(c).find(person => person.id === id) : undefined;
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
  const rooms = c.live.state.rooms;
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
  const people = c.live.state.rooms.blocked ?? [];
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
