'use client';
import { stances } from '@palside/shared/contracts/rules';
import { useTranslations } from 'use-intl';
import { Count } from '../ui/motion-details';
import { ROOM_STANCE_MIN_VOTES } from '@palside/shared/contracts/limits';
import type { RoomStance, Stance } from '../../../runtime/rooms/contract-types';
import { Tooltip } from '@palside/ui/tooltip';
import { StanceIcon } from '../ui/icons';
import type { PalsideController } from '../app/use-palside';
import d from './danmaku.module.css';

const total = (stance: Pick<RoomStance, Stance>) => stance.bull + stance.hold + stance.bear;
/** Whole percentages that add up to 100, or nothing below the vote threshold. */
export function stanceShares(stance: Pick<RoomStance, Stance>): Record<Stance, number> | undefined {
  const sum = total(stance);
  if (sum < ROOM_STANCE_MIN_VOTES) return;
  const raw = stances.map(value => stance[value] / sum * 100), whole = raw.map(Math.floor);
  for (const index of raw.map((value, i) => [value - whole[i]!, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 100 - whole.reduce((a, b) => a + b, 0)).map(([, i]) => i)) whole[index]!++;
  return { bull: whole[0]!, hold: whole[1]!, bear: whole[2]! };
}

/**
 * 看法: one vote per account per token, shown the same in the 弹幕 view and 代币详情. One segmented track of three equal choices
 * with the shares as a hairline along its foot; your vote wears its colour. Choosing your vote again withdraws it.
 */
export function StancePoll({ c, roomKey, stance }: { c: PalsideController; roomKey: string; stance: RoomStance }) {
  const t = useTranslations();
  const shares = stanceShares(stance);
  const votes = total(stance);
  const disabled = !c.live || c.disconnected;
  const choose = (value: Stance) => { if (!disabled) void c.run('room-stance', { key: roomKey, value: stance.mine === value ? null : value }); };
  return <Tooltip content={t('extension.stance.votes', { count: votes })}>
    <div className={d.poll} data-voted={stance.mine ? '' : undefined} data-shares={shares ? '' : undefined} role="radiogroup" aria-label={t('extension.stance.title')}>
      {stances.map(value => <button key={value} type="button" role="radio" aria-checked={stance.mine === value} data-stance={value} disabled={disabled} onClick={() => choose(value)}>
        <StanceIcon value={value} size={14} /><span>{t(`extension.stance.${value}`)}</span><b>{shares ? <><Count value={shares[value]} />%</> : '—'}</b>
      </button>)}
      <span className={d.pollBar} aria-hidden="true">{stances.map(value => <span key={value} data-stance={value} style={{ flexGrow: shares ? shares[value] : 1 }} />)}</span>
    </div>
  </Tooltip>;
}

/** The small 看法 bar of a 热门 row: the three shares, or an even grey bar below the vote threshold. */
export function StanceMini({ stance }: { stance: Pick<RoomStance, Stance> }) {
  const shares = stanceShares(stance);
  return <span className={d.mini} aria-hidden="true">{shares && stances.map(value => <span key={value} data-stance={value} style={{ flexGrow: shares[value] }} />)}</span>;
}
