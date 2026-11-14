'use client';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ChevronRight, Eye, Gift } from 'lucide-react';
import { IconButton } from '@palside/ui/button';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Tooltip } from '@palside/ui/tooltip';
import { ROOM_TEXT_MAX } from '@palside/shared/rules/rooms';
import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { RoomView } from '../../../runtime/rooms/state';
import { Count } from '../ui/motion-details';
import { Action, Token } from '../ui/primitives';
import { TokenName, tokenLabel, tokenWaiting } from '../assets/token-name';
import { ChainPicker, tabChainChoices } from '../assets/chain-picker';
import { whenWalletOpen } from '../wallet/closed';
import { openPacketForm } from '../wallet/packet';
import { ConnectionState } from '../feedback/session-notice';
import { setSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';
import { closeDanmaku, firstVisit, followedTabRoomKey, lapRunning, openDanmaku, roomCount, roomElsewhere, roomView, tabRoomKey, tokenSiteChoice, updateDanmaku, useDanmaku, useRoomDrafts } from './rooms';
import { Faces, PacketBar, RoomList, TokenSites, siteBlocked, turnOnDanmaku, useRoomSend } from './danmaku-view';
import s from '../app/palside.module.css';
import d from './danmaku.module.css';
import k from './composer-danmaku.module.css';

/**
 * 弹幕: the 弹幕 key beside 发送, 32px high. The word 弹幕 (Danmaku) in a dashed box with slightly rounded corners: grey where there is no token
 * 弹幕 can follow, still on a token page, and once pressed its dashes run round the box like marquee lights for as long as 弹幕 holds the
 * chat area. The key never fills. Gone with 弹幕 itself (设置 › 网页互动 › 弹幕).
 *
 * Grey, it says why: no token page, 弹幕 is in another window, or this token page's site has 弹幕 off or is not allowed — then pressing it
 * opens that site's sheet (or 设置 › 网页互动 when 弹幕 is off for every site's pages).
 *
 * Arriving on a token: the dashes run one lap as soon as the token is known — once per token per panel session, and never again after
 * the key has been pressed once (rooms.used). Hovering the key reads 「发弹幕 · 23 人在看」 once the room has someone in it.
 */
export function DanmakuKey({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const { shown, key, room, on, lap } = useDanmaku(c);
  const used = Boolean(c.live.state.preferences.rooms?.used);
  const usedSent = useRef(false);
  const count = room ? roomCount(c, room.key) ?? room.count : 0;
  useEffect(() => {
    if (!key || !firstVisit(key) || used || reduced) return;
    updateDanmaku({ lap: key });
    const timer = setTimeout(() => { if (lapRunning(key)) updateDanmaku({ lap: undefined }); }, 1400);
    return () => { clearTimeout(timer); if (lapRunning(key)) updateDanmaku({ lap: undefined }); };
  }, [key, used, reduced]);
  if (!shown) return null;
  // No token 弹幕 follows: on a token page whose site keeps 弹幕 out, pressing asks for it there.
  const gate = !key && !roomElsewhere(c) && Boolean(tabRoomKey(c)) && Boolean(siteBlocked(c));
  const label = key ? on ? t('extension.room.composerOff') : count > 0 ? t('extension.room.placeholderWatching', { count }) : t('extension.room.placeholder')
    : roomElsewhere(c) ? t('extension.room.elsewhere') : gate ? t('extension.room.gateTitle') : t('extension.room.noToken');
  function press() {
    if (!key) { if (gate) turnOnDanmaku(c); return; }
    if (on) { closeDanmaku(c); return; }
    openDanmaku();
    if (!used && !usedSent.current) {
      usedSent.current = true;
      void c.live.command('preferences', { accountId: c.data.self, rooms: { used: true } }).catch(() => { usedSent.current = false; });
    }
  }
  return <Tooltip content={label}><IconButton size="sm" variant="quiet" className={k.key} label={label} aria-pressed={key ? on : undefined} aria-disabled={!key && !gate || undefined}
    aria-haspopup={gate ? 'dialog' : undefined} data-state={on ? 'on' : key ? 'ready' : gate ? 'gate' : 'off'} data-lap={lap && lap === key ? '' : undefined} onClick={press}>
    <DanmakuGlyph />
  </IconButton></Tooltip>;
}

/**
 * The key's face: the feature's name (弹幕 / Danmaku) in a dashed, slightly rounded box that fits the word. The key runs the dashes while
 * 弹幕 is on. The box's perimeter is measured so the arrival lap is exactly one turn in every language.
 */
function DanmakuGlyph() {
  const t = useTranslations();
  const box = useRef<SVGRectElement>(null);
  const [lap, setLap] = useState<number>();
  const name = t('extension.room.name');
  useLayoutEffect(() => { const length = box.current?.getTotalLength(); if (length) setLap(length); }, [name]);
  return <span className={k.glyph} style={lap ? { '--lap': `${-lap}px` } as CSSProperties : undefined}>
    <svg fill="none" className={k.frame} aria-hidden="true"><rect ref={box} className={k.dash} rx="4.5" /></svg>
    <b aria-hidden="true">{name}</b>
  </span>;
}

/**
 * The composer while 弹幕 is on: one row on the squad composer's surface — 红包 (into this token's 弹幕), the field, 弹幕 (pressed), 发送.
 * The draft is the token's one draft. Enter sends; Esc on an empty field, or 弹幕 again, returns to the squad. Before the room has
 * loaded (or without the service) the row keeps its shape with nothing to send.
 */
export function RoomComposer({ c, room, offline }: { c: PalsideController; room?: RoomView; offline: boolean }) {
  const t = useTranslations();
  const drafts = useRoomDrafts(c.live.state.authenticated ? c.data.self : '');
  const close = (event: KeyboardEvent<HTMLInputElement>) => { event.preventDefault(); event.stopPropagation(); closeDanmaku(c); };
  return <div className={s.composerWrap}>
    <div className={`${s.composer} ${k.row}`} data-composer-surface>
      {room ? <RoomField c={c} room={room} drafts={drafts} onClose={close} /> : <>
        <Action label={t('extension.wallet.createPacket')} disabled><Gift /></Action>
        <input data-message-input className={k.input} aria-label={t('extension.room.placeholder')} placeholder={offline ? t('extension.copy.sendWhenConnected') : t('extension.copy.loading')} readOnly
          onKeyDown={event => { if (event.key === 'Escape') close(event); }} />
        <DanmakuKey c={c} />
        <IconButton size="sm" className={s.sendButton} label={t('extension.copy.sendMessage')} variant="surface" disabled><ArrowUp /></IconButton>
      </>}
    </div>
  </div>;
}

function RoomField({ c, room, drafts, onClose }: { c: PalsideController; room: RoomView; drafts: ReturnType<typeof useRoomDrafts>; onClose: (event: KeyboardEvent<HTMLInputElement>) => void }) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const { text, setText, length, slow, ready, send, key: enter, sendLabel } = useRoomSend(c, room, drafts, input);
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && !text) { onClose(event); return; }
    enter(event);
  }
  return <>
    <Action label={t('extension.wallet.createPacket')} onClick={() => whenWalletOpen(c, () => openPacketForm(c, { kind: 'room', key: room.key }))}><Gift /></Action>
    <input ref={input} data-message-input className={k.input} value={text} aria-label={t('extension.room.placeholder')} placeholder={t('extension.room.placeholder')}
      onChange={event => setText(event.target.value)} onKeyDown={keyDown} />
    {length > ROOM_TEXT_MAX - 10 && <small className={k.counter} data-over={length > ROOM_TEXT_MAX || undefined}><Count value={length} />/{ROOM_TEXT_MAX}</small>}
    <DanmakuKey c={c} />
    <IconButton size="sm" className={s.sendButton} label={sendLabel} variant={ready ? 'primary' : 'surface'} disabled={!ready} onClick={() => void send()}>
      {slow > 0 ? <span role="timer"><Count value={slow} /></span> : <ArrowUp />}
    </IconButton>
  </>;
}

