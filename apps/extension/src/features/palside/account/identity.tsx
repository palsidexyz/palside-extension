'use client';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { errorMessage, localeOrEnglish, pastTime, message as uiMessage, type TextValue } from '@palside/i18n';
import { npubEncode, PIN_LENGTH } from '@palside/shared/identity';
import { useTranslations } from 'use-intl';
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Fingerprint, KeyRound, Laptop } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { PinInput, Field } from '@palside/ui/field';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { HelpTip } from '@palside/ui/tooltip';
import { Action } from '../ui/primitives';
import { SettingControl, SettingDanger, SettingGroup, SettingItem, settingRows as r } from '../settings/setting-rows';
import { useText, useTextState } from '../ui/text';
import type { Device } from '../../../runtime/account/device-dto';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import i from './identity.module.css';

/** The account's npub, or '' when the id is not a valid key — that one row then stays out instead of the whole page failing. */
function accountKey(id: string) { try { return npubEncode(id); } catch { return ''; } }

const failure = (error: unknown, fallback: string): TextValue => error instanceof Error ? errorMessage(error) : uiMessage(fallback);

function PhraseGrid({ phrase, hidden = false }: { phrase: readonly string[]; hidden?: boolean }) {
  return <ol className={i.phrase} data-hidden={hidden || undefined} aria-hidden={hidden || undefined}>{phrase.map((word, index) => <li key={index}><span>{index + 1}</span>{word}</li>)}</ol>;
}

/** Account-key actions ask for the device PIN each time; nothing stays unlocked. */
function PasswordForm({ submitLabel, danger = false, onSubmit, onCancel }: { submitLabel: string; danger?: boolean; onSubmit: (password: string) => Promise<void>; onCancel?: () => void }) {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useTextState();
  const ready = password.length === PIN_LENGTH;
  return <form className={s.form} onSubmit={async event => {
    event.preventDefault(); if (!ready || busy) return;
    setBusy(true); setError('');
    try { await onSubmit(password); } catch (cause) { setPassword(''); setError(failure(cause, 'common.error')); } finally { setBusy(false); }
  }}>
    <Field label={t('extension.copy.password')} error={error}>{props => <PinInput {...props} outlined autoComplete="current-password" autoFocus value={password} disabled={busy} onValueChange={value => { setPassword(value); setError(''); }} />}</Field>
    <div className={i.actions}>{onCancel && <Button onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>}<Button type="submit" size={onCancel ? undefined : 'lg'} variant={danger ? 'surface' : 'primary'} className={danger ? s.danger : undefined} loading={busy} loadingLabel={t('common.working')} disabled={!ready}>{submitLabel}</Button></div>
  </form>;
}

