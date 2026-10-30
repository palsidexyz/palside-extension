'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { KeyRound, Zap } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { PinInput } from '@palside/ui/field';
import { Switch } from '@palside/ui/switch';
import { SettingGroup, SettingControl, SettingItem, settingRows } from '../settings/setting-rows';
import type { PalsideController } from '../app/use-palside';
import s from './wallet.module.css';

export function WalletSettings({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live?.state.wallet, command = c.live?.command;
  const [mode, setMode] = useState<'small' | 'export'>(), [password, setPassword] = useState(''), [secret, setSecret] = useState<{ privateKey: string; expiresAt: number }>(), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const hideSecret = useCallback(() => { generation.current++; void command?.('wallet-hide-private-key', {}).catch(() => {}); }, [command]);
  useEffect(() => {
    const clear = () => { hideSecret(); setSecret(undefined); setPassword(''); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    return () => { hideSecret(); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [hideSecret]);
  useEffect(() => { if (!secret) return; const timer = setTimeout(() => { hideSecret(); setSecret(undefined); }, Math.max(0, secret.expiresAt - Date.now())); return () => clearTimeout(timer); }, [secret, hideSecret]);
  async function confirm() {
    if (!command || busy || password.length !== 6) return; setBusy(true); const current = generation.current;
    try {
      if (mode === 'small') { if (await c.run('wallet-preferences', { smallPayments: true, password }) !== undefined) setMode(undefined); }
      else { const value = await c.run('wallet-export-private-key', { password }); if (value && current === generation.current && !document.hidden) setSecret(value); }
    } finally { setPassword(''); setBusy(false); }
  }
  return <div className={s.page}><SettingGroup><SettingControl icon={<Zap size={16} />}><Switch className={settingRows.switch} label={t('extension.wallet.smallPayments')} checked={wallet?.preferences.smallPayments ?? false} help={{ label: t('extension.wallet.smallPayments'), content: t('extension.wallet.smallLimit') }} onChange={e => { if (e.currentTarget.checked) { setMode('small'); setPassword(''); } else void c.run('wallet-preferences', { smallPayments: false }); }} /></SettingControl><SettingItem icon={<KeyRound size={16} />} title={t('extension.wallet.exportKey')} onClick={() => { setMode('export'); setPassword(''); }} /></SettingGroup>{mode && <><h2>{t(mode === 'export' ? 'extension.wallet.exportKey' : 'extension.wallet.smallPayments')}</h2>{mode === 'export' && <p className={s.note}>{t('extension.wallet.exportWarning')}</p>}{secret ? <><div className={s.secret}>{secret.privateKey}</div><p className={s.note}>{t('extension.wallet.exportExpiry')}</p><Button onClick={() => { hideSecret(); setSecret(undefined); setMode(undefined); }}>{t('common.close')}</Button></> : <><PinInput outlined aria-label={t('extension.wallet.password')} value={password} onValueChange={setPassword} autoComplete="off" /><div className={s.actions}><Button onClick={() => { hideSecret(); setMode(undefined); setPassword(''); }}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={password.length !== 6} onClick={() => void confirm()}>{t('common.confirm')}</Button></div></>}</>}</div>;
}
