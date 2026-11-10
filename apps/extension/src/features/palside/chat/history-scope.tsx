'use client';
import { Spinner } from '@palside/ui/spinner';
import { useTranslations } from 'use-intl';
import { Button } from '@palside/ui/button';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/**
 * Closes a list that covers locally decrypted history: 加载更早消息 while older history is still on the server,
 * and one status line when this device cannot read part of it. Nothing once everything is readable.
 */
export function HistoryMore({ c }: { c: PalsideController }) {
  const t = useTranslations();
  if (!c.live) return null;
  const history = c.live.state.history?.[c.current];
  if (history?.loaded && !history.missingKeys) return null;
  return <>
    {!history?.loaded && <Button size="lg" variant="surface" className={s.historyMore} disabled={c.disconnected || history?.loading} aria-busy={history?.loading || undefined} onClick={() => void c.run('history', { teamId: c.current })}>
      {history?.loading ? <><Spinner size={14} className={s.loadingIcon} />{t('extension.copy.loading')}</> : t('extension.copy.loadEarlier')}
    </Button>}
    {history?.missingKeys && <p className={s.historyNote} role="status">{t('extension.copy.historyUnavailable')}</p>}
  </>;
}
