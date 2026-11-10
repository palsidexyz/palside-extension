'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Search } from 'lucide-react';
import { Input } from '@palside/ui/field';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { motionPresets } from '@palside/design/motion';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import { Token } from '../ui/primitives';
import { ChainLogo } from '../assets/chain-identity';
import { TokenName } from '../assets/token-name';
import { tokenStats, tokenView } from '../assets/token-data';
import { EmptyState } from '../ui/empty-state';
import { openRoom } from './rooms';
import type { RoomKey } from '../../../runtime/rooms/contract-types';
import type { PalsideController } from '../app/use-palside';
import h from './hot-search.module.css';

const PAUSE_MS = 300;

/** 热门's search field: a name or symbol prefix among tokens the directory knows, or a contract address. Empty, the ranking shows. */
export function HotSearchField({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const t = useTranslations();
  return <Input type="search" enterKeyHint="search" className={h.field} aria-label={t('extension.hot.search')} leadingIcon={<Search size={16} />}
    placeholder={t('extension.hot.search')} value={query} maxLength={64} onChange={event => onQuery(event.target.value)} />;
}

type Found = { q: string; assets?: string[]; failed?: boolean };

/** The matches for `query` after a short pause; each opens its 弹幕. Results replace the ranking until the field is cleared. */
export function HotSearchResults({ c, query }: { c: PalsideController; query: string }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const q = query.trim();
  const [found, setFound] = useState<Found>();
  const [round, setRound] = useState(0);
  const command = c.live?.command;
  useEffect(() => {
    if (!q || !command) return;
    let current = true;
    const timer = setTimeout(() => {
      void command('token-search', { q }).then(result => { if (current) setFound({ q, assets: result.assets }); }, () => { if (current) setFound({ q, failed: true }); });
    }, PAUSE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [q, command, round]);
  // Leaving the search drops its rows from panel state.
  useEffect(() => () => { void command?.('token-search', { q: '' }).catch(() => {}); }, [command]);
  const answer = found?.q === q ? found : undefined;
  if (answer?.failed) return <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => setRound(value => value + 1) }}>{t('common.error')}</InlineFeedback>;
  if (!answer?.assets) return <EmptyState title={t('extension.copy.loading')} />;
  if (!answer.assets.length) return <EmptyState icon={<Search />} title={t('extension.web.noMatch')} />;
  return <div className={h.results}>
    <AnimatePresence initial={false} mode="popLayout">
      {answer.assets.map(asset => {
        const key = roomKeyForAsset(asset) as RoomKey | null;
        if (!key) return null;
        const view = tokenView(c, asset), chain = asset.slice(0, asset.indexOf(':')), count = tokenStats(c, key)?.count;
        return <motion.button key={asset} type="button" className={h.row} onClick={() => openRoom(c, key)}
          layout={reduced ? false : 'position'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}>
          <Token view={view} size="sm" />
          <span className={h.name}><strong><TokenName c={c} view={view} /></strong><small><ChainLogo chain={chain} size={14} />{chain}</small></span>
          {count ? <span className={h.count}>{t('extension.room.watching', { count })}</span> : null}
        </motion.button>;
      })}
    </AnimatePresence>
  </div>;
}
