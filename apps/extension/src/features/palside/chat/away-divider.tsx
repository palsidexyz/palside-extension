'use client';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Tooltip } from '@palside/ui/tooltip';
import { assetView, type Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/social';
import { CountText } from '../ui/motion-details';
import { Token } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import s from './away-divider.module.css';

type Away = { teamId: string; first?: string; views: Viewing[] };

/** 你不在时: decided once when a team opens — the first unread message and the tokens the unread messages shared. */
export function useAway(c: PalsideController): Away {
  const self = c.data.self;
  const compute = (): Away => {
    if (!c.team.unread) return { teamId: c.current, views: [] };
    const ids = c.live?.state.remoteTeams.find(team => team.id === c.current)?.preferences.readIds ?? [];
    const read = new Set(ids);
    const unread = c.currentMessages.filter(message => !message.recalled && message.status === 'sent' && message.author !== self && !read.has(message.id) && (message.expiresAt === undefined || message.expiresAt > c.now));
    const views = [...new Map(unread.map(message => assetView(message.attachment)).filter(view => view?.kind === 'asset').map(view => [viewAsset(view) ?? view!.id, view!])).values()];
    return { teamId: c.current, first: views.length ? unread[0]?.id : undefined, views };
  };
  const [away, setAway] = useState(compute);
  if (away.teamId !== c.current) { const next = compute(); setAway(next); return next; }
  return away;
}

/** A line in the timeline above the first unread message: "你不在时聊了 3 个币" and up to three tokens that open their details. */
export function AwayDivider({ c, views }: { c: PalsideController; views: Viewing[] }) {
  const t = useTranslations();
  return <div className={s.divider} role="separator">
    <span><CountText text={t('extension.top.awayTitle', { count: views.length })} value={views.length} /></span>
    <span className={s.tokens}>{views.slice(0, 3).map(view => <Tooltip key={view.id} content={view.name}><button type="button" className={s.token} aria-label={t('extension.top.openDetails', { name: view.name })} onClick={() => c.selectAsset(view.id)}><Token view={view} size="sm" /></button></Tooltip>)}{views.length > 3 && <small>+{views.length - 3}</small>}</span>
  </div>;
}
