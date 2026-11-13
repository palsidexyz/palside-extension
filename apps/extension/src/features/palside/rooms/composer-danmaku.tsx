'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, Eye } from 'lucide-react';
import { motionPresets } from '@palside/design/motion';
import { IconButton } from '@palside/ui/button';
import { Tooltip } from '@palside/ui/tooltip';
import { ROOM_TEXT_MAX } from '@palside/shared/rules/rooms';
import type { RoomView } from '../../../runtime/rooms/state';
import { Count } from '../ui/motion-details';
import { PersonAvatar } from '../ui/primitives';
import { setSocialUi } from '../annotations/social-state';
import { pageIssue } from '../feedback/session-notice';
import type { PalsideController } from '../app/use-palside';
import { followedTabRoomKey, openRoom, roomCount, roomElsewhere, roomPerson, roomsOn, tabRoomKey, useRoomDrafts } from './rooms';
import { siteBlocked, turnOnDanmaku, useRoomSend } from './danmaku-view';
import { Envelope, PacketDetail } from '../wallet/packet';
import { roomPacketLive, useRoomPackets, type RoomPacket } from '../wallet/room-payments';
import { personFor } from '../../../domain/account/model';
import k from './composer-danmaku.module.css';

/**
 * Whether the composer carries the 弹幕 line. One panel session; it never outlives the panel. `lap` / `loud`:
 * the token whose arrival lap is running / whose 在看 badge is green right now; `lapped` / `heard`: tokens that already had them, so a
 * return to the same token stays quiet.
 */
const store = { on: false, lap: undefined as string | undefined, loud: undefined as string | undefined, lapped: new Set<string>(), heard: new Set<string>(), listeners: new Set<() => void>() };
function update(next: Partial<Pick<typeof store, 'on' | 'lap' | 'loud'>>) { Object.assign(store, next); for (const listener of store.listeners) listener(); }
function subscribe(listener: () => void) { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }

/** The 弹幕 the composer can send to: the token the active tab shows on an added site, and its live room once it has loaded. */
export function useComposerDanmaku(c: PalsideController) {
  const on = useSyncExternalStore(subscribe, () => store.on, () => false);
  const shown = roomsOn(c);
  const key = shown ? followedTabRoomKey(c) : undefined;
  const current = c.live.state.rooms.current;
  // 弹幕 is live server data only: without the service the line holds no list or count that may be stale.
  const offline = Boolean(key) && Boolean(pageIssue(c, 'service'));
  const room = key && !offline && current?.key === key ? current : undefined;
  return { shown, key, room, offline, on: on && Boolean(key) };
}

/**
 * 弹幕: the 弹幕 key beside 发送, 32px high. The word 弹幕 (Danmaku) in a dashed box with slightly rounded corners: grey where there is no token
 * 弹幕 can follow, still on a token page, and once pressed its dashes run round the box like marquee lights for as long as the 弹幕 line is
 * open. The key never fills. Gone with 弹幕 itself (设置 › 网页互动 › 弹幕).
 *
 * Grey, it says why: no token page, 弹幕 is in another window, or this token page's site has 弹幕 off or is not allowed — then pressing it
 * opens that site's sheet (or 设置 › 网页互动 when 弹幕 is off for every site's pages), the same as the 弹幕 view's 开启 / 授权.
 *
 * Arriving on a token: the dashes run one lap as soon as the token is known — once per token per panel session, and never again after
 * the key has been pressed once (rooms.used). The 在看 count joins only when the room has loaded with someone in it: green for 3s the first
 * time per token, then a quiet number that only rolls. It hangs off the box's top-right corner, never over 发送, and moves with the box. No
 * badge while loading, offline or with the line open (the line shows 👁 N itself).
 */
