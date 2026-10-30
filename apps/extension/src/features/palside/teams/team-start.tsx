'use client';
import { AVATAR_BYTES, IMAGE_MIME_TYPES, INVITE_PASSWORD_LENGTH, TEAM_DESCRIPTION_LENGTH, TEAM_JOINED_LIMIT, TEAM_MEMBER_LIMIT, TEAM_NAME_LENGTH, TEAM_OWNED_LIMIT } from '@palside/shared/contracts/limits';
import { normalizeInvitePassword } from '@palside/shared/contracts/rules';
import { deadlineTime, errorMessage, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { Ban, Camera, ChevronRight, ClipboardPaste, Compass, History, Link2, MoreHorizontal, Settings2, Shuffle, Trash2, UsersRound, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Field, Input, PinInput, Textarea, CharacterCount } from '@palside/ui/field';
import { Sheet } from '@palside/ui/sheet';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { prepareImage } from '@palside/ui/lib/image';
import { Brand } from '../ui/brand';
import { Action } from '../ui/primitives';
import { Count, CountText } from '../ui/motion-details';
import { useTextState } from '../ui/text';
import { readImage } from '../account/read-image';
import { characterLength } from '../../../domain/chat/model';
import type { Team } from '../../../domain/teams/model';
import { defaultTeamAvatarOptions } from './default-team-avatar';
import { TeamAvatar } from './team-avatar';
import type { PalsideController } from '../app/use-palside';
import base from '../app/palside.module.css';
import s from './team-start.module.css';

const PICKS = 5;
const errorCode = (failure: unknown) => typeof failure === 'object' && failure && 'code' in failure ? String((failure as { code?: unknown }).code) : '';
const passwordErrors = new Set(['INVITE_PASSWORD_WRONG', 'INVITE_PASSWORD_REQUIRED', 'INVITE_PASSWORD_LOCKED']);
const terminalJoinErrors = new Set(['INVITE_INVALID', 'INVITE_EXPIRED', 'TEAM_NOT_FOUND', 'TEAM_CLOSED', 'TEAM_FULL', 'TEAM_LIMIT', 'JOIN_BLOCKED', 'JOIN_CANCELLED', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_RESTRICTED', 'ACCOUNT_BANNED', 'LOGIN_REQUIRED', 'DEVICE_REVOKED', 'INVALID_INPUT', 'ORIGIN_DENIED', 'OPERATION_ID_REQUIRED', 'OPERATION_CONFLICT', 'OPERATION_ENDED', 'OPERATION_EXPIRED']);
type EntryPrompt = NonNullable<PalsideController['joinPrompt']> & { pendingInvite?: string };
function randomPicks() {
  return defaultTeamAvatarOptions.map(option => option.id).sort(() => Math.random() - .5).slice(0, PICKS);
}
/** Teams the user left, was removed from or saw dissolved; their read-only history is still open. */
export const formerTeams = (c: PalsideController) => c.teams.filter(team => team.readonly && !team.joined);

/** 首页 with no team, and 添加小队 with some: the team being made is the page — its avatar, its name, then the two other ways in. */
export function TeamStart({ c }: { c: PalsideController }) {
  const t = useTranslations();
  return <section className={s.start} aria-label={t('extension.copy.yourTeam')}>
    <header className={base.secondaryHeader}><Brand /><Action label={t('extension.copy.settings')} onClick={() => c.go('settings')}><Settings2 /></Action></header>
    <TeamStartForm c={c} />
  </section>;
}

export function TeamStartForm({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [picks, setPicks] = useState(() => randomPicks());
  const [avatar, setAvatar] = useState<{ preset?: string; upload?: string }>(() => ({ preset: picks[0] }));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useTextState();
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const avatarVersion = useRef(0);
  useEffect(() => () => { avatarVersion.current++; }, []);
  const joined = c.teams.filter(team => team.joined);
  const limit = joined.filter(team => team.owner === c.data.self).length >= TEAM_OWNED_LIMIT ? t('extension.start.ownedLimit', { count: TEAM_OWNED_LIMIT }) : joined.length >= TEAM_JOINED_LIMIT ? t('extension.start.joinedLimit', { count: TEAM_JOINED_LIMIT }) : '';
  const tooLong = characterLength(name.trim()) > TEAM_NAME_LENGTH;
  const invites = c.live?.state.rooms.invites.length ?? 0;
  const former = formerTeams(c).length;
  const src = avatar.upload ?? defaultTeamAvatarOptions.find(option => option.id === avatar.preset)?.src;
  const ready = !busy && !processing && !limit && Boolean(name.trim()) && !tooLong && characterLength(description.trim()) <= TEAM_DESCRIPTION_LENGTH;
  function selectPreset(preset: string) {
    avatarVersion.current++; setProcessing(false); setAvatar({ preset });
  }
  async function upload(chosen?: File) {
    if (!chosen) return;
    const version = ++avatarVersion.current;
    setProcessing(true); setError('');
    try {
      const { blob } = await prepareImage(chosen, { maxBytes: AVATAR_BYTES, maxDimension: 256 });
      if (version !== avatarVersion.current) return;
      const upload = await readImage(blob);
      if (version === avatarVersion.current) setAvatar({ upload });
    } catch (failure) { if (version === avatarVersion.current) setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.imageReadFailed')); }
    finally { if (version === avatarVersion.current) setProcessing(false); }
  }
  async function create() {
    if (!ready) return;
    setBusy(true); setError('');
    try { await c.createTeam(name, description, src); }
    catch (failure) { setError(failure instanceof Error ? errorMessage(failure) : uiMessage('common.error')); }
    finally { setBusy(false); }
  }
  return <div className={s.body}>
    <form className={s.form} aria-busy={busy || undefined} onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className={s.identity}>
        <button type="button" className={s.face} aria-label={t('extension.copy.uploadAvatar')} disabled={busy} onClick={() => file.current?.click()}>
          <TeamAvatar team={{ id: `start-${avatar.preset ?? 'upload'}`, name: name || t('common.team'), avatar: src }} size="xl" />
          <span className={s.camera} aria-hidden="true"><Camera size={14} /></span>
        </button>
        <input ref={file} type="file" hidden accept={IMAGE_MIME_TYPES.join(',')} tabIndex={-1} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; void upload(chosen); }} />
        <div className={s.picks} role="group" aria-label={t('extension.copy.teamAvatarCount', { count: defaultTeamAvatarOptions.length })}>
          {picks.map(pick => { const option = defaultTeamAvatarOptions.find(item => item.id === pick)!; return <button type="button" key={pick} className={s.pick} aria-pressed={avatar.preset === pick} aria-label={t(option.label)} disabled={busy} onClick={() => selectPreset(pick)}><img src={option.src} alt="" /></button>; })}
          <IconButton label={t('extension.start.shuffle')} size="sm" variant="surface" className={s.shuffle} disabled={busy} onClick={() => { const next = randomPicks(); setPicks(next); selectPreset(next[0]!); }}><Shuffle size={15} /></IconButton>
        </div>
        <Input id={`${id}-name`} className={s.name} aria-label={t('extension.copy.teamName')} aria-invalid={tooLong || Boolean(limit) || undefined} placeholder={t('extension.copy.teamName')} value={name} disabled={busy} autoComplete="off" autoFocus onChange={event => { setName(event.target.value); setError(''); }} />
        {(limit || tooLong || error) && <p className={s.error} role="alert">{limit || (tooLong ? t('extension.copy.teamNameLimit') : error)}</p>}
      </div>
      <Field id={`${id}-description`} label={t('extension.copy.teamIntro')} className={s.bare} counter={<CharacterCount value={description} limit={TEAM_DESCRIPTION_LENGTH} label={t('extension.dynamic.characterCount', { count: characterLength(description), maximum: TEAM_DESCRIPTION_LENGTH, excess: Math.max(0, characterLength(description) - TEAM_DESCRIPTION_LENGTH) })} />}>{props => <Textarea {...props} className={s.intro} disabled={busy} value={description} placeholder={t('extension.copy.teamIntro')} onChange={event => setDescription(event.target.value)} />}</Field>
      <Button type="submit" variant="primary" size="lg" loading={busy} loadingLabel={t('extension.start.creating')} disabled={!ready}>{t('extension.copy.createTeam')}</Button>
    </form>
    <div className={s.or}><span>{t('extension.start.or')}</span></div>
    <div className={s.ways}>
      <Button size="lg" leadingIcon={<Link2 size={16} />} disabled={busy} onClick={() => c.go('join')}>{t('extension.copy.joinInvitation')}</Button>
      <Button size="lg" leadingIcon={<Compass size={16} />} disabled={busy} onClick={() => c.go('lobby')}>{t('extension.copy.visitLobby')}{invites > 0 && <span className={s.badge} aria-label={t('extension.invite.pending', { count: invites })}><Count value={invites} /></span>}</Button>
    </div>
    {former > 0 && <button type="button" className={s.former} disabled={busy} onClick={() => c.go('former-teams')}><History size={16} aria-hidden="true" /><span>{t('extension.start.formerTeams')}</span><small><Count value={former} /></small><ChevronRight size={15} aria-hidden="true" /></button>}
  </div>;
}

/** 通过邀请加入: one field for the link. A readable invitation opens the join sheet; an unreadable one is a field error and nothing else. */
export function JoinPage({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const pending = c.data.pendingInvite ? c.live ? c.data.pendingInvite : `/invite/${c.data.pendingInvite}` : '';
  const [link, setLink] = useState(pending);
  const [error, setError] = useTextState();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const context = useMemo(() => ({ self: c.data.self, screen: c.screen }), [c.data.self, c.screen]);
  const active = useRef<typeof context | undefined>(context);
  const running = useRef(false);
  useEffect(() => { active.current = context; return () => { active.current = undefined; }; }, [context]);
  const isActive = () => active.current === context;
  async function preview(value = link) {
    const url = value.trim();
    if (!url || !isActive() || running.current) return;
    running.current = true;
    setBusy(true); setError('');
    const open = (prompt: EntryPrompt) => { const entry = { ...prompt, pendingInvite: url === pending ? c.data.pendingInvite : undefined }; c.setJoinPrompt(entry); };
    try {
      if (!c.live) {
        const code = url.split('?')[0]?.split('/').filter(Boolean).at(-1);
        const team = c.teams.find(item => item.id === (code === 'night-owls' ? 'night' : code));
        if (!team || (team.id === c.current && !c.inviteActive)) { setError(uiMessage('extension.copy.invalidInvitation')); return; }
        if (team.joined) { c.chooseTeam(team.id); return; }
        open({ invite: team.id, team: { id: team.id, name: team.name, description: team.description, memberCount: team.memberCount ?? team.memberIds.length } });
        return;
      }
      const result = await c.previewInvite(url);
      if (!isActive() || !result) return;
      if (result.alreadyMember) { const joined = await c.live.command('join', { invite: result.invite }); if (isActive()) c.chooseTeam(joined.teamId); return; }
      open({ invite: result.invite, team: result.team, lockedUntil: result.lockedUntil, passwordRequired: result.passwordRequired });
    } catch (failure) {
      if (!isActive()) return;
      if (errorCode(failure) === 'JOIN_BLOCKED') { open({ invite: '', blocked: true }); return; }
      setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.invalidInvitation'));
    } finally { running.current = false; if (isActive()) setBusy(false); }
  }
  useEffect(() => { if (pending && !started.current) { started.current = true; void preview(pending); } });
  async function paste() {
    try { const value = (await navigator.clipboard.readText()).trim(); if (isActive() && value) { setLink(value); void preview(value); } }
    catch { if (isActive()) setError(uiMessage('extension.start.pasteFailed')); }
  }
  return <div className={s.joinBody}>
    <div className={s.trio} aria-hidden="true">{['ride-boat', 'cool-birds', 'ride-spaceship'].map(id => <img key={id} src={defaultTeamAvatarOptions.find(option => option.id === id)?.src} alt="" />)}</div>
    <form className={s.paste} onSubmit={event => { event.preventDefault(); void preview(); }}>
      <Input className={s.link} aria-label={t('extension.copy.inviteLink')} aria-invalid={Boolean(error) || undefined} leadingIcon={<Link2 size={16} />} placeholder={t('extension.copy.pasteInvitation')} value={link} disabled={busy} autoComplete="off" autoFocus
        onChange={event => { setLink(event.target.value); setError(''); }} onPaste={event => { const value = event.clipboardData.getData('text').trim(); if (value) { event.preventDefault(); setLink(value); void preview(value); } }} />
      {link ? <IconButton type="button" label={t('extension.start.clearLink')} variant="quiet" disabled={busy} onClick={() => { setLink(''); setError(''); }}><X size={16} /></IconButton>
        : <IconButton type="button" label={t('extension.start.pasteLink')} variant="primary" disabled={busy} onClick={() => void paste()}><ClipboardPaste size={16} /></IconButton>}
    </form>
    {error && <p className={s.fieldError} role="alert">{error}</p>}
  </div>;
}

/** The one join step for an invite link: the team, then — when it needs one — the password, all in a single bottom sheet. */
export function JoinSheet({ c }: { c: PalsideController }) {
  const prompt = c.joinPrompt as EntryPrompt | undefined;
  const context = useMemo(() => ({ prompt, self: c.data.self, screen: c.screen }), [prompt, c.data.self, c.screen]);
  const active = useRef<typeof context | undefined>(context);
  useEffect(() => { active.current = context; return () => { active.current = undefined; }; }, [context]);
  const isActive = () => active.current === context;
  const close = () => {
    if (!isActive()) return;
    active.current = undefined;
    c.setJoinPrompt(undefined);
    if (prompt?.pendingInvite && c.live) void c.run('dismiss-invite', { url: prompt.pendingInvite });
  };
  return <Sheet open={Boolean(prompt)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="join-sheet-title" className={s.sheet}>
    {prompt && <JoinPrompt key={prompt.invite} c={c} prompt={prompt} close={close} isActive={isActive} />}
  </Sheet>;
}

function JoinPrompt({ c, prompt, close, isActive }: { c: PalsideController; prompt: EntryPrompt; close: () => void; isActive: () => boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useTextState();
  const [notice, setNotice] = useTextState();
  const [lockedUntil, setLockedUntil] = useState(prompt.lockedUntil ?? 0);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(prompt);
  const [needsPassword, setNeedsPassword] = useState(Boolean(prompt.passwordRequired));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setTimeout(() => { setLockedUntil(0); setFieldError(''); }, Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [lockedUntil, setFieldError]);
  const header = (title: ReactNode) => <header className={s.sheetHead}><span id="join-sheet-title" className={s.sheetTitle}>{title}</span><IconButton size="sm" variant="quiet" label={t('common.close')} onClick={close}><X size={16} /></IconButton></header>;
  if (prompt.blocked || !prompt.team) return <>
    {header(<VisuallyHidden>{t('extension.start.blocked')}</VisuallyHidden>)}
    <div className={s.state}><span className={s.stateMark}><Ban size={22} /></span><strong>{t('extension.start.blocked')}</strong></div>
    <Button size="lg" variant="surface" onClick={close}>{t('extension.start.gotIt')}</Button>
  </>;
  const team = preview.team ?? prompt.team;
  const count = team.memberCount;
  const full = count >= TEAM_MEMBER_LIMIT;
  const quota = c.teams.filter(item => item.joined).length >= TEAM_JOINED_LIMIT;
  const locked = lockedUntil > 0;
  const ready = !full && !quota && !locked && !ended && (!needsPassword || value.length === INVITE_PASSWORD_LENGTH);
  async function join() {
    if (busy || !ready || !isActive()) return;
    setBusy(true); setFieldError(''); setNotice('');
    try {
      if (!c.live) { c.setJoinPrompt(undefined); c.joinTeam(team.id); c.setNotice(uiMessage('extension.invite.joined', { name: team.name })); return; }
      const joined = await c.live.command('join', { invite: prompt.invite, ...(needsPassword ? { password: value } : {}) });
      if (!isActive()) return;
      c.setJoinPrompt(undefined);
      if (joined) { c.chooseTeam(joined.teamId); c.setNotice(uiMessage('extension.invite.joined', { name: team.name })); }
    } catch (failure) {
      if (!isActive()) return;
      const code = errorCode(failure);
      const message = failure instanceof Error ? errorMessage(failure) : uiMessage('common.error');
      if (passwordErrors.has(code)) {
        setNeedsPassword(true); setValue(''); setFieldError(message);
        if (code === 'INVITE_PASSWORD_REQUIRED' && c.live) {
          try {
            const refreshed = await c.previewInvite(new URL(`/invite/${prompt.invite}`, c.live.state.config.websiteUrl).href);
            if (!isActive()) return;
            if (refreshed) { setPreview(refreshed); setLockedUntil(refreshed.lockedUntil ?? 0); setNeedsPassword(refreshed.passwordRequired); }
          } catch (refreshFailure) {
            if (!isActive()) return;
            setNotice(refreshFailure instanceof Error ? errorMessage(refreshFailure) : uiMessage('common.error'));
            setEnded(terminalJoinErrors.has(errorCode(refreshFailure)));
          }
        }
        if (code === 'INVITE_PASSWORD_LOCKED') { const details = failure as { lockedUntil?: number; retryAfterMs?: number }; setLockedUntil(details.lockedUntil ?? Date.now() + (details.retryAfterMs ?? 60_000)); }
        else requestAnimationFrame(() => { if (isActive()) input.current?.focus(); });
      } else { setNotice(message); setEnded(terminalJoinErrors.has(code)); }
    } finally { if (isActive()) setBusy(false); }
  }
  const status = full ? t('extension.copy.teamFull') : quota ? t('extension.start.joinedLimit', { count: TEAM_JOINED_LIMIT }) : locked ? t('extension.start.lockedUntil', { time: deadlineTime(lockedUntil, localeOrEnglish(locale)) }) : '';
  return <form onSubmit={event => { event.preventDefault(); void join(); }}>
    {header(null)}
    <div className={s.preview}>
      <TeamAvatar team={{ id: team.id, name: team.name, avatar: c.teams.find(item => item.id === team.id)?.avatar }} size="lg" />
      <h2 className={s.nameLine}><span id="join-sheet-title">{team.name}</span><span className={s.count}><UsersRound size={13} aria-hidden="true" /><CountText text={`${count} / ${TEAM_MEMBER_LIMIT}`} value={count} /></span></h2>
      {team.description && <p className={s.description}>{team.description}</p>}
      {status && <p className={full || quota ? s.statusError : s.status} role="status">{status}</p>}
    </div>
    {needsPassword && !full && !quota && <Field label={t('extension.copy.invitePassword')} className={s.bare} error={fieldError}>{props => <PinInput {...props} ref={input} className={s.pin} length={INVITE_PASSWORD_LENGTH} reveal normalize={normalizeInvitePassword} autoComplete="off" data-autofocus value={value} disabled={busy || locked || ended} onValueChange={next => { setValue(next); if (!locked) setFieldError(''); setNotice(''); }} />}</Field>}
    {notice && <InlineFeedback tone="error">{notice}</InlineFeedback>}
    <Button type="submit" variant="primary" size="lg" className={s.join} loading={busy} loadingLabel={t('common.working')} disabled={!ready}>{t('extension.copy.joinTeam')}</Button>
  </form>;
}

/** 已离开的小队: read-only teams kept for their history, each with where it ended and until when it stays. */
export function FormerTeams({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const teams = formerTeams(c);
  if (!teams.length) return <div className={base.empty} data-fill><History /><p>{t('extension.start.noFormerTeams')}</p></div>;
  const reason = (team: Team) => t(team.readonlyReason === 'removed' ? 'extension.start.removed' : team.readonlyReason === 'dissolved' ? 'extension.start.dissolved' : 'extension.start.left');
  return <div className={s.formerList}>{teams.map(team => <div key={team.id} className={s.formerRow}>
    <button type="button" className={s.formerOpen} onClick={() => c.openFormerTeam(team.id)}>
      <span className={s.formerFace}><TeamAvatar team={team} size="md" /></span>
      <span className={s.formerText}><strong>{team.name}</strong><small>{reason(team)}</small></span>
    </button>
    <Menu boundarySelector="[data-palside-app]" align="end">
      <MenuTrigger asChild><IconButton label={t('extension.dynamic.memberActions', { name: team.name })} size="sm" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
      <MenuContent aria-label={t('extension.dynamic.memberActions', { name: team.name })}><MenuItem tone="danger" icon={<Trash2 size={16} />} onClick={() => c.forgetTeam(team.id)}>{t('extension.start.forget')}</MenuItem></MenuContent>
    </Menu>
  </div>)}</div>;
}
