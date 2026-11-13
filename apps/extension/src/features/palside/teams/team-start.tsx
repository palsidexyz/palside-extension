'use client';
import { MINUTE_MS } from '@palside/shared/units';
import { AVATAR_BYTES, IMAGE_MIME_TYPES } from '@palside/shared/rules/media';
import { INVITE_PASSWORD_LENGTH, TEAM_DESCRIPTION_LENGTH, TEAM_JOINED_LIMIT, TEAM_MEMBER_LIMIT, TEAM_NAME_LENGTH, TEAM_OWNED_LIMIT } from '@palside/shared/rules/teams';
import { normalizeInvitePassword } from '@palside/shared/contracts/rules';
import { deadlineTime,localeOrEnglish,message as uiMessage,failureText } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { Ban, Camera, ChevronRight, ClipboardPaste, Compass, History, Link2, MoreHorizontal, Plus, Settings2, Trash2, UsersRound, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Field, Input, PinInput, Textarea, CharacterCount } from '@palside/ui/field';
import { Sheet } from '@palside/ui/sheet';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { prepareImage } from '@palside/ui/lib/image';
import { Brand } from '../ui/brand';
import { EmptyState } from '../ui/empty-state';
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

const STAGE_NEIGHBOUR = 116;
const STAGE_STEP = 84;
const errorCode = (failure: unknown) => typeof failure === 'object' && failure && 'code' in failure ? String((failure as { code?: unknown }).code) : '';
const passwordErrors = new Set(['INVITE_PASSWORD_WRONG', 'INVITE_PASSWORD_REQUIRED', 'INVITE_PASSWORD_LOCKED']);
const terminalJoinErrors = new Set(['INVITE_INVALID', 'INVITE_EXPIRED', 'TEAM_NOT_FOUND', 'TEAM_CLOSED', 'TEAM_FULL', 'TEAM_LIMIT', 'JOIN_BLOCKED', 'JOIN_CANCELLED', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_RESTRICTED', 'ACCOUNT_BANNED', 'LOGIN_REQUIRED', 'DEVICE_REVOKED', 'INVALID_INPUT', 'ORIGIN_DENIED', 'OPERATION_ID_REQUIRED', 'OPERATION_CONFLICT', 'OPERATION_ENDED', 'OPERATION_EXPIRED']);
type EntryPrompt = NonNullable<PalsideController['joinPrompt']> & { pendingInvite?: string };
/** Teams the user left, was removed from or saw dissolved; their read-only history is still open. */
export const formerTeams = (c: PalsideController) => c.teams.filter(team => team.readonly && !team.joined);

/** 首页 with no team, and 添加小队 with some: the avatar stage and the name are the page; the intro stays folded and the two other ways in sit below 创建. */
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
  const [preset, setPreset] = useState(() => Math.floor(Math.random() * defaultTeamAvatarOptions.length));
  const [upload, setUpload] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [introOpen, setIntroOpen] = useState(false);
  const intro = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useTextState();
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const avatarVersion = useRef(0);
  useEffect(() => () => { avatarVersion.current++; }, []);
  const joined = c.teams.filter(team => team.joined);
  const limit = joined.filter(team => team.owner === c.data.self).length >= TEAM_OWNED_LIMIT ? t('extension.start.ownedLimit', { count: TEAM_OWNED_LIMIT }) : joined.length >= TEAM_JOINED_LIMIT ? t('extension.start.joinedLimit', { count: TEAM_JOINED_LIMIT }) : '';
  const tooLong = characterLength(name.trim()) > TEAM_NAME_LENGTH;
  const invites = c.live.state.rooms.invites.length;
  const former = formerTeams(c).length;
  const introLength = characterLength(description);
  const src = upload || defaultTeamAvatarOptions[preset]!.src;
  const ready = !busy && !processing && !limit && Boolean(name.trim()) && !tooLong && characterLength(description.trim()) <= TEAM_DESCRIPTION_LENGTH;
  function selectPreset(next: number) {
    avatarVersion.current++; setProcessing(false); setUpload(''); setPreset(next);
  }
  async function chooseUpload(chosen?: File) {
    if (!chosen) return;
    const version = ++avatarVersion.current;
    setProcessing(true); setError('');
    try {
      const { blob } = await prepareImage(chosen, { maxBytes: AVATAR_BYTES, maxDimension: 256 });
      if (version !== avatarVersion.current) return;
      const image = await readImage(blob);
      if (version === avatarVersion.current) setUpload(image);
    } catch (failure) { if (version === avatarVersion.current) setError(failureText(failure, 'extension.copy.imageReadFailed')); }
    finally { if (version === avatarVersion.current) setProcessing(false); }
  }
  async function create() {
    if (!ready) return;
    setBusy(true); setError('');
    try { await c.createTeam(name, description, src); }
    catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  return <div className={s.body}>
    <form className={s.form} aria-busy={busy || undefined} onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className={s.identity}>
        <AvatarStage selected={preset} upload={upload} disabled={busy} onSelect={selectPreset} onUpload={() => file.current?.click()} />
        <input ref={file} type="file" hidden accept={IMAGE_MIME_TYPES.join(',')} tabIndex={-1} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; void chooseUpload(chosen); }} />
        <div className={s.fields}>
          <Input id={`${id}-name`} className={s.name} aria-label={t('extension.copy.teamName')} aria-invalid={tooLong || Boolean(limit) || undefined} placeholder={t('extension.copy.teamName')} value={name} disabled={busy} autoComplete="off" autoFocus onChange={event => { setName(event.target.value); setError(''); }} />
          {(limit || tooLong || error) && <p className={s.error} role="alert">{limit || (tooLong ? t('extension.copy.teamNameLimit') : error)}</p>}
          <div className={s.more} data-open={introOpen || undefined} inert={!introOpen}>
            <div><Field id={`${id}-description`} label={t('extension.copy.teamIntro')} className={s.bare} counter={introLength >= TEAM_DESCRIPTION_LENGTH * .8 ? <CharacterCount value={description} limit={TEAM_DESCRIPTION_LENGTH} label={t('extension.dynamic.characterCount', { count: introLength, maximum: TEAM_DESCRIPTION_LENGTH, excess: Math.max(0, introLength - TEAM_DESCRIPTION_LENGTH) })} /> : undefined}>{props => <Textarea {...props} ref={intro} className={s.intro} disabled={busy} value={description} placeholder={t('extension.copy.teamIntro')} onChange={event => setDescription(event.target.value)} />}</Field></div>
          </div>
          {!introOpen && <button type="button" className={s.addIntro} disabled={busy} onClick={() => { setIntroOpen(true); requestAnimationFrame(() => intro.current?.focus()); }}><Plus size={14} aria-hidden="true" />{t('extension.start.addIntro')}</button>}
        </div>
      </div>
      <Button type="submit" variant="primary" size="lg" loading={busy} loadingLabel={t('extension.start.creating')} disabled={!ready}>{t('extension.copy.createTeam')}</Button>
    </form>
    <div className={s.ways}>
      <Button size="lg" leadingIcon={<Link2 size={16} />} disabled={busy} onClick={() => c.go('join')}>{t('extension.copy.joinInvitation')}</Button>
      <Button size="lg" leadingIcon={<Compass size={16} />} disabled={busy} onClick={() => c.go('lobby')}>{t('extension.copy.visitLobby')}{invites > 0 && <span className={s.badge} aria-label={t('extension.invite.pending', { count: invites })}><Count value={invites} /></span>}</Button>
    </div>
    {former > 0 && <button type="button" className={s.former} disabled={busy} onClick={() => c.go('former-teams')}><History size={16} aria-hidden="true" /><span>{t('extension.start.formerTeams')}</span><small><Count value={former} /></small><ChevronRight size={15} aria-hidden="true" /></button>}
  </div>;
}