export function DanmakuKey({ c, lineRef }: { c: PalsideController; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const { shown, key, room, on } = useComposerDanmaku(c);
  const used = Boolean(c.live.state.preferences.rooms?.used);
  const lap = useSyncExternalStore(subscribe, () => store.lap, () => undefined);
  const loud = useSyncExternalStore(subscribe, () => store.loud, () => undefined);
  const usedSent = useRef(false);
  const count = room ? roomCount(c, room.key) ?? room.count : 0;
  const badge = Boolean(room) && !on && count > 0;
  useEffect(() => {
    if (!key || store.lapped.has(key)) return;
    store.lapped.add(key);
    if (used || reduced) return;
    update({ lap: key });
    const timer = setTimeout(() => { if (store.lap === key) update({ lap: undefined }); }, 1400);
    return () => { clearTimeout(timer); if (store.lap === key) update({ lap: undefined }); };
  }, [key, used, reduced]);
  useEffect(() => {
    if (!badge || !key || store.heard.has(key)) return;
    store.heard.add(key);
    update({ loud: key });
    const timer = setTimeout(() => { if (store.loud === key) update({ loud: undefined }); }, 3000);
    return () => { clearTimeout(timer); if (store.loud === key) update({ loud: undefined }); };
  }, [badge, key]);
  if (!shown) return null;
  // No token 弹幕 follows: on a token page whose site keeps 弹幕 out, pressing asks for it there.
  const gate = !key && !roomElsewhere(c) && Boolean(tabRoomKey(c)) && Boolean(siteBlocked(c));
  const label = key ? on ? t('extension.room.composerOff') : t('extension.room.placeholder')
    : roomElsewhere(c) ? t('extension.room.elsewhere') : gate ? t('extension.room.gateTitle') : t('extension.room.noToken');
  function press() {
    if (!key) { if (gate) turnOnDanmaku(c); return; }
    const next = !on;
    update({ on: next });
    if (next) requestAnimationFrame(() => lineRef.current?.focus());
    if (!used && !usedSent.current) {
      usedSent.current = true;
      void c.live.command('preferences', { accountId: c.data.self, rooms: { used: true } }).catch(() => { usedSent.current = false; });
    }
  }
  return <Tooltip content={label}><IconButton size="sm" variant="quiet" className={k.key} label={label} aria-pressed={key ? on : undefined} aria-disabled={!key && !gate || undefined}
    aria-haspopup={gate ? 'dialog' : undefined} data-state={on ? 'on' : key ? 'ready' : gate ? 'gate' : 'off'} data-lap={lap && lap === key ? '' : undefined} onClick={press}>
    <DanmakuGlyph>
      <AnimatePresence initial={false}>{badge && <motion.span key={key} className={k.badge} data-loud={loud === key || undefined} aria-hidden="true"
        initial={{ opacity: 0, scale: reduced ? 1 : .4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .4 }}
        transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 520, damping: 22 }}><Count value={count} compact /></motion.span>}</AnimatePresence>
    </DanmakuGlyph>
  </IconButton></Tooltip>;
}

/**
 * The key's face: the feature's name (弹幕 / Danmaku) in a dashed, slightly rounded box that fits the word. The key runs the dashes while
 * 弹幕 is on. The box's perimeter is measured so the arrival lap is exactly one turn in every language.
 * `children` hang off the box itself (the key's 在看 badge), so they never move against it.
 */
function DanmakuGlyph({ children }: { children?: ReactNode }) {
  const t = useTranslations();
  const box = useRef<SVGRectElement>(null);
  const [lap, setLap] = useState<number>();
  const name = t('extension.room.name');
  useLayoutEffect(() => { const length = box.current?.getTotalLength(); if (length) setLap(length); }, [name]);
  return <span className={k.glyph} style={lap ? { '--lap': `${-lap}px` } as CSSProperties : undefined}>
    <svg fill="none" className={k.frame} aria-hidden="true"><rect ref={box} className={k.dash} rx="4.5" /></svg>
    <b aria-hidden="true">{name}</b>
    {children}
  </span>;
}

type Drafts = ReturnType<typeof useRoomDrafts>;

/** The 弹幕 line at the top of the composer while 弹 is on; its draft is the token's one draft, shared with the 弹幕 page. */
export function DanmakuLine({ c, lineRef }: { c: PalsideController; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const { shown, key, room, offline, on } = useComposerDanmaku(c);
  const drafts = useRoomDrafts(c.live.state.authenticated ? c.data.self : '');
  // 弹幕 switched off forgets the open line.
  useEffect(() => { if (!shown && store.on) update({ on: false }); }, [shown]);
  const reduced = useReducedMotion();
  const motionProps = reduced ? {} : { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: .26, ease: [.22, 1, .36, 1] as const } };
  return <>
    <AnimatePresence initial={false}>{on && key && <motion.div key={key} className={k.slot} {...motionProps}>
      {room ? <LineField c={c} room={room} drafts={drafts} lineRef={lineRef} />
        : <div className={k.line}><PersonAvatar person={c.me} size="xs" /><span className={k.field}><input ref={lineRef} className={k.input} disabled aria-label={t('extension.room.placeholder')} placeholder={offline ? t('extension.copy.sendWhenConnected') : t('extension.copy.loading')} /></span></div>}
    </motion.div>}</AnimatePresence>
  </>;
}

type Passing = { id: string; message?: RoomView['messages'][number]; packet?: RoomPacket };
/** What passes through the empty 弹幕 line: 红包 I can still grab first, newest first, then others' newest 弹幕. */
function passing(c: PalsideController, room: RoomView, packets: RoomPacket[]): Passing[] {
  const blocked = new Set((c.live.state.rooms.blocked ?? []).map(person => person.id));
  const live = packets.filter(packet => roomPacketLive(packet, c) && !(packet.accountId && blocked.has(packet.accountId))).reverse().map(packet => ({ id: packet.id, packet }));
  const lines = room.messages.filter(message => !message.folded && !blocked.has(message.author.id) && message.author.id !== c.data.self).slice(-6).reverse().map(message => ({ id: message.id, message }));
  return [...live, ...lines];
}

