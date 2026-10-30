'use client';
import { errorMessage, message as uiMessage } from '@palside/i18n';

import type { ProfileTag } from '@palside/shared/contracts/profiles';
import { normalizeTagText, presetTagIds } from '@palside/shared/contracts/rules';
import { hasTag, tagKey, tagLabel } from '../../../domain/account/profile-tags';
import { Count } from '../ui/motion-details';
import { useTextState } from '../ui/text';

import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Button } from '@palside/ui/button';
import { Input, Textarea, Field } from '@palside/ui/field';
import { AvatarEditor } from './avatar-editor';
import { PersonAvatar } from '../ui/primitives';
import { TeamAvatar } from '../teams/team-avatar';
import { characterLength } from '../../../domain/chat/model';
import { BIO_LENGTH, TAG_COUNT, TAG_LENGTH, NICKNAME_LENGTH, TEAM_NAME_LENGTH, TEAM_DESCRIPTION_LENGTH } from '@palside/shared/contracts/limits';
import { Plus, X } from 'lucide-react';
import p from './profile-form.module.css';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import edge from '../feedback/edge-states.module.css';

export function ProfileForm({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const self = c.people.find(person => person.id === c.data.self);
  // What the form opened with: 保存 is available only once something differs from it.
  const [saved] = useState(() => ({ name: c.me.name, bio: c.live?.state.account?.bio ?? self?.bio ?? '', tags: c.live?.state.account?.tags ?? self?.tags ?? [] }));
  const [name, setName] = useState(saved.name);
  const [bio, setBio] = useState(saved.bio);
  const [tags, setTags] = useState<ProfileTag[]>(saved.tags);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useTextState();
  const invalid = characterLength(name.trim()) > NICKNAME_LENGTH ? t('extension.copy.nicknameLimit') : '';
  const bioLength = characterLength(bio.trim());
  const bioInvalid = bioLength > BIO_LENGTH ? t('extension.member.bioLimit', { count: BIO_LENGTH }) : '';
  const pending = normalizeTagText(tag);
  const tagInvalid = characterLength(pending) > TAG_LENGTH ? t('extension.member.tagLimit', { count: TAG_LENGTH }) : '';
  const full = tags.length >= TAG_COUNT;
  const presets = presetTagIds.filter(preset => !hasTag(tags, { preset }));
  const changed = name.trim() !== saved.name.trim() || bio.trim() !== saved.bio.trim() || Boolean(pending) || JSON.stringify(tags) !== JSON.stringify(saved.tags);
  function add(value: ProfileTag) {
    if (full) return false;
    const next = 'preset' in value ? value : { text: normalizeTagText(value.text) };
    if ('text' in next && (!next.text || characterLength(next.text) > TAG_LENGTH)) return false;
    if (!hasTag(tags, next)) setTags([...tags, next]);
    setError(''); return true;
  }
  return <form className={`${s.form} ${p.form}`} onSubmit={async event => {
    event.preventDefault(); if (busy || !changed || invalid || bioInvalid || tagInvalid || !name.trim()) return;
    // An unconfirmed tag still in the input is saved with the rest.
    const nextTags = pending && !full && !hasTag(tags, { text: pending }) ? [...tags, { text: pending }] : tags;
    setBusy(true); setError('');
    try {
      if (c.live) await c.live.command('profile', { name: name.trim(), bio: bio.trim(), tags: nextTags });
      else c.setPeople(old => old.map(person => person.id === c.data.self ? { ...person, name: name.trim(), bio: bio.trim(), tags: nextTags } : person));
      c.go('settings');
    } catch (failure) { setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.profileSaveFailed')); }
    finally { setBusy(false); }
  }}>
    <div className={p.avatar}><AvatarEditor c={c}><PersonAvatar person={{ ...c.me, presence: undefined }} size="xxl" /></AvatarEditor></div>
    <Field label={t('extension.copy.nickname')} error={invalid}>{props => <Input {...props} required placeholder={t('extension.copy.yourName')} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} />}</Field>
    <Field label={t('extension.member.bio')} optional={t('extension.copy.optional')} error={bioInvalid} counter={bioLength > BIO_LENGTH - 10 ? <><Count value={bioLength} />/{BIO_LENGTH}</> : undefined}>{props => <Input {...props} value={bio} disabled={busy} onChange={event => { setBio(event.target.value); setError(''); }} />}</Field>
    <Field label={t('extension.member.tags')} optional={t('extension.copy.optional')} error={tagInvalid}>{props => <div className={p.tags}>
      <div className={p.box} data-disabled={busy || undefined} data-invalid={Boolean(tagInvalid) || undefined}>
        {tags.map(item => <span key={tagKey(item)} className={p.tag}>{tagLabel(item, t)}<button type="button" disabled={busy} aria-label={t('extension.member.removeTag', { tag: tagLabel(item, t) })} onClick={() => setTags(tags.filter(other => other !== item))}><X size={12} /></button></span>)}
        {!full && <input {...props} className={p.input} placeholder={t('extension.member.tagInput')} value={tag} disabled={busy} enterKeyHint="done" onChange={event => { setTag(event.target.value); setError(''); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if ((event.key === 'Enter' || event.key === ',' || event.key === '，') && pending) { event.preventDefault(); if (add({ text: tag })) setTag(''); }
          else if (event.key === 'Backspace' && !tag && tags.length) setTags(tags.slice(0, -1));
        }} />}
        <span className={p.count} aria-label={`${tags.length}/${TAG_COUNT}`}><Count value={tags.length} />/{TAG_COUNT}</span>
      </div>
      {!full && presets.length > 0 && <div className={p.presets}>{presets.map(preset => <button key={preset} type="button" className={p.preset} disabled={busy} aria-label={t('extension.member.addTag', { tag: tagLabel({ preset }, t) })} onClick={() => add({ preset })}><Plus size={12} aria-hidden="true" />{tagLabel({ preset }, t)}</button>)}</div>}
    </div>}</Field>
    <div className={p.footer}>
      {error && <p className={edge.error} role="alert">{error}</p>}
      <Button loadingLabel={t('common.working')} type="submit" variant="primary" loading={busy} disabled={!changed || !name.trim() || Boolean(invalid || bioInvalid || tagInvalid)}>{t('extension.copy.save')}</Button>
    </div>
  </form>;
}


export function TeamProfileForm({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [name, setName] = useState(c.team.name);
  const [description, setDescription] = useState(c.team.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useTextState();
  const nameError = characterLength(name.trim()) > TEAM_NAME_LENGTH ? t('extension.copy.teamNameLimit') : '';
  const descriptionLength = characterLength(description.trim());
  const descriptionError = descriptionLength > TEAM_DESCRIPTION_LENGTH ? t('extension.copy.descriptionLimit') : '';
  const changed = name.trim() !== c.team.name || description.trim() !== c.team.description.trim();
  return <form className={`${s.form} ${p.form}`} onSubmit={async event => {
    event.preventDefault(); if (busy || !changed || nameError || descriptionError || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (c.live) await c.live.command('team', { teamId: c.current, name: name.trim(), description: description.trim() });
      else c.setTeams(old => old.map(team => team.id === c.current ? { ...team, name: name.trim(), description: description.trim() } : team));
      c.go('team');
    } catch (failure) { setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.teamSaveFailed')); }
    finally { setBusy(false); }
  }}>
    <div className={p.avatar}><AvatarEditor c={c} team><TeamAvatar team={c.team} size="xl" /></AvatarEditor></div>
    <Field label={t('extension.copy.teamName')} error={nameError}>{props => <Input {...props} required value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} />}</Field>
    <Field label={t('extension.copy.description')} error={descriptionError} counter={descriptionLength > TEAM_DESCRIPTION_LENGTH - 10 ? <><Count value={descriptionLength} />/{TEAM_DESCRIPTION_LENGTH}</> : undefined}>{props => <Textarea {...props} value={description} disabled={busy} onChange={event => { setDescription(event.target.value); setError(''); }} />}</Field>
    <div className={p.footer}>
      {error && <p className={edge.error} role="alert">{error}</p>}
      <Button loadingLabel={t('common.working')} type="submit" variant="primary" loading={busy} disabled={!changed || !name.trim() || Boolean(nameError || descriptionError)}>{t('extension.copy.save')}</Button>
    </div>
  </form>;
}