/**
 * The token's 弹幕 where the squad's messages were. On top, in 共享在看's slot, the token's card: the token (opening 详情, with 切换链 when
 * the tab's address is on several chains), 去网站 when the token is not the tab's own, and who is watching. Under it the 红包 I can still
 * grab, then the 弹幕 — one dense line each. Squad messages that arrive meanwhile raise one pill at the foot that leads back.
 */
export function RoomPane({ c, roomKey, room, offline, squadNew = 0 }: { c: PalsideController; roomKey: RoomKey; room?: RoomView; offline: boolean; squadNew?: number }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const count = roomCount(c, roomKey) ?? room?.count ?? 0;
  const watching = t('extension.room.watching', { count });
  const view = roomView(c, roomKey), away = followedTabRoomKey(c) !== roomKey;
  const choice = away ? tokenSiteChoice(c, view, room?.site) : undefined;
  const asset = roomKey.slice('token:'.length), chains = tabRoomKey(c) === roomKey ? tabChainChoices(c, asset) : [];
  return <motion.div key={roomKey} className={k.pane} initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .26, ease: [.22, 1, .36, 1] }}>
    <div className={k.slot}><div className={k.card}>
      <span className={k.target}>
        <Tooltip content={t('extension.current.detail', { name: tokenLabel(view, t, c) })}><button type="button" className={k.token} onClick={() => c.selectAsset(view.id, view)}>
          <Token view={view} size="sm" waiting={tokenWaiting(c, view)} /><b><TokenName c={c} view={view} /></b><ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
        </button></Tooltip>
        {chains.length > 1 && <ChainPicker c={c} assets={chains} current={asset} onPick={pick => { void c.live.command('page-chain', { asset: pick }).catch(() => {}); }} />}
        {choice?.site && <TokenSites c={c} view={view} sites={choice.sites} site={choice.site} />}
      </span>
      {room && !offline && <Tooltip content={watching}><button type="button" className={k.watch} aria-label={watching} onClick={() => { setSocialUi({ people: roomKey }); c.go('room-people'); }}>
        <Faces c={c} people={room.faces} /><Eye size={14} strokeWidth={2.2} aria-hidden="true" /><Count value={count} />
      </button></Tooltip>}
    </div></div>
    {offline ? <ConnectionState c={c} />
      : room?.failed ? <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => { void c.live.command('room-retry').catch(() => {}); } }}>{t('extension.room.loadFailed')}</InlineFeedback>
      : room ? <><PacketBar c={c} room={room} /><RoomList key={room.key} c={c} room={room} /></>
      : <div className={d.empty}><p>{t('extension.copy.loading')}</p></div>}
    <AnimatePresence>{squadNew > 0 && <motion.button key="news" type="button" className={k.squadNews} onClick={() => closeDanmaku(c)}
      initial={{ opacity: 0, y: 8, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 8, x: '-50%' }} transition={{ duration: .22 }}>
      <b>{c.team.name}</b><span>{t('extension.dynamic.newMessages', { count: squadNew })}</span></motion.button>}</AnimatePresence>
  </motion.div>;
}