/**
 * One 弹幕 line: my face (this goes out in public, as me), the field, then 👁 N (opens 在看的人) and ↗ (this token's 弹幕 page). While
 * the field is empty 红包 and others' newest lines pass through it one by one — a 红包 opens its envelope right there; typing replaces
 * them with 发送. Enter sends to 弹幕, Esc on empty closes.
 */
function LineField({ c, room, drafts, lineRef }: { c: PalsideController; room: RoomView; drafts: Drafts; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const { text, setText, length, slow, ready, send, key: enter, sendLabel } = useRoomSend(c, room, drafts, lineRef);
  const lines = passing(c, room, useRoomPackets(c, room.key));
  const [turn, setTurn] = useState(0), [packet, setPacket] = useState<RoomPacket>();
  const cycling = !text && lines.length > 1 && !reduced;
  useEffect(() => { if (!cycling) return; const timer = setInterval(() => setTurn(value => value + 1), 3600); return () => clearInterval(timer); }, [cycling]);
  const line = !text ? lines[turn % Math.max(lines.length, 1)] : undefined;
  const count = roomCount(c, room.key) ?? room.count;
  const watching = t('extension.room.watching', { count });
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Esc on an empty line closes it and hands the keyboard back to the squad field below.
    if (event.key === 'Escape' && !text) { event.preventDefault(); event.stopPropagation(); update({ on: false }); document.querySelector<HTMLElement>('[data-message-input]')?.focus(); return; }
    enter(event);
  }
  return <div className={k.line}>
    <PersonAvatar person={c.me} size="xs" />
    <span className={k.field}>
      <input ref={lineRef} className={k.input} value={text} aria-label={t('extension.room.placeholder')} placeholder={line ? '' : t('extension.room.placeholder')} onChange={event => setText(event.target.value)} onKeyDown={keyDown} />
      <AnimatePresence initial={false} mode="popLayout">{line && <motion.span key={line.id} className={k.passing} aria-hidden={line.message ? 'true' : undefined}
        initial={reduced ? { opacity: 0 } : { y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: -14, opacity: 0 }} transition={{ duration: .32, ease: [.22, 1, .36, 1] }}>
        {line.message ? <><b>{roomPerson(c, line.message.author, t('common.member')).name}</b>{line.message.text}</>
          : <button type="button" className={k.packet} onClick={() => setPacket(line.packet)}><Envelope size="xs" /><b>{t('extension.wallet.packetFrom', { name: packetSender(c, line.packet!, t('common.member'), t('common.deletedMember')) })}</b></button>}
      </motion.span>}</AnimatePresence>
    </span>
    {length > ROOM_TEXT_MAX - 10 && <small className={k.counter} data-over={length > ROOM_TEXT_MAX || undefined}><Count value={length} />/{ROOM_TEXT_MAX}</small>}
    {/* 发送 takes the place of 👁 N and ⌃ only while there is text; a slow-mode wait counts down on it. */}
    {text
      ? <IconButton size="sm" variant={ready ? 'primary' : 'surface'} className={k.send} label={sendLabel} disabled={!ready} onClick={() => void send()}>{slow > 0 ? <span role="timer"><Count value={slow} /></span> : <ArrowUp size={16} aria-hidden="true" />}</IconButton>
      : <>
        <Tooltip content={watching}><button type="button" className={k.watch} aria-label={watching} onClick={() => { setSocialUi({ people: room.key }); c.go('room-people'); }}><Eye size={14} strokeWidth={2.2} aria-hidden="true" /><Count value={count} /></button></Tooltip>
        <Tooltip content={t('extension.room.openFull')}><IconButton size="sm" variant="quiet" className={k.expand} label={t('extension.room.openFull')} onClick={() => openRoom(c, room.key)}><ArrowUpRight size={16} /></IconButton></Tooltip>
      </>}
    {packet && <PacketDetail c={c} id={packet.id} summary={packet} onClose={() => setPacket(undefined)} />}
  </div>;
}

/** The sender's name as the room knows them: its faces, speakers and lines, else the squad's people. */
function packetSender(c: PalsideController, packet: RoomPacket, member: string, deleted: string) {
  const rooms = c.live.state.rooms;
  const known = [...rooms?.current?.faces ?? [], ...rooms?.people?.people ?? [], ...rooms?.current?.messages.map(message => message.author) ?? []].find(person => person.id === packet.accountId);
  return known ? roomPerson(c, known, member).name : personFor(c.people, packet.accountId, member, deleted).name;
}
