'use client';
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, ChevronUp, Eye, X } from 'lucide-react';
import { IconButton } from '@palside/ui/button';
import { Sheet } from '@palside/ui/sheet';
import { Tooltip } from '@palside/ui/tooltip';
import { ROOM_TEXT_MAX } from '@palside/shared/rules/rooms';
import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { RoomView } from '../../../runtime/rooms/state';
import { Count } from '../ui/motion-details';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { TokenName, tokenWaiting } from '../assets/token-name';
import { setSocialUi } from '../annotations/social-state';
import { pageIssue } from '../feedback/session-notice';
import type { PalsideController } from '../app/use-palside';
import { followedTabRoomKey, openRoom, roomCount, roomPerson, roomView, roomsOn, useRoomDrafts } from './rooms';
import { RoomBar, RoomList, useRoomSend } from './danmaku-view';
import ac from '../settings/access-sheet.module.css';
import k from './composer-danmaku.module.css';

/** Whether the composer carries the 弹幕 line, and whether its sheet is open. One panel session; it never outlives the panel. */
const store = { on: false, open: false, listeners: new Set<() => void>() };
function update(next: Partial<Pick<typeof store, 'on' | 'open'>>) { Object.assign(store, next); for (const listener of store.listeners) listener(); }
function subscribe(listener: () => void) { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }

/** The 弹幕 the composer can send to: the token the active tab shows on an added site, and its live room once it has loaded. */
export function useComposerDanmaku(c: PalsideController) {
  const on = useSyncExternalStore(subscribe, () => store.on, () => false);
  const open = useSyncExternalStore(subscribe, () => store.open, () => false);
  const shown = roomsOn(c);
  const key = shown ? followedTabRoomKey(c) : undefined;
  const current = c.live?.state.rooms.current;
  // 弹幕 is live server data only: without the service the line holds no list or count that may be stale.
  const offline = Boolean(key) && Boolean(pageIssue(c, 'service'));
  const room = key && !offline && current?.key === key ? current : undefined;
  return { shown, key, room, offline, on: on && Boolean(key), open: on && open && Boolean(room) };
}

/**
 * 弹: the 弹幕 key beside 发送, in the same 32px slot. A bilibili-style 弹 in a dashed square with slightly rounded corners (two passing
 * lines outside Chinese): grey where there is no token, still on a token page, and once pressed its dashes run round the box like marquee
 * lights for as long as the 弹幕 line is open. The key never fills.
 */
