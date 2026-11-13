'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { motionPresets } from '@palside/design/motion';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'use-intl';
import { Flame, Layers } from 'lucide-react';
import { Count } from '../ui/motion-details';
import { EmptyState } from '../ui/empty-state';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HotRoom } from '../../../runtime/rooms/contract-types';
import { HOT_CHAIN_ORDER } from '../../../runtime/rooms/token-sites';
import { Token } from '../ui/primitives';
import { ChainLogo } from '../assets/chain-identity';
import { Faces } from './danmaku-view';
import { openRoom, roomView, tabRoomKey, useRoomRead } from './rooms';
import type { PalsideController } from '../app/use-palside';
import d from './danmaku.module.css';
import { TokenName } from '../assets/token-name';
import { tokenStats } from '../assets/token-data';
import { HotSearchField, HotSearchResults } from './hot-search';

/** The board left for a room, so 返回热门 lands on the same chain filter and scroll position. */
let leftBoard: { chain: string | null; scrollTop: number } | undefined;
const scroller = (node: HTMLElement | null) => { for (let at = node?.parentElement; at; at = at.parentElement) if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at; };

/** The chain to start from: where the viewer left the board for a room, otherwise every chain. */
export const hotStartChain = () => leftBoard?.chain ?? null;

/** The chains 热门 filters by, as one row of pills that scrolls sideways; the chosen one is solid ink and scrolls into view. */
function HotChains({ chain, onChange }: { chain: string | null; onChange: (chain: string | null) => void }) {
  const t = useTranslations();
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { row.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [chain]);
  return <div ref={row} className={d.chains} role="tablist" aria-label={t('extension.hot.chain')}>
    {HOT_CHAIN_ORDER.map(name => <button key={name ?? ''} type="button" role="tab" aria-selected={chain === name} onClick={() => onChange(name)}>
      {name === null ? <Layers size={15} aria-hidden="true" /> : <ChainLogo chain={name} size={16} />}<span>{name ?? t('extension.hot.all')}</span>
    </button>)}
  </div>;
}

/** 热门: one live ranking of danmaku viewers, filtered by chain; rows trade places as counts change. */
export function Hot({ c, chain, onChain }: { c: PalsideController; chain: string | null; onChain: (chain: string | null) => void }) {
  const t = useTranslations();
  const board = useRef<HTMLDivElement>(null);
  const read = useRoomRead(c, 'hot');
  const hot = c.live.state.rooms.hot;
  const all = hot?.loaded ? hot.rows : undefined;
  const rows = useMemo(() => all?.filter(row => chain === null || row.key.split(':')[1] === chain), [all, chain]);
  const ranks = useRankChanges(rows);
  const loaded = rows !== undefined;
  useLayoutEffect(() => {
    if (!loaded || !leftBoard) return;
    const target = scroller(board.current); if (target) target.scrollTop = leftBoard.scrollTop;
    leftBoard = undefined;
  }, [loaded]);
  const open = (key: string) => { leftBoard = { chain, scrollTop: scroller(board.current)?.scrollTop ?? 0 }; openRoom(c, key); };
  const [query, setQuery] = useState('');
  return <>
    <HotSearchField query={query} onQuery={setQuery} />
    {query.trim() ? <HotSearchResults c={c} query={query} /> : <>
    <HotChains chain={chain} onChange={onChain} />
    {read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    <div ref={board} className={d.board} aria-live="off">
      <AnimatePresence initial={false} mode="popLayout">
        {rows?.map((row, index) => <HotRow key={row.key} c={c} row={row} rank={index + 1} climbed={ranks.get(row.key)} onOpen={open} />)}
      </AnimatePresence>
      {rows?.length === 0 && <EmptyState icon={<Flame />} title={t('extension.hot.none')} />}
      {!rows && read.status !== 'error' && <EmptyState title={t('extension.copy.loading')} />}
    </div>
    </>}
  </>;
}

/** Rows that moved up since the previous ranking, so they can light up once; each new ranking gets its own mark so the glow replays. */
function useRankChanges(rows?: HotRoom[]) {
  const [ranking, setRanking] = useState<{ rows?: HotRoom[]; ranks: Map<string, number>; climbed: Map<string, number>; mark: number }>({ ranks: new Map(), climbed: new Map(), mark: 0 });
  if (rows && rows !== ranking.rows) {
    const ranks = new Map(rows.map((row, index) => [row.key, index + 1])), mark = ranking.mark + 1;
    setRanking({ rows, ranks, mark, climbed: new Map([...ranks].flatMap(([key, rank]) => { const before = ranking.ranks.get(key); return before !== undefined && rank < before ? [[key, mark] as const] : []; })) });
  }
  return ranking.climbed;
}

function HotRow({ c, row, rank, climbed, onOpen }: { c: PalsideController; row: HotRoom; rank: number; climbed?: number; onOpen: (key: string) => void }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const view = roomView(c, row.key);
  // The ranking supplies order; the numbers are the token's one record, which the open room keeps live.
  const stats = tokenStats(c, row.key) ?? row;
  const here = tabRoomKey(c) === row.key;
  const name = useId();
  return <motion.div className={d.hot} data-top={rank <= 3 || undefined}
    layout={reduced ? false : 'position'} transition={reduced ? motionPresets.reduced : motionPresets.reorder}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: motionPresets.reduced }}>
    {climbed && !reduced && <span key={climbed} className={d.climbed} aria-hidden="true" />}
    <button type="button" className={d.hotOpen} aria-labelledby={name} onClick={() => onOpen(row.key)} />
    <span className={d.rank}><Count value={rank} /></span>
    <Token view={view} size="sm" />
    <span className={d.hotName}>
      <strong><span id={name} className={d.hotToken}><TokenName c={c} view={view} /></span>{here && <span className={d.here}>{t('extension.hot.here')}</span>}</strong>
    </span>
    <Faces c={c} people={stats.faces} />
    <span className={d.hotNum} data-rising={row.rise ? '' : undefined}>
      <b><Count value={stats.count} /></b>
      <small>
        <span data-unit>{t('extension.hot.watchingShort')}</span>
        <span data-up aria-label={row.rise ? t('extension.hot.riseLabel', { count: row.rise }) : undefined}>↑<Count value={row.rise ?? 0} /></span>
      </small>
    </span>
  </motion.div>;
}
