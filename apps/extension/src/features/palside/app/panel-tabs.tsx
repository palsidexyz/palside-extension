'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { ChevronRight } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { Count } from '../ui/motion-details';
import { Token } from '../ui/primitives';
import { roomCount, roomView, roomsOn, tabRoomKey, useShownRoomKey } from '../rooms/rooms';
import { ChainPicker, tabChainChoices } from '../assets/chain-picker';
import type { PalsideController } from './use-palside';
import s from './panel-tabs.module.css';
import { TokenName,tokenLabel } from '../assets/token-name';

/** 聊天 | 弹幕 live in the header whenever 弹幕 is on: the two places the panel can show. */
export function panelTabsShown(c: PalsideController) { return roomsOn(c); }

/**
 * The fixed 聊天 | 弹幕 switch at the top right: a grey track with a white thumb that slides to where you are. Both stay put on both pages.
 * 聊天 carries the squad's new messages while you read 弹幕; how many watch the token is the 弹幕 title's second line, not a tab mark.
 * The two tabs are always equally wide — the wider of the two in the current language, marks included — so the thumb only slides.
 * The switch never narrows again while the language stays: a count or @N that comes and goes does not make the words jump.
 */
export function PanelSwitch({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const locale = useLocale();
  const key = useShownRoomKey(c);
  const count = key ? roomCount(c, key) : undefined;
  const room = c.screen === 'room';
  const chat = useRef<HTMLButtonElement>(null), danmaku = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number }>();
  const [floor, setFloor] = useState<{ locale: string; width: number }>();
  const mentions = c.team.mentions ?? 0, unread = c.team.unread > 0;
  const held = floor?.locale === locale ? floor.width : undefined;
  useLayoutEffect(() => {
    const width = box.current?.offsetWidth ?? 0;
    if (width > (held ?? 0)) { setFloor({ locale, width }); return; }
    const on = (room ? danmaku : chat).current;
    if (on) setThumb(old => old?.left === on.offsetLeft && old.width === on.offsetWidth ? old : { left: on.offsetLeft, width: on.offsetWidth });
  }, [room, mentions, unread, locale, held]);
  const chatLabel = t('extension.discussion.chat'), roomLabel = t('extension.room.name');
  return <div ref={box} className={s.switch} style={{ minWidth: held }} data-tour="tabs" role="tablist" aria-label={`${chatLabel} / ${roomLabel}`}>
    {thumb && <i className={s.thumb} style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }} aria-hidden="true" />}
    <button ref={chat} type="button" role="tab" aria-selected={!room} aria-label={mentions > 0 ? t('extension.dynamic.teamMentions', { name: chatLabel, count: mentions }) : t('extension.dynamic.teamUnread', { name: chatLabel, count: c.team.unread })} onClick={() => { if (room) c.go('chat'); }}>
      {chatLabel}
      {room && (mentions > 0 ? <span className={s.mention} aria-hidden="true">@<Count value={mentions} /></span> : unread && <span className={s.dot} aria-hidden="true" />)}
    </button>
    <button ref={danmaku} type="button" role="tab" aria-selected={room} aria-label={count === undefined ? roomLabel : `${roomLabel} · ${t('extension.room.watching', { count })}`} onClick={() => { if (!room) c.go('room'); }}>
      {roomLabel}
    </button>
  </div>;
}

/** On 弹幕 the title is the token and 币名 › on one line, opening 详情; the header puts 👁 N after it. Without a token it just says 弹幕. */
export function RoomTitle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const key = useShownRoomKey(c);
  if (!key) return <h1 className={s.plain}>{t('extension.room.name')}</h1>;
  const view = roomView(c, key);
  const label = t('extension.current.detail', { name: tokenLabel(view, t, c) });
  // The tab's address is a token on several chains: 切换链 sits after the title, and 弹幕 follows the tab onto the picked chain.
  const asset = key.slice('token:'.length), choices = tabRoomKey(c) === key ? tabChainChoices(c, asset) : [];
  const title = <Tooltip content={label}><button type="button" className={s.title} aria-label={label} onClick={() => c.selectAsset(view.id, view)}>
    <Token view={view} size="sm" />
    <h1 data-header-name><TokenName c={c} view={view} /></h1><ChevronRight className={s.chevron} size={14} strokeWidth={2.2} aria-hidden="true" />
  </button></Tooltip>;
  if (choices.length < 2) return title;
  return <span className={s.titleRow}>{title}<ChainPicker c={c} assets={choices} current={asset} onPick={pick => { void c.live?.command('page-chain', { asset: pick }).catch(() => {}); }} /></span>;
}
