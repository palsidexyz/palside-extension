'use client';
import { PIN_LENGTH } from '@palside/shared/rules/accounts';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ArrowUpRight, Gift, ScrollText, Zap } from 'lucide-react';
import { explorerLink } from '@palside/shared/chain/explorer';
import { Action } from '../ui/primitives';
import { AddressCopy } from '@palside/ui/address-copy';
import { shortAddress } from '@palside/shared/navigation';
import { ChainLogo } from '../assets/chain-identity';
import { failureText, message as uiMessage } from '@palside/i18n';
import { Button } from '@palside/ui/button';
import { PinInput } from '@palside/ui/field';
import { Switch } from '@palside/ui/switch';
import { SettingGroup, SettingControl, SettingItem, settingRows } from '../settings/setting-rows';
import type { PalsideController } from '../app/use-palside';
import { quickPayLimits } from '../../../domain/wallet/model';
import { groupPals } from './amount';
import s from './wallet.module.css';

export function WalletSettings({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live.state.wallet;
  const [enabling, setEnabling] = useState(false), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const limits = wallet?.config && quickPayLimits(wallet.config.quickPay), deployment = wallet?.config?.deployment, token = deployment?.token, packetContract = deployment?.packetContract;
  const chainIcon = deployment?.chainId === 4663 ? <ChainLogo chain="Robinhood" /> : undefined;
  const contract = (address: string, label: string, ariaLabel: string) => {
    const url = deployment && explorerLink(deployment.chainId, 'address', address);
    return <span className={s.contract}><AddressCopy address={address} display={shortAddress(address)} label={label} ariaLabel={ariaLabel} icon={chainIcon} onCopy={copied} />
      {url && <Action label={t('extension.wallet.viewOnExplorer')} onClick={() => void c.live.openPage(url).catch(error => c.setNotice(failureText(error)))}><ArrowUpRight /></Action>}</span>;
  };
  const copied = (ok: boolean) => { if (!ok) c.setNotice(uiMessage('extension.copy.copyFailed')); };
  async function confirm() {
    if (busy || password.length !== PIN_LENGTH) return; setBusy(true);
    try { if (await c.run('wallet-preferences', { smallPayments: true, password }) !== undefined) setEnabling(false); }
    finally { setPassword(''); setBusy(false); }
  }
  return <div className={s.page}><SettingGroup><SettingControl icon={<Zap size={16} />}><Switch className={settingRows.switch} label={t('extension.wallet.smallPayments')} checked={wallet?.preferences.smallPayments ?? false} help={{ label: t('extension.wallet.smallPayments'), content: limits ? t('extension.wallet.smallLimit', { single: groupPals(limits.single.toString()), daily: groupPals(limits.daily.toString()) }) : t('extension.copy.loading') }} onChange={e => { if (e.currentTarget.checked) { setEnabling(true); setPassword(''); } else void c.run('wallet-preferences', { smallPayments: false }); }} /></SettingControl>{token && <SettingItem icon={<ScrollText size={16} />} title={t('extension.wallet.palsContract')} end={contract(token, t('extension.copy.copyContract'), t('extension.dynamic.copyChainContract', { chain: 'Robinhood Chain', address: token }))} />}{packetContract && <SettingItem icon={<Gift size={16} />} title={t('extension.wallet.packetContract')} end={contract(packetContract, t('extension.copy.copyPacketContract'), t('extension.dynamic.copyChainPacketContract', { chain: 'Robinhood Chain', address: packetContract }))} />}</SettingGroup>{enabling && <><h2>{t('extension.wallet.smallPayments')}</h2><PinInput outlined aria-label={t('extension.wallet.password')} value={password} onValueChange={setPassword} autoComplete="off" /><div className={s.actions}><Button onClick={() => { setEnabling(false); setPassword(''); }}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={password.length !== PIN_LENGTH} onClick={() => void confirm()}>{t('common.confirm')}</Button></div></>}</div>;
}
