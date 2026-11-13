'use client';
import { PIN_LENGTH } from '@palside/shared/rules/accounts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { KeyRound, ScrollText, Zap } from 'lucide-react';
import { AddressCopy } from '@palside/ui/address-copy';
import { shortAddress } from '@palside/shared/navigation';
import { ChainLogo } from '../assets/chain-identity';
import { message as uiMessage } from '@palside/i18n';
import { Button } from '@palside/ui/button';
import { PinInput } from '@palside/ui/field';
import { Switch } from '@palside/ui/switch';
import { SettingGroup, SettingControl, SettingItem, settingRows } from '../settings/setting-rows';
import type { PalsideController } from '../app/use-palside';
import { quickPayLimits } from '../../../domain/wallet/model';
import { groupPals } from './amount';
import s from './wallet.module.css';

export function WalletSettings({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live.state.wallet, command = c.live.command;
  const [mode, setMode] = useState<'small' | 'export'>(), [password, setPassword] = useState(''), [secret, setSecret] = useState<{ privateKey: string; expiresAt: number }>(), [busy, setBusy] = useState(false);
  const limits = wallet?.config && quickPayLimits(wallet.config.quickPay), token = wallet?.config?.deployment?.token;
  const generation = useRef(0);
  const hideSecret = useCallback(() => { generation.current++; void command('wallet-hide-private-key', {}).catch(() => {}); }, [command]);
  useEffect(() => {
    const clear = () => { hideSecret(); setSecret(undefined); setPassword(''); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    return () => { hideSecret(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [hideSecret]);
  useEffect(() => { if (!secret) return; const timer = setTimeout(() => { hideSecret(); setSecret(undefined); }, Math.max(0, secret.expiresAt - Date.now())); return () => clearTimeout(timer); }, [secret, hideSecret]);
  async function confirm() {
    if (busy || password.length !== PIN_LENGTH) return; setBusy(true); const current = generation.current;
    try {
      if (mode === 'small') { if (await c.run('wallet-preferences', { smallPayments: true, password }) !== undefined) setMode(undefined); }
      else { const value = await c.run('wallet-export-private-key', { password }); if (value && current === generation.current && !document.hidden) setSecret(value); }
    } finally { setPassword(''); setBusy(false); }
  }
  return <div className={s.page}><SettingGroup><SettingControl icon={<Zap size={16} />}><Switch className={settingRows.switch} label={t('extension.wallet.smallPayments')} checked={wallet?.preferences.smallPayments ?? false} help={{ label: t('extension.wallet.smallPayments'), content: limits ? t('extension.wallet.smallLimit', { single: groupPals(limits.single.toString()), daily: groupPals(limits.daily.toString()) }) : t('extension.copy.loading') }} onChange={e => { if (e.currentTarget.checked) { setMode('small'); setPassword(''); } else void c.run('wallet-preferences', { smallPayments: false }); }} /></SettingControl><SettingItem icon={<KeyRound size={16} />} title={t('extension.wallet.exportKey')} onClick={() => { setMode('export'); setPassword(''); }} />{token && <SettingItem icon={<ScrollText size={16} />} title={t('extension.wallet.palsContract')} end={<AddressCopy address={token} display={shortAddress(token)} label={t('extension.copy.copyContract')} ariaLabel={t('extension.dynamic.copyChainContract', { chain: 'Robinhood Chain', address: token })} icon={wallet?.config?.deployment?.chainId === 4663 ? <ChainLogo chain="Robinhood" /> : undefined} onCopy={copied => { if (!copied) c.setNotice(uiMessage('extension.copy.copyFailed')); }} />} />}</SettingGroup>{mode && <><h2>{t(mode === 'export' ? 'extension.wallet.exportKey' : 'extension.wallet.smallPayments')}</h2>{mode === 'export' && <p className={s.note}>{t('extension.wallet.exportWarning')}</p>}{secret ? <><div className={s.secret}>{secret.privateKey}</div><p className={s.note}>{t('extension.wallet.exportExpiry')}</p><Button onClick={() => { hideSecret(); setSecret(undefined); setMode(undefined); }}>{t('common.close')}</Button></> : <><PinInput outlined aria-label={t('extension.wallet.password')} value={password} onValueChange={setPassword} autoComplete="off" /><div className={s.actions}><Button onClick={() => { hideSecret(); setMode(undefined); setPassword(''); }}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={password.length !== PIN_LENGTH} onClick={() => void confirm()}>{t('common.confirm')}</Button></div></>}</>}</div>;
}
