'use client';
import { useTranslations } from 'use-intl';
import { Check } from 'lucide-react';
import { accountAddress, shortAccountAddress } from '@palside/shared/chain/account-address';
import type { PalsideController } from '../app/use-palside';
import { Swap } from '../ui/motion-details';
import { useCopied } from '../ui/use-copied';
import s from './account-id.module.css';

/** What people see as an account's ID: its 零钱 address, short. Unbound accounts have none yet, and nothing stands in for it. */
export function accountHandle(person: { walletAddress?: string } | undefined) {
  return person?.walletAddress ? shortAccountAddress(person.walletAddress) : undefined;
}
/** The ID inside a row that is itself a button: text only. */
export function AccountIdText({ address }: { address?: string }) {
  return address ? <small className={s.text}>{shortAccountAddress(address)}</small> : null;
}
/** The ID on a card: tap copies the full address, and the same spot confirms. */
export function AccountId({ c, address }: { c: Pick<PalsideController, 'copy'>; address?: string }) {
  const t = useTranslations(), [copied, copy] = useCopied(c);
  if (!address) return null;
  const full = accountAddress(address);
  return <button type="button" className={s.id} data-copied={copied || undefined} title={full} aria-label={t('extension.copy.copyAccountId')} onClick={() => copy(full)}>
    <Swap k={copied ? 'ok' : 'id'}>{copied ? <span className={s.done}><Check strokeWidth={2.4} aria-hidden="true" />{t('extension.copy.copied')}</span> : shortAccountAddress(address)}</Swap>
  </button>;
}
