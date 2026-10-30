'use client';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { CheckCheck, ChevronDown, Flame, Images, Info, MoreHorizontal, Plus, Search, Settings2, Star, UserPlus, Users } from 'lucide-react';
import { TeamAvatar } from '../teams/team-avatar';
import { formerTeams } from '../teams/team-start';
import type { Team } from '../../../domain/teams/model';
import { Count, UnreadBadge } from '../ui/motion-details';
import { Action, PersonAvatar } from '../ui/primitives';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '@palside/ui/menu';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import { roomsOn } from '../rooms/rooms';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import d from '../rooms/danmaku.module.css';
import styles from './chat-header.module.css';

/** One row: current team (switcher), online teammates, search and the team menu.
 *  Other teams and pending invites mark the switcher itself: @N for mentions, otherwise a dot in place of the chevron. */
export function ChatHeader({ c, onTeam }: { c: PalsideController; onTeam: (id: string) => void }) {
  const t = useTranslations();
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
  return <header className={s.header}>
    <VisuallyHidden asChild><h1>{c.team.name}</h1></VisuallyHidden>
    <TeamAvatar team={c.team} size="sm" />
    <div className={s.teamIdentity}>
      <Popover boundarySelector="[data-palside-app]" align="start">
        <PopoverTrigger asChild><button type="button" className={s.teamSelect} aria-label={switchLabel} title={switchLabel}>
          <span>{c.team.name}</span>
          {mentions > 0 && <span className={s.nameMention}>@<Count value={mentions} /></span>}
          {mentions === 0 && (unread || invites > 0) ? <span className={s.nameDot} /> : <ChevronDown size={14} />}
        </button></PopoverTrigger>
        <PopoverContent aria-label={switchLabel} className={styles.teamPopup}><TeamOptions c={c} onTeam={onTeam} /></PopoverContent>
      </Popover>
    </div>
    {alone ? <button className={s.invitePill} onClick={() => c.go('team')}><UserPlus size={15} aria-hidden="true" />{t('extension.copy.inviteShort')}</button>
    : <button className={s.memberCount} aria-label={c.team.readonly ? t('common.member') : t('extension.dynamic.onlineMembers', { online: online.length, count })} title={c.team.readonly ? undefined : t('extension.dynamic.onlineMembers', { online: online.length, count })} onClick={() => { c.setMemberFilter(undefined); c.go('members'); }}>
      {online.length && !c.team.readonly ? <span className={s.onlineStack} aria-hidden="true">
        {online.slice(0, online.length > 3 ? 2 : 3).map(p => <PersonAvatar key={p.id} person={p} size="xs" />)}
        {online.length > 3 && <span className={s.memberOverflow}>+<Count value={online.length - 2} /></span>}
      </span> : <Users size={18} aria-hidden="true" />}
    </button>}
    <div className={s.tools}>
      <Action label={t('extension.copy.searchMessages')} onClick={() => { c.setAssetFilter(undefined); c.setQuery(''); c.go('search'); }}><Search /></Action>
      <Menu boundarySelector="[data-palside-app]" align="end">
        <MenuTrigger asChild><IconButton label={t('extension.copy.teamMenu')} size="sm" variant="quiet"><MoreHorizontal size={19} /></IconButton></MenuTrigger>
        <MenuContent aria-label={t('extension.copy.teamMenu')} className={styles.menu}>
          <MenuItem icon={<Images size={16} />} onClick={() => { c.go('shared'); }}>{t('extension.copy.sharedItems')}</MenuItem>
          <MenuItem icon={<Star size={16} />} onClick={() => { c.go('favorites'); }}>{t('extension.web.favorites')}</MenuItem>
          {roomsOn(c) && <MenuItem icon={<Flame size={16} />} onClick={() => { c.go('hot'); }}>{t('extension.hot.title')}</MenuItem>}
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
    <hr className={styles.separator} />
    <Button size="sm" variant="quiet" className={styles.lobby} leadingIcon={<Plus size={16} />} onClick={() => { close(); c.go('add-team'); }}>{t('extension.copy.lobby')}{invites > 0 && <span className={d.count} aria-label={t('extension.invite.pending', { count: invites })}><Count value={invites} /></span>}</Button>
  </>;
}
