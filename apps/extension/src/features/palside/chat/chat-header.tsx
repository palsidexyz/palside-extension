'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { Tooltip } from '@palside/ui/tooltip';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { CheckCheck, ChevronDown, Compass, Eye, Flame, Info, MoreHorizontal, Plus, Search, Settings2, Star, Users } from 'lucide-react';
import { TeamAvatar } from '../teams/team-avatar';
import { formerTeams } from '../teams/team-start';
import type { Team } from '../../../domain/teams/model';
import { Count, UnreadBadge } from '../ui/motion-details';
import { Action, PersonAvatar } from '../ui/primitives';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import { roomCount, roomsOn, useShownRoomKey } from '../rooms/rooms';
import { PanelSwitch, RoomTitle } from '../app/panel-tabs';
import { PageCapsule } from '../viewing/page-key';
import { setSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import d from '../rooms/danmaku.module.css';
import styles from './chat-header.module.css';

/** How much of 谁在这里 fits after the name without cutting it: 0 everything, then step by step less — 1 without +N, 2 without the
 *  green dot, 3 one face, 4 a badge on the avatar (the seat drops 邀请 at 1; the member count and 👁 N go straight to the badge).
 *  The name always wins: on every width or content change the row starts from 0 and steps down, before paint, until the name fits. */
export type PresenceFit = 0 | 1 | 2 | 3 | 4;
function usePresenceFit(content: string) {
  const header = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<PresenceFit>(0);
  // A width change bumps this so the row re-measures even when fit is already 0.
  const [, setPass] = useState(0);
  // New content restarts the ladder from 0 during render, so the measuring effect below sees the full row first.
  const [measured, setMeasured] = useState(content);
  if (measured !== content) { setMeasured(content); setFit(0); }
  useLayoutEffect(() => {
    const name = header.current?.querySelector<HTMLElement>('[data-header-name]');
    if (!name) return;
    const cut = name.scrollWidth > name.clientWidth + 1;
    if (cut && fit < 4) { setFit(fit + 1 as PresenceFit); return; }
    // A name that still does not fit fades out at its end instead of an ellipsis, so the mark after it stays attached.
    name.toggleAttribute('data-cut', cut);
  });
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      flushSync(() => { setFit(0); setPass(old => old + 1); });
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);
  return { header, fit };
}

/** One 52px row on one line: the squad (32px avatar, the name, then who is here — online faces, the member count, or a dashed 邀请 seat,
 *  giving way step by step and finally folding into a badge on the avatar so the name keeps its width), then 36px controls — search or
 *  聊天 | 弹幕, the page key and the menu.
 *  On 弹幕 the title is the token with 👁 N after it (who watches it); 热门代币 sits in the menu.
 *  Other teams and pending invites mark the switcher itself: @N for mentions, otherwise a dot in place of the chevron.
 *  With 弹幕 on (`tabs`) the row is shared by both pages and stays put: the title is the squad or the token; search moves into the menu. */
