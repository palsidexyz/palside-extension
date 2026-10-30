'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { useTranslations } from 'use-intl';
import { Count, CountText } from '../ui/motion-details';
import { useId, useState } from 'react';
import { Tooltip } from '@palside/ui/tooltip';
import type { HotRoom } from '../../../runtime/rooms/contract-types';
import { Token } from '../ui/primitives';
import { Faces } from './danmaku-view';
import { StanceMini, stanceShares } from './stance-poll';
import { openRoom, roomView, tabRoomKey, useRoomRead } from './rooms';
import type { PalsideController } from '../app/use-palside';
import d from './danmaku.module.css';

const chains = ['Solana', 'Base', 'BNB Chain', 'Ethereum', 'Robinhood'] as const;

/** 热门: 15 分钟上升 and 在看最多 in one row shape, filtered by chain, refreshed while open. */
export function Hot({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [chain, setChain] = useState<string | null>(null);
  const read = useRoomRead(c, 'hot', chain);
  const shown = c.live?.state.rooms.hot?.[chain ?? ''];
  return <>
    <div className={d.chains} role="group" aria-label={t('extension.hot.chain')}>
      <button type="button" aria-pressed={chain === null} onClick={() => setChain(null)}>{t('extension.hot.all')}</button>
      {chains.map(name => <button key={name} type="button" aria-pressed={chain === name} onClick={() => setChain(name)}>{name}</button>)}
    </div>
    {read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    <section className={d.group} aria-label={t('extension.hot.rising')}>
      <Tooltip content={t('extension.hot.risingHint')}><div className={d.groupHead} tabIndex={0}>{t('extension.hot.rising')}</div></Tooltip>
      {shown ? shown.rising.length ? shown.rising.map((row, index) => <HotRow key={row.key} c={c} row={row} rank={index + 1} rise={row.rise} />) : <p className={d.hotEmpty}>{t('extension.hot.noneRising')}</p> : read.status !== 'error' ? <p className={d.hotEmpty}>{t('extension.copy.loading')}</p> : null}
    </section>
    <section className={d.group} aria-label={t('extension.hot.top')}>
      <div className={d.groupHead}>{t('extension.hot.top')}</div>
      {shown ? shown.top.length ? shown.top.map((row, index) => <HotRow key={row.key} c={c} row={row} rank={index + 1} />) : <p className={d.hotEmpty}>{t('extension.hot.noneTop')}</p> : null}
    </section>
  </>;
}

function HotRow({ c, row, rank, rise }: { c: PalsideController; row: HotRoom; rank: number; rise?: number }) {
  const t = useTranslations();
  const view = roomView(c, row.key, row.profile);
  const shares = stanceShares(row.stance);
  const here = tabRoomKey(c) === row.key;
  const name = useId();
  // The row opens the 弹幕 view through one stretched button; the token name is a separate button above it.
  return <div className={d.hot} data-top={rank <= 3 || undefined}>
    <button type="button" className={d.hotOpen} aria-labelledby={name} onClick={() => openRoom(c, row.key)} />
    <span className={d.rank}>{rank}</span>
    <Token view={view} size="sm" />
    <span className={d.hotName}>
      <strong><button type="button" id={name} className={d.hotToken} onClick={() => c.selectAsset(view.id, view)}>{view.name}</button>{here && <span className={d.here}>{t('extension.hot.here')}</span>}</strong>
      <small><StanceMini stance={row.stance} /><span>{shares ? <CountText text={t('extension.hot.bull', { percent: shares.bull })} value={shares.bull} /> : '—'}</span></small>
    </span>
    <Faces c={c} people={row.faces} />
    <span className={d.hotNum}>{rise !== undefined
      ? <><b data-up><CountText text={t('extension.hot.rise', { count: rise })} value={rise} /></b><small><CountText text={t('extension.room.watching', { count: row.count })} value={row.count} /></small></>
      : <><b><Count value={row.count} /></b><small>{t('extension.hot.watchingShort')}</small></>}</span>
  </div>;
}
