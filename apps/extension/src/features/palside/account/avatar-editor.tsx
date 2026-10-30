'use client';
import { AVATAR_BYTES, IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { errorMessage, message as uiMessage, MessageError } from '@palside/i18n';

import { useTextState } from '../ui/text';

import { useTranslations } from 'use-intl';
import { use, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Camera, Check, ImagePlus, Upload } from 'lucide-react';
import { Avatar } from '@palside/ui/avatar';
import { Button, IconButton } from '@palside/ui/button';
import { Tooltip } from '@palside/ui/tooltip';
import { prepareImage } from '@palside/ui/lib/image';
import { Dialog } from '@palside/ui/dialog';
import { defaultAvatar, defaultAvatarOptions, TeamPortraits } from './default-avatar';
import { defaultTeamAvatar, defaultTeamAvatarOptions } from '../teams/default-team-avatar';
import type { PalsideController } from '../app/use-palside';
import { readImage } from './read-image';
import s from './avatar-editor.module.css';

type Choice = { src: string; label: string; data?: string; reset?: boolean };

/** Account/team key closes stale drafts when the user changes identity or destination. Children make the avatar itself the trigger. */
export function AvatarEditor({ c, team = false, compact = false, children }: { c: PalsideController; team?: boolean; compact?: boolean; children?: ReactNode }) {
  return <AvatarControl key={`${c.data.self}:${team ? c.current : 'personal'}`} c={c} team={team} compact={compact}>{children}</AvatarControl>;
}

function AvatarControl({ c, team, compact, children }: { c: PalsideController; team: boolean; compact: boolean; children?: ReactNode }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const permitted = !team || (c.team.owner === c.data.self && c.canWrite);
  if (!permitted) return null;
  return <>
    {children ? <Tooltip content={t('extension.copy.changeAvatar')}><button type="button" className={s.trigger} aria-label={t('extension.copy.changeAvatar')} onClick={() => setOpen(true)}>{children}<span className={s.badge} aria-hidden="true"><Camera size={14} /></span></button></Tooltip>
      : compact ? <Tooltip content={t('extension.copy.changeAvatar')}><IconButton label={t('extension.copy.changeAvatar')} variant="quiet" onClick={() => setOpen(true)}><ImagePlus size={16} /></IconButton></Tooltip>
      : <Button size="sm" onClick={() => setOpen(true)}>{t('extension.copy.changeAvatar')}</Button>}
    {open && <AvatarPicker c={c} team={team} onClose={() => setOpen(false)} />}
  </>;
}

function AvatarPicker({ c, team, onClose }: { c: PalsideController; team: boolean; onClose: () => void }) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useTextState();
  const [choice, setChoice] = useState<Choice>();
  const accountId = c.data.self;
  const teamId = team ? c.current : undefined;
  const current = team ? c.team.avatar : 'avatar' in c.me ? c.me.avatar : undefined;
  const portraits = use(TeamPortraits);
  const fallback = (team ? defaultTeamAvatar(c.current) : portraits?.get(accountId) ?? defaultAvatar(accountId))!;
  const avatarId = team ? c.live?.state.remoteTeams.find(item => item.id === teamId)?.avatarId : c.live?.state.account?.avatarId;
  const options = team ? defaultTeamAvatarOptions : defaultAvatarOptions;
  const shown = choice?.src ?? current ?? fallback;
  const canSave = Boolean(choice) && !busy && !c.disconnected;

  async function upload(file?: File) {
    if (!file || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { blob } = await prepareImage(file, { maxBytes: AVATAR_BYTES, maxDimension: 256 });
      const data = await readImage(blob);
      if (alive.current) setChoice({ src: data, data, label: 'extension.copy.uploadedImage' });
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.imageReadFailed'));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function save() {
    if (!choice || !canSave || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    // Capture the destination before image I/O. Runtime and server re-check identity/ownership.
    const selected = choice;
    const live = c.live;
    try {
      if (live) {
        if (selected.reset) {
          if (avatarId) await live.command('remove-avatar', { id: avatarId, accountId });
        } else {
          let data = selected.data;
          if (!data) {
            const response = await fetch(selected.src);
            if (!response.ok) throw new MessageError(uiMessage('extension.copy.avatarLoadFailed'));
            const blob = await response.blob();
            if (blob.type !== 'image/webp' || !blob.size || blob.size > 20_000) throw new MessageError(uiMessage('extension.copy.avatarInvalid'));
            data = await readImage(blob);
          }
          if (!alive.current) return;
          await live.command('avatar', { accountId, data, ...(teamId ? { teamId } : {}) });
        }
      } else {
        const avatar = selected.reset ? undefined : selected.src;
        if (teamId) c.setTeams(old => old.map(item => item.id === teamId ? { ...item, avatar } : item));
        else c.setPeople(old => old.map(item => item.id === accountId ? { ...item, avatar } : item));
      }
      if (alive.current) { c.setNotice(live ? uiMessage('extension.copy.avatarUpdated') : uiMessage('extension.copy.avatarDemoUpdated')); onClose(); }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.avatarSaveFailed'));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog open title={team ? t('extension.copy.changeTeamAvatar') : t('extension.copy.changePersonalAvatar')} kind="view" boundarySelector="[data-palside-app]" pending={busy}
    onOpenChange={open => { if (!open && !lock.current) onClose(); }}
    headerAction={<IconButton label={t('common.back')} variant="quiet" disabled={busy} onClick={onClose}><ArrowLeft /></IconButton>}
    footer={<><Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button><Button loadingLabel={t('common.working')} variant="primary" disabled={!canSave} loading={busy} onClick={() => void save()}>{t('extension.copy.saveAvatar')}</Button></>}>
    <div className={s.picker} data-avatar-picker={team ? 'team' : 'personal'}>
      <div className={s.preview}>
        <Avatar fallbackLabel={t('extension.copy.currentAvatar')} name={choice ? t(choice.label) : t('extension.copy.currentAvatar')} src={shown} shape={team ? 'rounded' : 'circle'} className={s.face} />
        <div><strong>{choice ? t(choice.label) : t('extension.copy.currentAvatar')}</strong></div>
      </div>
      <div className={s.tools}>
        <input ref={input} type="file" accept={IMAGE_MIME_TYPES.join(',')} className={s.fileInput} tabIndex={-1} aria-label={t('extension.copy.uploadAvatar')} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
        <Button size="sm" variant="surface" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />{t('extension.copy.uploadImage')}</Button>
        {(current || avatarId) && <Button size="sm" disabled={busy} onClick={() => { setChoice({ src: fallback, label: 'extension.copy.defaultAvatar', reset: true }); setError(''); }}>{t('extension.copy.restoreDefault')}</Button>}
      </div>
      {c.disconnected && <p className={s.error} role="status">{t('extension.copy.avatarSaveOnline')}</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.grid} role="group" aria-label={team ? t('extension.copy.teamAvatarCount', { count: defaultTeamAvatarOptions.length }) : t('extension.copy.personalAvatarCount', { count: defaultAvatarOptions.length })}>
        {options.map(option => {
          const selected = !choice?.reset && shown === option.src;
          return <button type="button" className={s.option} key={option.id} disabled={busy} aria-label={t(option.label)} aria-pressed={selected} title={t(option.label)} onClick={() => { setChoice(option); setError(''); }}>
            <Avatar fallbackLabel={t('extension.copy.currentAvatar')} name={t(option.label)} src={option.src} shape={team ? 'rounded' : 'circle'} className={s.thumbnail} />
            {selected && <span className={s.check} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
          </button>;
        })}
      </div>
    </div>
  </Dialog>;
}