export function ChatHeader({ c, onTeam, tabs }: { c: PalsideController; onTeam: (id: string) => void; tabs?: boolean }) {
  const t = useTranslations();
  const roomKey = useShownRoomKey(c);
  const room = tabs && c.screen === 'room';
  const count = c.team.memberCount ?? c.team.memberIds.length;
  const online = c.people.filter(p => p.id !== c.data.self && p.presence && c.team.memberIds.includes(p.id)).sort((a, b) => Number(b.presence === 'active') - Number(a.presence === 'active'));
  const switchable = c.teams.filter(team => team.joined || team.readonly);
  /** Muted teams never raise the switcher's mark. */
  const loud = switchable.filter(team => team.id !== c.current && !team.muted);
  const mentions = loud.reduce((sum, team) => sum + (team.mentions ?? 0), 0);
  const unread = loud.some(team => team.unread > 0);
  const alone = count <= 1 && c.team.joined && !c.team.readonly;
  const missingKeys = (c.live?.state.history?.[c.current]?.missingKeys ?? 0) > 0;
  const invites = c.live?.state.rooms.invites.length ?? 0;
  const switchLabel = [mentions > 0 ? t('extension.dynamic.teamMentions', { name: t('extension.copy.switchTeam'), count: mentions }) : t('extension.copy.switchTeam'), invites > 0 && t('extension.invite.pending', { count: invites })].filter(Boolean).join(', ');
  function markAllRead() {
    if (c.live) {
      void c.run('team-preferences', { teamId: c.current, readIds: c.currentMessages.filter(m => m.status === 'sent').map(m => m.id) });
      return;
    }
    c.setTeams(old => old.map(team => team.id === c.current ? { ...team, unread: 0, mentions: 0 } : team));
    c.setNotice(uiMessage('extension.copy.markedRead'));
  }
  const search = () => { c.setSharedCategory('messages'); c.setQuery(''); c.go('search'); };
  const watching = roomKey ? roomCount(c, roomKey) : undefined;
  const presenceLabel = alone ? `${t('extension.header.onlyYou')} · ${t('extension.copy.inviteShort')}` : t('extension.dynamic.onlineMembers', { online: online.length, count });
  const extra = online.length - Math.min(online.length, 2);
  const { header, fit } = usePresenceFit([room ? `room:${roomKey ?? ''}:${watching ?? ''}` : c.team.name, alone, online.length, extra, mentions, unread || invites > 0, c.team.readonly].join('|'));
  return <header ref={header} className={`${s.header} ${styles.bar}`}>
    {room ? <div key="room" className={`${s.teamIdentity} ${styles.identity} ${styles.swap}`} data-fit={fit}><RoomTitle c={c} />
      {watching !== undefined && <Tooltip content={t('extension.room.watching', { count: watching })}><button type="button" className={styles.presence} data-kind="watch" aria-label={t('extension.room.watching', { count: watching })} onClick={() => { setSocialUi({ people: undefined }); c.go('room-people'); }}>
        <Eye className={styles.glyph} size={14} strokeWidth={2.2} aria-hidden="true" /><span className={styles.number}><Count value={watching} /></span>
      </button></Tooltip>}
    </div> : <>
    <VisuallyHidden asChild><h1>{c.team.name}</h1></VisuallyHidden>
    <div key="chat" className={`${s.teamIdentity} ${styles.identity} ${tabs ? styles.swap : ''}`} data-fit={fit}>
      <Popover boundarySelector="[data-palside-app]" align="start">
        <PopoverTrigger asChild><button type="button" className={`${s.teamSelect} ${styles.squad}`} aria-label={switchLabel}>
          <TeamAvatar team={c.team} size="md" />
          <span className={styles.name} data-header-name>{c.team.name}</span>
          {mentions > 0 && <span className={s.nameMention}>@<Count value={mentions} /></span>}
          {mentions === 0 && (unread || invites > 0) ? <span className={s.nameDot} /> : <ChevronDown size={14} />}
        </button></PopoverTrigger>
        <PopoverContent aria-label={switchLabel} className={styles.teamPopup}><TeamOptions c={c} onTeam={onTeam} /></PopoverContent>
      </Popover>
      {/* Who is here, after the name: online faces (two, then +N), the member count, or — alone — a dashed seat and 邀请.
          When the name would be cut it gives way (data-fit) and finally folds into a badge on the avatar (online count, member count or +). */}
      {!c.team.readonly && <Tooltip content={presenceLabel}><button type="button" className={styles.presence} data-kind={alone ? 'invite' : online.length > 0 ? 'online' : 'members'} data-tour={alone ? 'invite' : undefined} aria-label={presenceLabel}
        onClick={() => { if (alone) c.go('team'); else { c.setMemberFilter(undefined); c.go('members'); } }}>
        {alone ? <><span className={styles.seat} aria-hidden="true"><Plus size={11} strokeWidth={2.6} /></span><span className={styles.seatLabel}>{t('extension.copy.inviteShort')}</span></>
          : online.length > 0 ? <><span className={styles.live} aria-hidden="true" /><span className={styles.faces} aria-hidden="true">{online.slice(0, 2).map(p => <PersonAvatar key={p.id} person={p} size="xs" />)}
            {extra > 0 && <span className={styles.more}>+<Count value={extra} /></span>}</span><span className={styles.number}><Count value={online.length} /></span></>
          : <><Users className={styles.glyph} size={14} strokeWidth={2.2} aria-hidden="true" /><span className={styles.number}><Count value={count} /></span></>}
      </button></Tooltip>}
    </div></>}
    <div className={s.tools}>
      {tabs ? <PanelSwitch c={c} /> : <Action label={t('extension.copy.searchMessages')} className={styles.tool} onClick={search}><Search /></Action>}
      {/* The page capsule: this tab's site (its sheet holds 网页互动 here and Chrome's permission), then the 共享在看 key. */}
      <PageCapsule c={c} />
      <Menu boundarySelector="[data-palside-app]" align="end">
        <MenuTrigger asChild><IconButton label={t('extension.copy.teamMenu')} size="sm" variant="quiet" className={`${styles.tool} ${styles.menuButton}`}><MoreHorizontal size={19} /></IconButton></MenuTrigger>
        <MenuContent aria-label={t('extension.copy.teamMenu')} className={styles.menu}>
          {tabs && <MenuItem icon={<Search size={16} />} onClick={search}>{t('extension.copy.searchMessages')}</MenuItem>}
          <MenuItem icon={<Star size={16} />} onClick={() => { c.go('favorites'); }}>{t('extension.web.myFavorites')}</MenuItem>
          {roomsOn(c) && <MenuItem icon={<Flame size={16} />} onClick={() => { c.go('hot'); }}>{t('extension.hot.tokens')}</MenuItem>}
          {(c.scenario === 'history' || missingKeys) && <MenuItem icon={<Info size={16} />} onClick={() => { c.setNotice(uiMessage('extension.copy.historyUnavailable')); }}>{t('extension.copy.aboutHistory')}</MenuItem>}
          <hr className={styles.separator} />
          {(c.team.unread > 0 || (c.team.mentions ?? 0) > 0) && <><MenuItem icon={<CheckCheck size={16} />} onClick={markAllRead}>{t('extension.copy.markAllRead')}{c.team.unread > 0 && <span className={s.menuCount}><Count value={c.team.unread} /></span>}</MenuItem>
          <hr className={styles.separator} /></>}
          <MenuItem icon={<Users size={16} />} onClick={() => { c.go('team'); }}>{t('extension.copy.teamSettings')}</MenuItem>
          <MenuItem icon={<Settings2 size={16} />} onClick={() => { c.go('settings'); }}>{t('extension.copy.settings')}</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  </header>;
}

