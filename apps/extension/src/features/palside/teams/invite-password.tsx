'use client';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { INVITE_PASSWORD_ALPHABET, INVITE_PASSWORD_LENGTH } from '@palside/shared/contracts/limits';
import { normalizeInvitePassword } from '@palside/shared/contracts/rules';
import { useTranslations } from 'use-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Shuffle, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { PinInput, Field, Input } from '@palside/ui/field';
import { Dialog } from '@palside/ui/dialog';
import { Tooltip } from '@palside/ui/tooltip';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { SettingItem } from '../settings/setting-rows';
import { useTextState } from '../ui/text';
import type { PalsideController } from '../app/use-palside';
import s from './team-settings.module.css';

/** Uniform over the alphabet: bytes past the last whole multiple are drawn again. */
export function randomInvitePassword() {
  const size = INVITE_PASSWORD_ALPHABET.length; const limit = 256 - (256 % size);
  let value = '';
  while (value.length < INVITE_PASSWORD_LENGTH) for (const byte of crypto.getRandomValues(new Uint8Array(8))) if (byte < limit && value.length < INVITE_PASSWORD_LENGTH) value += INVITE_PASSWORD_ALPHABET[byte % size];
  return value;
}


/** Owner row under the invite link: shows the password itself so it can be read out or copied on its own. */
export function InvitePasswordRow({ c, loading, unread = false }: { c: PalsideController; loading: boolean; unread?: boolean }) {
  const t = useTranslations();
  const password = c.invitePassword;
  const [editing, setEditing] = useState(false);
  // Copy feedback belongs to the value that was copied, so a changed password starts clean.
  const [copiedValue, setCopiedValue] = useState<string>();
  const [failedValue, setFailedValue] = useState<string>();
  const copied = Boolean(password) && copiedValue === password;
  const copyFailed = Boolean(password) && failedValue === password;
  useEffect(() => { if (!copiedValue) return; const timer = setTimeout(() => setCopiedValue(undefined), 1800); return () => clearTimeout(timer); }, [copiedValue]);
  async function copy() {
    if (!password) return;
    try { await navigator.clipboard.writeText(password); setCopiedValue(password); setFailedValue(undefined); } catch { setFailedValue(password); }
  }
  const editor = editing && <InvitePasswordEditor c={c} onClose={() => setEditing(false)} />;
  // Off is a plain row reading 关闭; while reading it shows a placeholder, and when the link could not be read (retry sits above) it shows no state at all. On, the code itself is shown with copy beside it.
  if (loading || unread || !password) return <section aria-label={t('extension.copy.invitePassword')}>
    <SettingItem icon={<KeyRound size={16} />} title={t('extension.copy.invitePassword')} value={loading ? <span className={s.skeleton} role="status" aria-label={t('extension.copy.reading')} /> : unread ? undefined : t('extension.copy.invitePasswordOff')} disabled={loading || unread} onClick={() => setEditing(true)} />
    {editor}
  </section>;
  return <section aria-label={t('extension.copy.invitePassword')}>
    <div className={s.operation}><KeyRound size={16} /><div className={s.operationText}><h2>{t('extension.copy.invitePassword')}</h2><p className={s.passwordValue} translate="no">{password}</p></div>
      <div className={s.operationActions}>
        <Button className={s.operationAction} size="sm" aria-label={t('extension.copy.copyInvitePassword')} leadingIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>{copied ? t('extension.copy.copied') : t('extension.copy.copy')}</Button>
        <Menu boundarySelector="[data-palside-app]" align="end">
          <MenuTrigger asChild><IconButton label={t('extension.copy.invitePasswordActions')} size="sm" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
          <MenuContent aria-label={t('extension.copy.invitePasswordActions')} className={s.actionMenu}>
          <MenuItem icon={<Pencil size={16} />} onClick={() => { setEditing(true); }}>{t('extension.copy.changeInvitePassword')}</MenuItem>
          <MenuItem icon={<X size={16} />} onClick={() => { c.setConfirmation({ title: uiMessage('extension.copy.turnOffInvitePasswordTitle'), description: uiMessage('extension.copy.turnOffInvitePasswordDescription'), action: uiMessage('extension.copy.turnOffInvitePassword'), confirm: () => c.saveInvitePassword(null) }); }}>{t('extension.copy.turnOffInvitePassword')}</MenuItem>
        </MenuContent></Menu>
      </div>
    </div>
    {copyFailed && <div className={s.manualCopy}><Input aria-label={t('extension.copy.manualInvitePasswordCopy')} readOnly value={password} onFocus={event => event.currentTarget.select()} /></div>}
    {editor}
  </section>;
}

/** Set or change: starts from a random code (or the current one) that the owner may keep, shuffle or overtype. */
function InvitePasswordEditor({ c, onClose }: { c: PalsideController; onClose: () => void }) {
  const t = useTranslations();
  const current = c.invitePassword;
  const [value, setValue] = useState(() => current ?? randomInvitePassword());
  const [error, setError] = useTextState();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useId();
  const ready = value.length === INVITE_PASSWORD_LENGTH && value !== current;
  async function save() {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try { await c.saveInvitePassword(value); onClose(); }
    catch (failure) { setError(failure instanceof Error ? errorMessage(failure) : uiMessage('common.error')); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }} title={current ? t('extension.copy.changeInvitePasswordTitle') : t('extension.copy.setInvitePasswordTitle')} description={t('extension.copy.invitePasswordDescription')} pending={busy} initialFocusRef={input} placement="bottom" boundarySelector="[data-palside-app]"
    footer={<><Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form={form} variant="primary" loading={busy} loadingLabel={t('common.working')} disabled={!ready}>{t('extension.copy.save')}</Button></>}>
    <form id={form} className={s.passwordForm} onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label={t('extension.copy.invitePassword')} hint={error ? undefined : t('extension.copy.invitePasswordRule')} error={error}>{props => <div className={s.passwordInput}>
        {/* Selecting on focus lets the first keystroke replace the suggestion. */}
        <PinInput {...props} ref={input} className={s.passwordCells} length={INVITE_PASSWORD_LENGTH} reveal normalize={normalizeInvitePassword} autoComplete="off" value={value} disabled={busy} onFocus={event => event.currentTarget.select()} onValueChange={next => { setValue(next); setError(''); }} />
        <Tooltip content={t('extension.copy.randomInvitePassword')}><IconButton label={t('extension.copy.randomInvitePassword')} variant="quiet" disabled={busy} onClick={() => { setValue(randomInvitePassword()); setError(''); input.current?.focus(); }}><Shuffle size={16} /></IconButton></Tooltip>
      </div>}</Field>
    </form>
  </Dialog>;
}
