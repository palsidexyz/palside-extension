'use client';
import { useText } from '../ui/text';
import { useTranslations } from 'use-intl';
import { Brand } from '../ui/brand';
import { useReconnect } from './session-notice';
import { connectionNotices } from '../../../runtime/transport/connection';
import { Settings2 } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { Action } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/** No cached squads to show: one sentence of what is happening and 重新连接, nothing else. */
export function ConnectionEmpty({ c }: { c: PalsideController }) {
  const text = useText();
  const t = useTranslations();
  const { busy, reconnect } = useReconnect(c);
  return <section className={s.connectionEmpty} aria-label={t('extension.copy.serviceDisconnected')}>
    <header className={s.secondaryHeader}><Brand /><Action label={t('extension.copy.settings')} onClick={() => c.go('settings')}><Settings2 /></Action></header>
    <div className={s.connectionContent}>
      <h1 role="status">{c.connection === 'connected' ? t('extension.copy.loadingTeams') : text(connectionNotices[c.connection].title)}</h1>
      <Button loadingLabel={t('common.working')} loading={busy} onClick={reconnect}>{busy ? t('extension.copy.reconnecting') : t('extension.copy.reconnect')}</Button>
    </div>
  </section>;
}