/** Every preset avatar on one looping stage: drag, arrow keys or a neighbour change it; the centre one opens the file picker. */
function AvatarStage({ selected, upload, disabled, onSelect, onUpload }: { selected: number; upload: string; disabled: boolean; onSelect: (index: number) => void; onUpload: () => void }) {
  const t = useTranslations();
  const count = defaultTeamAvatarOptions.length;
  const root = useRef<HTMLDivElement>(null);
  const position = useRef(selected);
  const drag = useRef<{ x: number; from: number; moved: boolean } | undefined>(undefined);
  const wheel = useRef(0);
  const offset = (index: number) => { const distance = (((index - position.current) % count) + count) % count; return distance > count / 2 ? distance - count : distance; };
  const layout = () => root.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((tile, index) => {
    const away = offset(index), near = Math.abs(away), side = Math.sign(away);
    const x = side * (near <= 1 ? STAGE_NEIGHBOUR * near : STAGE_NEIGHBOUR + STAGE_STEP * (near - 1));
    const scale = near <= 1 ? 1 - .42 * near : Math.max(.58 - .12 * (near - 1), .2);
    tile.style.transform = `translateX(${x}px) scale(${scale})`;
    tile.style.opacity = String(near <= 1 ? 1 - .42 * near : Math.max(.58 - .3 * (near - 1), 0));
    tile.style.zIndex = String(20 - Math.round(near * 2));
    tile.style.visibility = near > 3.2 ? 'hidden' : 'visible';
  });
  useLayoutEffect(layout);
  const go = (next: number) => { position.current = Math.round(next); layout(); onSelect(((position.current % count) + count) % count); };
  return <div ref={root} className={s.stage} tabIndex={disabled ? -1 : 0} role="group" aria-label={t('extension.copy.teamAvatarCount', { count })}
    onKeyDown={event => { if (disabled) return; if (event.key === 'ArrowLeft') { event.preventDefault(); go(position.current - 1); } if (event.key === 'ArrowRight') { event.preventDefault(); go(position.current + 1); } }}
    onPointerDown={event => { if (!disabled && event.button === 0 && !(event.target as Element).closest('[data-camera]')) drag.current = { x: event.clientX, from: position.current, moved: false }; }}
    onPointerMove={event => { const current = drag.current; if (!current) return; const moved = event.clientX - current.x; if (!current.moved && Math.abs(moved) > 4) { current.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragging = ''; } if (current.moved) { position.current = current.from - moved / STAGE_NEIGHBOUR; layout(); } }}
    onPointerUp={event => { const current = drag.current; drag.current = undefined; delete event.currentTarget.dataset.dragging; if (current?.moved) go(position.current); }}
    onPointerCancel={event => { const current = drag.current; drag.current = undefined; delete event.currentTarget.dataset.dragging; if (current?.moved) go(position.current); }}
    onWheel={event => { if (disabled || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return; wheel.current += event.deltaX; if (Math.abs(wheel.current) > 50) { go(position.current + Math.sign(wheel.current)); wheel.current = 0; } }}>
    {defaultTeamAvatarOptions.map((option, index) => <button type="button" key={option.id} data-tile="" className={s.tile} tabIndex={-1} aria-label={t(option.label)} aria-pressed={index === selected} disabled={disabled} onClick={() => { const away = offset(index); if (Math.abs(away) < .5) onUpload(); else go(position.current + away); }}><img src={index === selected && upload ? upload : option.src} alt="" draggable={false} /></button>)}
    <button type="button" data-camera="" className={s.camera} aria-label={t('extension.copy.uploadAvatar')} disabled={disabled} onClick={onUpload}><Camera size={14} aria-hidden="true" /></button>
  </div>;
}

/** 通过邀请加入: one field for the link. A readable invitation opens the join sheet; an unreadable one is a field error and nothing else. */
export function JoinPage({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const pending = c.data.pendingInvite ?? '';
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
      const result = await c.previewInvite(url);
      if (!isActive() || !result) return;
      if (result.alreadyMember) { const joined = await c.live.command('join', { invite: result.invite }); if (isActive()) c.chooseTeam(joined.teamId); return; }
      open({ invite: result.invite, team: result.team, lockedUntil: result.lockedUntil, passwordRequired: result.passwordRequired });
    } catch (failure) {
      if (!isActive()) return;
      if (errorCode(failure) === 'JOIN_BLOCKED') { open({ invite: '', blocked: true }); return; }
      setError(failureText(failure, 'extension.copy.invalidInvitation'));
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
    if (prompt?.pendingInvite) void c.run('dismiss-invite', { url: prompt.pendingInvite });
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
      const joined = await c.live.command('join', { invite: prompt.invite, ...(needsPassword ? { password: value } : {}) });
      if (!isActive()) return;
      c.setJoinPrompt(undefined);
      if (joined) { c.chooseTeam(joined.teamId); c.setNotice(uiMessage('extension.invite.joined', { name: team.name })); }
    } catch (failure) {
      if (!isActive()) return;
      const code = errorCode(failure);
      const message = failureText(failure);
      if (passwordErrors.has(code)) {
        setNeedsPassword(true); setValue(''); setFieldError(message);
        if (code === 'INVITE_PASSWORD_REQUIRED') {
          try {
            const refreshed = await c.previewInvite(new URL(`/invite/${prompt.invite}`, c.live.state.config.websiteUrl).href);
            if (!isActive()) return;
            if (refreshed) { setPreview(refreshed); setLockedUntil(refreshed.lockedUntil ?? 0); setNeedsPassword(refreshed.passwordRequired); }
          } catch (refreshFailure) {
            if (!isActive()) return;
            setNotice(failureText(refreshFailure));
            setEnded(terminalJoinErrors.has(errorCode(refreshFailure)));
          }
        }
        if (code === 'INVITE_PASSWORD_LOCKED') { const details = failure as { lockedUntil?: number; retryAfterMs?: number }; setLockedUntil(details.lockedUntil ?? Date.now() + (details.retryAfterMs ?? MINUTE_MS)); }
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
  if (!teams.length) return <EmptyState icon={<History />} title={t('extension.start.noFormerTeams')} />;
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