export function Security({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const live = c.live!;
  const npub = accountKey(c.data.self);
  const [phrase, setPhrase] = useState<string[]>();
  const [revealing, setRevealing] = useState(false);
  const [shown, setShown] = useState(false);
  const [devices, setDevices] = useState<Device[]>();
  const [devicesError, setDevicesError] = useState<TextValue>('');
  const [removing, setRemoving] = useState<Device>();
  const [load, setLoad] = useState(0);
  const command = live.command;
  useEffect(() => {
    let current = true;
    command('devices').then(result => { if (current) { setDevices(result.devices); setDevicesError(''); } }, cause => { if (current) setDevicesError(failure(cause, 'extension.copy.devicesUnavailable')); });
    return () => { current = false; };
  }, [command, load]);
  return <div className={i.page}>
    {npub && <SettingGroup title={t('extension.copy.accountId')}>
      <SettingControl icon={<Fingerprint size={16} />}><span className={i.accountId} title={npub}><span>{npub.slice(0, -8)}</span><span>{npub.slice(-8)}</span></span><Action label={t('extension.copy.copyAccountId')} onClick={() => void c.copy(npub)}><Copy /></Action></SettingControl>
    </SettingGroup>}
    <SettingGroup title={<>{t('extension.copy.recoveryPhrase')}<HelpTip label={t('extension.copy.phraseSafety')} content={[t('extension.copy.phraseWarningLost'), t('extension.copy.phraseWarningWallet'), t('extension.copy.phraseWarningNeverAsk')].join('\n')} /></>}>
      {phrase ? <div className={i.panel}>
        <PhraseGrid phrase={phrase} hidden={!shown} />
        <div className={i.actions}><Button onClick={() => { setPhrase(undefined); setShown(false); }}>{t('common.close')}</Button><Button variant="primary" leadingIcon={shown ? <EyeOff size={16} /> : <Eye size={16} />} onClick={() => setShown(value => !value)}>{shown ? t('extension.copy.hidePhrase') : t('extension.copy.showPhrase')}</Button></div>
      </div> : revealing ? <div className={i.panel}>
        <PasswordForm submitLabel={t('extension.copy.viewPhrase')} onCancel={() => setRevealing(false)} onSubmit={async password => { const result = await live.command('mnemonic-reveal', { password }); setPhrase(result.words); setRevealing(false); }} />
      </div> : <SettingItem icon={<KeyRound size={16} />} title={t('extension.copy.viewPhrase')} onClick={() => setRevealing(true)} />}
    </SettingGroup>
    {devicesError ? <section className={r.group}>
      <div className={r.head}><span>{t('extension.copy.devices')}</span></div>
      <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => setLoad(n => n + 1) }}>{text(devicesError)}</InlineFeedback>
    </section> : <SettingGroup title={<>{t('extension.copy.devices')}<HelpTip label={t('extension.copy.devicesHelp')} content={t('extension.copy.removeDeviceHint')} /></>}>
      {!devices ? <div className={r.row} role="status" aria-busy="true"><span className={r.icon} aria-hidden="true"><Laptop size={16} /></span><VisuallyHidden>{t('common.working')}</VisuallyHidden><span className={i.lines}><i /><i /></span></div>
        : devices.map(device => <div key={device.id} className={`${r.row} ${i.device}`}>
          <span className={r.icon} aria-hidden="true"><Laptop size={16} /></span>
          <span className={r.text}><strong>{device.label}</strong><small>{t('extension.dynamic.deviceAdded', { date: pastTime(device.createdAt, localeOrEnglish(c.locale), c.now) })}</small></span>
          {device.current ? <span className={i.current}>{t('extension.copy.thisDevice')}</span> : removing?.id !== device.id && <Button size="sm" className={s.danger} onClick={() => setRemoving(device)}>{t('extension.copy.removeDevice')}</Button>}
          {removing?.id === device.id && <div className={i.removal}><PasswordForm danger submitLabel={t('extension.copy.removeDevice')} onCancel={() => setRemoving(undefined)} onSubmit={async password => { await live.command('device-remove', { id: device.id, password }); setRemoving(undefined); c.setNotice(uiMessage('extension.dynamic.deviceRemoved', { name: device.label })); setLoad(n => n + 1); }} /></div>}
        </div>)}
    </SettingGroup>}
    <SettingDanger onClick={() => {
      if (c.teams.some(team => team.owner === c.data.self && team.joined)) c.setNotice(uiMessage('extension.copy.transferOwnedTeams'));
      else c.go('delete-account');
    }}>{t('extension.copy.deleteAccount')}</SettingDanger>
  </div>;
}

export function DeleteAccountForm({ c }: { c: PalsideController }) {
  const t = useTranslations();
  return <div className={s.form}>
    <p>{t('extension.copy.deleteAccountDescription')}</p>
    <PasswordForm danger submitLabel={t('extension.copy.deleteAccount')} onSubmit={async password => c.setConfirmation({ title: uiMessage('extension.copy.permanentDeleteTitle'), description: uiMessage('extension.copy.permanentDeleteDescription'), action: uiMessage('extension.copy.deleteAccount'), danger: true, confirm: async () => { await c.live!.command('delete-account', { password }); } })} />
  </div>;
}