export function DanmakuKey({ c, lineRef }: { c: PalsideController; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const { shown, key, on } = useComposerDanmaku(c);
  if (!shown) return null;
  const label = !key ? t('extension.room.noToken') : on ? t('extension.room.composerOff') : t('extension.room.placeholder');
  return <Tooltip content={label}><IconButton size="sm" variant="quiet" className={k.key} label={label} aria-pressed={key ? on : undefined} aria-disabled={!key || undefined} data-state={on ? 'on' : key ? 'ready' : 'off'}
    onClick={() => { if (!key) return; const next = !on; update({ on: next, open: false }); if (next) requestAnimationFrame(() => lineRef.current?.focus()); }}>
    <DanmakuGlyph />
  </IconButton></Tooltip>;
}

/** The 弹 glyph: 弹 (or two passing lines) in a dashed, slightly rounded square. The key runs the dashes while 弹幕 is on; the tour shows it still. */
export function DanmakuGlyph() {
  const zh = useLocale().startsWith('zh');
  return <span className={k.glyph} aria-hidden="true">
    <svg viewBox="0 0 22 22" fill="none" className={k.frame}><rect className={k.dash} x="1" y="1.75" width="20" height="18.5" rx="4.5" pathLength="100" /></svg>
    {zh ? <b>弹</b> : <svg viewBox="0 0 22 22" fill="none" className={k.lines}><path d="M8.5 8.6h7" /><path d="M6.5 13.4h7" /></svg>}
  </span>;
}

type Drafts = ReturnType<typeof useRoomDrafts>;

/** The 弹幕 line at the top of the composer while 弹 is on, and the sheet ⌃ opens. Both share one draft per token. */
export function DanmakuLine({ c, lineRef }: { c: PalsideController; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const { key, room, offline, on, open } = useComposerDanmaku(c);
  const drafts = useRoomDrafts(c.live?.state.authenticated ? c.data.self : '');
  const reduced = useReducedMotion();
  const motionProps = reduced ? {} : { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: .26, ease: [.22, 1, .36, 1] as const } };
  return <>
    <AnimatePresence initial={false}>{on && key && <motion.div key={key} className={k.slot} {...motionProps}>
      {room ? <LineField c={c} room={room} drafts={drafts} lineRef={lineRef} />
        : <div className={k.line}><PersonAvatar person={c.me} size="xs" /><span className={k.field}><input ref={lineRef} className={k.input} disabled aria-label={t('extension.room.placeholder')} placeholder={offline ? t('extension.copy.sendWhenConnected') : t('extension.copy.loading')} /></span></div>}
    </motion.div>}</AnimatePresence>
    {key && <DanmakuSheet c={c} roomKey={key} room={room} drafts={drafts} open={open} />}
  </>;
}

/** Others' newest 弹幕, newest first: what passes through the empty 弹幕 line. */
function passing(c: PalsideController, room: RoomView) {
  const blocked = new Set((c.live?.state.rooms.blocked ?? []).map(person => person.id));
  return room.messages.filter(message => !message.folded && !blocked.has(message.author.id) && message.author.id !== c.data.self).slice(-6).reverse();
}

/**
 * One 弹幕 line: my face (this goes out in public, as me), the field, then 👁 N (opens 在看的人) and ⌃ (the sheet). While the field is
 * empty others' newest lines pass through it one by one; typing replaces them with 发送. Enter sends to 弹幕, Esc on empty closes.
 */
function LineField({ c, room, drafts, lineRef }: { c: PalsideController; room: RoomView; drafts: Drafts; lineRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const { text, setText, length, slow, ready, send, key: enter, sendLabel } = useRoomSend(c, room, drafts, lineRef);
  const lines = passing(c, room);
  const [turn, setTurn] = useState(0);
  const cycling = !text && lines.length > 1 && !reduced;
  useEffect(() => { if (!cycling) return; const timer = setInterval(() => setTurn(value => value + 1), 3600); return () => clearInterval(timer); }, [cycling]);
  const line = !text ? lines[turn % Math.max(lines.length, 1)] : undefined;
  const count = roomCount(c, room.key) ?? room.count;
  const watching = t('extension.room.watching', { count });
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Esc on an empty line closes it and hands the keyboard back to the squad field below.
    if (event.key === 'Escape' && !text) { event.preventDefault(); event.stopPropagation(); update({ on: false, open: false }); document.querySelector<HTMLElement>('[data-message-input]')?.focus(); return; }
    enter(event);
  }
  return <div className={k.line}>
    <PersonAvatar person={c.me} size="xs" />
    <span className={k.field}>
      <input ref={lineRef} className={k.input} value={text} aria-label={t('extension.room.placeholder')} placeholder={line ? '' : t('extension.room.placeholder')} onChange={event => setText(event.target.value)} onKeyDown={keyDown} />
      <AnimatePresence initial={false} mode="popLayout">{line && <motion.span key={line.id} className={k.passing} aria-hidden="true"
        initial={reduced ? { opacity: 0 } : { y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: -14, opacity: 0 }} transition={{ duration: .32, ease: [.22, 1, .36, 1] }}>
        <b>{roomPerson(c, line.author, t('common.member')).name}</b>{line.text}
      </motion.span>}</AnimatePresence>
    </span>
    {length > ROOM_TEXT_MAX - 10 && <small className={k.counter} data-over={length > ROOM_TEXT_MAX || undefined}><Count value={length} />/{ROOM_TEXT_MAX}</small>}
    {/* 发送 takes the place of 👁 N and ⌃ only while there is text; a slow-mode wait counts down on it. */}
    {text
      ? <IconButton size="sm" variant={ready ? 'primary' : 'surface'} className={k.send} label={sendLabel} disabled={!ready} onClick={() => void send()}>{slow > 0 ? <span role="timer"><Count value={slow} /></span> : <ArrowUp size={16} aria-hidden="true" />}</IconButton>
      : <>
        <Tooltip content={watching}><button type="button" className={k.watch} aria-label={watching} onClick={() => { setSocialUi({ people: room.key }); c.go('room-people'); }}><Eye size={14} strokeWidth={2.2} aria-hidden="true" /><Count value={count} /></button></Tooltip>
        <Tooltip content={t('extension.room.expand')}><IconButton size="sm" variant="quiet" className={k.expand} label={t('extension.room.expand')} aria-haspopup="dialog" onClick={() => update({ open: true })}><ChevronUp size={16} /></IconButton></Tooltip>
      </>}
  </div>;
}

/** ⌃: the token's 弹幕 in a bottom sheet over the chat — the list and the same bar as the full 弹幕 view (打赏, field, 发送). ↗ goes to that view. */
function DanmakuSheet({ c, roomKey, room, drafts, open }: { c: PalsideController; roomKey: RoomKey; room?: RoomView; drafts: Drafts; open: boolean }) {
  const t = useTranslations();
  const view = roomView(c, roomKey);
  const count = roomCount(c, roomKey) ?? room?.count ?? 0;
  const watching = t('extension.room.watching', { count });
  const close = () => update({ open: false });
  return <Sheet open={open && Boolean(room)} onOpenChange={value => { if (!value) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="danmaku-sheet-title" className={`${ac.sheet} ${k.sheet}`}>
    {room && <>
      <header className={k.head}>
        <Token view={view} size="sm" waiting={tokenWaiting(c, view)} />
        <h2 id="danmaku-sheet-title"><TokenName c={c} view={view} /></h2>
        <Tooltip content={watching}><button type="button" className={k.watch} aria-label={watching} onClick={() => { close(); setSocialUi({ people: roomKey }); c.go('room-people'); }}><Eye size={14} strokeWidth={2.2} aria-hidden="true" /><Count value={count} /></button></Tooltip>
        <span className={k.headTools}>
          <Action label={t('extension.room.openFull')} onClick={() => { close(); openRoom(c, roomKey); }}><ArrowUpRight /></Action>
          <Action label={t('common.close')} onClick={close}><X /></Action>
        </span>
      </header>
      <div className={k.list}><RoomList c={c} room={room} /></div>
      <RoomBar c={c} room={room} drafts={drafts} autoFocus />
    </>}
  </Sheet>;
}