export function TeamOptions({ c, onTeam }: { c: PalsideController; onTeam: (id: string) => void }) {
  const t = useTranslations();
  const { close } = usePopoverContext();
  const joined = c.teams.filter(team => team.joined);
  const former = formerTeams(c);
  const invites = c.live?.state.rooms.invites.length ?? 0;
  const reason = (team: Team) => t(team.readonlyReason === 'removed' ? 'extension.start.removed' : team.readonlyReason === 'dissolved' ? 'extension.start.dissolved' : 'extension.start.left');
  return <>
    {joined.map(team => <button type="button" key={team.id} className={styles.teamOption} aria-current={team.id === c.current ? true : undefined}
      aria-label={team.mentions ? t('extension.dynamic.teamMentions', { name: team.name, count: team.mentions }) : t('extension.dynamic.teamUnread', { name: team.name, count: team.unread })} onClick={() => { close(); onTeam(team.id); }}>
      <TeamAvatar team={team} size="sm" /><span className={styles.teamOptionLabel}>{team.name}</span>{team.mentions ? <span className={styles.mentionBadge}>@<Count value={team.mentions} /></span> : <UnreadBadge count={team.unread} />}
    </button>)}
    {/* Teams that ended keep their read-only history here, below the live ones, each saying how it ended. */}
    {former.length > 0 && <div role="group" aria-labelledby="former-teams-label">
      <div id="former-teams-label" className={styles.groupLabel}>{t('extension.copy.leftTeam')}</div>
      {former.map(team => <button type="button" key={team.id} className={styles.teamOption} data-former aria-current={team.id === c.current ? true : undefined} onClick={() => { close(); c.openFormerTeam(team.id); }}>
        <TeamAvatar team={team} size="sm" /><span className={styles.teamOptionLabel}>{team.name}<small>{reason(team)}</small></span>
      </button>)}
    </div>}
    <hr className={styles.rule} />
    {/* Two equal actions under the list: adding a squad and browsing squads. Received invites are listed in 发现小队, so their count rides on that button. */}
    <div className={styles.teamActions}>
      <Button size="sm" leadingIcon={<Plus size={16} />} onClick={() => { close(); c.go('add-team'); }}>{t('extension.copy.lobby')}</Button>
      <Button size="sm" leadingIcon={<Compass size={16} />} onClick={() => { close(); c.go('lobby'); }}>{t('extension.copy.visitLobby')}{invites > 0 && <span className={d.count} aria-label={t('extension.invite.pending', { count: invites })}><Count value={invites} /></span>}</Button>
    </div>
  </>;
}
