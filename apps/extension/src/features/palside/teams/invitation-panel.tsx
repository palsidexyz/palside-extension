'use client';
import { deadlineTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';

import { useTextState } from '../ui/text';

import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useState } from 'react';
import { Check, Copy, Link, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Input } from '@palside/ui/field';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { InvitePasswordRow } from './invite-password';
import type { PalsideController } from '../app/use-palside';
import s from './team-settings.module.css';

export function InvitationPanel({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const locale = useLocale();
  const [busy, setBusy] = useState(Boolean(c.live));
  const [error, setError] = useTextState();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  const command = c.live?.command;
  const teamId = c.current;
  useEffect(() => {
    if (!command) return;
    let active = true;
    void command('invitation', { teamId }).catch(failure => { if (active) setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.inviteLoadFailed')); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [command, teamId, setError]);
  const invitation = c.live?.state.invitations[c.current];
  const url = c.live ? invitation?.url ?? '' : `/invite/${encodeURIComponent(c.current)}?name=${encodeURIComponent(c.team.name)}&count=${c.team.memberCount ?? c.team.memberIds.length}&v=${c.inviteVersion}`;
  async function load(regenerate = false) {
    if (busy) return; setBusy(true); setError(''); setCopied(false); setCopyFailed(false);
    try {
      if (command) await command('invitation', { teamId, ...(regenerate ? { action: 'regenerate' } : {}) });
      else { c.setInviteActive(true); c.setInviteVersion(v => v + 1); }
    } catch (failure) { setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.inviteLoadFailed')); }
    finally { setBusy(false); }
  }
  const expiry = invitation ? t('extension.dynamic.inviteUntil', { date: deadlineTime(new Date(invitation.expiresAt ?? 0).getTime(), localeOrEnglish(locale)) }) : t('extension.copy.inviteLifetime');
  // Link and password are separate rows: either can be replaced without the other.
  return <><section aria-label={t('extension.copy.inviteLink')}>
    <div className={s.operation}><Link size={16} /><div className={s.operationText}><h2>{t('extension.copy.inviteLink')}</h2>{busy ? <p><span className={s.skeleton} data-wide role="status" aria-label={t('extension.copy.reading')} /></p> : c.inviteActive ? <p>{expiry}</p> : c.inviteSuspended ? <p className={s.warning}>{t('extension.copy.inviteSuspended')}</p> : <p>{invitation || !c.live ? t('extension.copy.expired') : t('extension.copy.notGenerated')}</p>}</div>
      <div className={s.operationActions}>{error ? <Button className={s.operationAction} loadingLabel={t('common.working')} size="sm" loading={busy} onClick={() => void load()}>{t('common.retry')}</Button> : c.inviteActive ? <>
        <Button className={s.operationAction} size="sm" disabled={busy} aria-label={t('extension.copy.copyInvite')} leadingIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={async () => { try { await navigator.clipboard.writeText(location.protocol.startsWith('http') ? new URL(url, location.origin).href : url); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{copied ? t('extension.copy.copied') : t('extension.copy.copy')}</Button>
        <Menu boundarySelector="[data-palside-app]" align="end">
          <MenuTrigger asChild><IconButton label={t('extension.copy.inviteActions')} size="sm" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
          <MenuContent aria-label={t('extension.copy.inviteActions')} className={s.actionMenu}><MenuItem disabled={busy} icon={<RefreshCw size={16} />} onClick={() => { void load(true); }}>{t('extension.copy.regenerate')}</MenuItem><MenuItem disabled={busy} icon={<X size={16} />} onClick={() => { c.setConfirmation({ title: uiMessage('extension.copy.revokeInviteTitle'), description: uiMessage('extension.copy.revokeInviteDescription'), action: uiMessage('extension.copy.revokeLink'), danger: true, confirm: async () => { if (command) await command('invitation', { teamId, action: 'revoke' }); else c.setInviteActive(false); } }); }}>{t('extension.copy.revokeLink')}</MenuItem></MenuContent></Menu>
      </> : <Button className={s.operationAction} loadingLabel={t('common.working')} size="sm" loading={busy} onClick={() => void load(true)}>{invitation || !c.live ? t('extension.copy.regenerate') : t('extension.copy.generateLink')}</Button>}</div>
    </div>
    {error && <p className={s.error} role="alert">{error}</p>}
    {copyFailed && <Input aria-label={t('extension.copy.manualInviteCopy')} readOnly value={location.protocol.startsWith('http') ? new URL(url, location.origin).href : url} onFocus={event => event.currentTarget.select()} />}
  </section>
  <InvitePasswordRow c={c} loading={busy} unread={Boolean(c.live && !invitation)} /></>;
}
