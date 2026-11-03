'use client';
import { useTranslations } from 'use-intl';
import { Brand } from '../ui/brand';
import { ConnectionState } from './session-notice';
import { Settings2 } from 'lucide-react';
import { Action } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/** No cached squads to show: brand, the connection state in one sentence and 重新连接, nothing else. */
export function ConnectionEmpty({ c }: { c: PalsideController }) {
  const t = useTranslations();
  return <section className={s.connectionEmpty} aria-label={t('extension.copy.serviceDisconnected')}>
    <header className={s.secondaryHeader}><Brand /><Action label={t('extension.copy.settings')} onClick={() => c.go('settings')}><Settings2 /></Action></header>
    <ConnectionState c={c} scope="chat" fallback={t('extension.copy.loadingTeams')} />
  </section>;
}
