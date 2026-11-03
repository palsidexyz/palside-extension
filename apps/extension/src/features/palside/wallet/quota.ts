import type { useTranslations } from 'use-intl';
import { nextUtcDay } from '../../../domain/wallet/model';

export function quotaResetText(t: ReturnType<typeof useTranslations>, locale: string, at = nextUtcDay(), now = Date.now()) {
  const reset = new Date(at), today = new Date(now);
  const day = reset.toDateString() === today.toDateString() ? 'today' : 'tomorrow';
  return t(`extension.wallet.${day}`, { time: reset.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) });
}
