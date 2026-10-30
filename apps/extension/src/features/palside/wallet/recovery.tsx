'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@palside/ui/button';
import type { PalsideController } from '../app/use-palside';
import { PalsAmount } from './amount';
import { recordLabels, recoveryLabel } from './recovery-state';
import { openPayment, usePaymentRequest } from './payment-sheet';
import s from './wallet.module.css';

/** Separate paged ledger view: checking one operation never occupies the payment slot. */
export function WalletRecoveryList({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live?.state.wallet, command = c.live?.command;
  const recovery = wallet?.recovery;
  const accountId = c.live?.state.account?.id;
  const requests = usePaymentRequest(c, c.screen);
  const [busy, setBusy] = useState<string>(), [errors, setErrors] = useState<Record<string, boolean>>({});
  const [owner, setOwner] = useState({ accountId, screen: c.screen });
  if (owner.accountId !== accountId || owner.screen !== c.screen) {
    setOwner({ accountId, screen: c.screen }); setBusy(undefined); setErrors({});
  }
  useEffect(() => { void command?.('wallet-recovery', {}).catch(() => {}); }, [command, accountId]);
  async function act(orderId: string, resume: boolean) {
    if (!command || busy) return;
    const request = requests.capture();
    if (!request.isCurrent()) return;
    setBusy(orderId); setErrors(value => ({ ...value, [orderId]: false }));
    try {
      if (resume) {
        const payment = await command('wallet-recovery-resume', { orderId });
        if (!request.isCurrent()) { request.discard(payment.id); return; }
        openPayment(payment.id);
      }
      else await command('wallet-recovery-check', { orderId });
    } catch { if (request.isCurrent()) setErrors(value => ({ ...value, [orderId]: true })); }
    finally { if (request.isMounted()) setBusy(undefined); }
  }
  const occupied = wallet?.payment && !['confirmed', 'failed', 'expired'].includes(wallet.payment.phase);
  if (!recovery?.error && !recovery?.items.length) return null;
  return <section className={s.recovery}>
    <header><h2>{t('extension.wallet.recoveryTitle')}</h2><Button size="sm" variant="quiet" loading={recovery.loading} onClick={() => void c.run('wallet-recovery', {})}>{t('extension.wallet.checkStatus')}</Button></header>
    {recovery.error && <p className={s.error} role="alert">{t('extension.wallet.recoveryUnavailable')}</p>}
    {recovery.items.map(item => <article className={s.recoveryItem} key={item.order.id}>
      <div className={s.recoveryHead}><strong>{t(recordLabels[item.order.kind])}</strong><span>{t(`extension.wallet.${recoveryLabel(item)}`)}</span></div>
      <strong className={s.recoveryAmount}><PalsAmount value={item.order.amount} hidden={wallet?.preferences.hideAmounts} /></strong>
      <p className={s.mono}>{item.order.recipient}</p>
      <time>{new Date(item.order.createdAt).toLocaleString()}</time>
      <p className={s.mono}>{item.order.id}</p>
      {item.relay?.fundsReserved && ['cancelled', 'expired'].includes(item.relay.state) && <p className={s.note}>{t('extension.wallet.recoveryReserved')}</p>}
      {errors[item.order.id] && <p className={s.error} role="alert">{t('extension.wallet.recoveryUnavailable')}</p>}
      <div className={s.recoveryActions}>
        {(item.relay?.transactionHash ?? item.order.transactionHash) && <Button size="sm" onClick={() => void c.copy(item.relay?.transactionHash ?? item.order.transactionHash!)}>{t('extension.wallet.transaction')}</Button>}
        <Button size="sm" disabled={!!busy} loading={busy === item.order.id} onClick={() => void act(item.order.id, false)}>{t('extension.wallet.checkStatus')}</Button>
        {item.canResume && <Button size="sm" variant="primary" disabled={!!busy || !!occupied || wallet?.availability !== 'ready'} onClick={() => void act(item.order.id, true)}>{t('extension.wallet.recoveryReview')}</Button>}
      </div>
    </article>)}
    {recovery.nextCursor && <Button disabled={recovery.loading} onClick={() => void c.run('wallet-recovery', { more: true })}>{t('extension.wallet.more')}</Button>}
  </section>;
}
