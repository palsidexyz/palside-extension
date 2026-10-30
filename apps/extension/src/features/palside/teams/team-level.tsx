'use client';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Eye, Lock, MessageSquare, Users, Zap } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { Count, Swap } from '../ui/motion-details';
import { Chip, type ChipTone } from '../ui/chip';
import { SettingGroup } from '../settings/setting-rows';
import { TEAM_LEVEL_THRESHOLDS } from '@palside/shared/team-activity-rules';
import type { PalsideController } from '../app/use-palside';
import s from './team-level.module.css';

const tones: Record<number, ChipTone> = { 1: 'neutral', 2: 'accent', 3: 'blue', 4: 'purple' };

/** 小队等级 as a chip; the same chip wherever a team is listed. */
export function LevelChip({ level, size }: { level: number; size?: 'md' }) {
  return <Chip tone={tones[level]} size={size} icon={<Zap />}><Swap k={String(level)}><span>Lv{level}</span></Swap></Chip>;
}

/** The ring fills toward the next level; it turns the warning colour while a downgrade is pending. */
function Ring({ level, points, warn }: { level: number; points: number; warn: boolean }) {
  const reduced = useReducedMotion();
  const from = TEAM_LEVEL_THRESHOLDS[level - 1] ?? 0, to = TEAM_LEVEL_THRESHOLDS[level];
  const share = to === undefined ? 1 : Math.min(1, Math.max(0, (points - from) / (to - from)));
  return <span className={s.ring} data-warn={warn || undefined}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" className={s.track} />
      <motion.circle cx="50" cy="50" r="44" className={s.fill} initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: Math.max(share, .001) }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }} /></svg>
    <span className={s.ringIn}><Zap /><b><Swap k={String(level)}><span>Lv{level}</span></Swap></b></span>
  </span>;
}

/** 小队等级: ring and score in the centre, three stat tiles, then the four levels. Nothing to buy; it follows how active the team is. */
export function TeamLevel({ c }: { c: PalsideController }) {
  const t = useTranslations(), locale = useLocale();
  const summary = c.team.activitySummary;
  if (!summary) return <p className={s.empty}>{t('extension.copy.loading')}</p>;
  const down = summary.downgrade;
  const stats: [ReactNode, string, number, string][] = [
    [<Users key="u" />, t('extension.wallet.activeMembers'), summary.averageDailyActive, t('extension.wallet.perDay')],
    [<MessageSquare key="m" />, t('extension.wallet.dailyMessages'), summary.averageDailyMessages, t('extension.wallet.messagesUnit')],
    [<Eye key="e" />, t('extension.wallet.sharedViewing'), summary.sharedViewingHours, t('extension.wallet.hoursUnit')],
  ];
  return <div className={s.page}>
    <div className={s.hero}>
      <Ring level={summary.level} points={summary.points} warn={!!down} />
      <strong>{t('extension.wallet.activity')} <Count value={summary.points} /></strong>
      <small data-warn={down ? true : undefined}>{down
        ? t('extension.wallet.levelDown', { date: new Date(down.at).toLocaleDateString(locale, { month: 'short', day: 'numeric' }), level: down.level })
        : summary.nextLevel ? <span>{t('extension.wallet.levelNext', { count: summary.pointsToNextLevel, level: summary.nextLevel })}</span> : t('extension.wallet.levelTop')}</small>
    </div>
    <div className={s.stats}>{stats.map(([icon, label, value, unit]) => <div key={label}>{icon}<b><Count value={Math.round(value * 10) / 10} /><small>{unit}</small></b><span>{label}</span></div>)}</div>
    <dl className={s.facts}><div><dt>{t('extension.wallet.heat')}</dt><dd>{summary.rank === null ? '—' : <>#<Count value={summary.rank} /></>}</dd></div></dl>
    <SettingGroup title={t('extension.wallet.honor')} aside={<Tooltip content={t('extension.wallet.levelHowTip')}><span className={s.how} tabIndex={0}>{t('extension.wallet.levelHow')}</span></Tooltip>}>
      {TEAM_LEVEL_THRESHOLDS.map((points, index) => {
        const level = index + 1, reached = summary.points >= points || summary.level >= level;
        return <div key={points} className={s.level} data-dim={!reached || undefined}>
          <LevelChip level={level} />
          <span>{t('extension.wallet.activity')} <Count value={points} /></span>
          <small>{summary.level === level ? <span className={s.reached}><Check />{t('extension.wallet.levelCurrent')}</span> : reached ? <span className={s.reached}><Check />{t('extension.wallet.levelReached')}</span> : <span className={s.locked}><Lock /><Count value={points - summary.points} /></span>}</small>
        </div>;
      })}
    </SettingGroup>
  </div>;
}
