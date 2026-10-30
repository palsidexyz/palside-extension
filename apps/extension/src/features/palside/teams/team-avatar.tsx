'use client';

import { useTranslations } from 'use-intl';
import { Avatar } from '@palside/ui/avatar';
import { UsersRound } from 'lucide-react';
import { useState } from 'react';
import { defaultTeamAvatar } from './default-team-avatar';
import type { Team } from '../../../domain/teams/model';
import s from './lobby.module.css';

/** xs 22 (inline with text), sm 28 (lists and headers), md 38 (cards), lg 56 (team pages), xl 88 (a new team). */
type TeamAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export function TeamAvatar({ team, size = 'md' }: { team: Pick<Team, 'id' | 'name' | 'avatar'>; size?: TeamAvatarSize }) {
  const t = useTranslations();
  const [failed, setFailed] = useState<string[]>([]);
  const src = [team.avatar, defaultTeamAvatar(team.id)].find(path => path && !failed.includes(path));
  return <span className={s.teamFrame} data-team-avatar data-size={size} data-default={!team.avatar || src !== team.avatar} onErrorCapture={event => {
    if (src && event.target instanceof HTMLImageElement) setFailed(old => old.includes(src) ? old : [...old, src]);
  }}>
    {src ? <Avatar fallbackLabel={t('common.team')} name={team.name} src={src} className={s.teamFace} /> : <span role="img" aria-label={team.name} className={`${s.teamFallback} ${s.teamFace}`}><UsersRound size={size === 'lg' || size === 'xl' ? 25 : 20} strokeWidth={1.6} /></span>}
  </span>;
}
