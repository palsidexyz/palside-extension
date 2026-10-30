'use client';
import { LevelChip } from './team-level';
import { Chip } from '../ui/chip';
import { APPLICATION_NOTE_LENGTH, TEAM_MEMBER_LIMIT } from '@palside/shared/contracts/limits';

import { deadlineTime, localeOrEnglish, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { Count, CountText } from '../ui/motion-details';
import { useState } from 'react';
import { ChevronRight, Check, Clock3, Flag, Megaphone, Search, Users } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Tooltip } from '@palside/ui/tooltip';
import { Field, Input, Textarea, CharacterCount } from '@palside/ui/field';
import { Switch } from '@palside/ui/switch';
import { SettingControl, settingRows as rows } from '../settings/setting-rows';
import { PersonAvatar } from '../ui/primitives';
import { Tabs } from '../ui/sub-rows';
import type { PalsideController } from '../app/use-palside';
import { characterLength } from '../../../domain/chat/model';
import { type Team } from '../../../domain/teams/model';
import { isRecruiting, publicTeams } from '../../../domain/teams/lobby-values';
import { TeamAvatar } from './team-avatar';
import { ReceivedInvites } from './invites';
import type { DiscoveryActions } from './use-discovery';
import s from './lobby.module.css';
import base from '../app/palside.module.css';


export function Lobby({ c }: { c: PalsideController & DiscoveryActions }) {
  const t = useTranslations();
  const { query, sort, tab } = c.lobbyFilters;
  const setQuery = (query: string) => c.updateLobbyFilters({ query });
  const setSort = (sort: 'heat' | 'latest') => c.updateLobbyFilters({ sort });
  const setTab = (tab: 'recruiting' | 'applications') => c.updateLobbyFilters({ tab });
  const pendingIds = new Set(c.requests.filter(request => request.personId === c.data.self).map(request => request.teamId));
  const pendingFor = (team: Team) => pendingIds.has(team.id) || Boolean(team.requested);
  const applications = c.discoveryTeams.filter(team => c.live ? Boolean(team.applicationStatus && (team.applicationExpiresAt ?? 0) > c.now) : pendingFor(team));
  const teams = tab === 'applications' ? applications : publicTeams(c.discoveryTeams, query, c.now).sort((a, b) => sort === 'heat' ? (a.activity?.rank ?? Number.MAX_SAFE_INTEGER) - (b.activity?.rank ?? Number.MAX_SAFE_INTEGER) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0) : (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const open = (team: Team) => { c.setRecruitmentId(team.id); c.go('recruitment'); };
  const state = (team: Team) => pendingFor(team) ? 'pending' : team.joined ? 'joined' : team.applicationStatus === 'rejected' ? 'rejected' : undefined;
  const stateLabel = { pending: t('extension.copy.pendingApproval'), joined: t('extension.copy.joined'), rejected: t('extension.copy.applicationRejected') };
  return <>
    <ReceivedInvites c={c} />
    <div className={s.lobbyTabs}><Tabs id="lobby" label={t('extension.copy.visitLobby')} value={tab} onChange={setTab} tabs={[
      ['recruiting', t('extension.copy.recruitingTab')],
      ['applications', <>{t('extension.copy.myApplications')}{applications.length > 0 && <span className={s.tabCount}><Count value={applications.length} /></span>}</>],
    ]} /></div>
    <div id="lobby-panel" role="tabpanel" aria-labelledby={`lobby-tab-${tab}`} className={s.lobbyPanel}>
    {tab === 'recruiting' && <Input type="search" aria-label={t('extension.copy.searchTeams')} leadingIcon={<Search size={16} />} placeholder={t('extension.copy.searchTeams')} value={query} onChange={event => setQuery(event.target.value)} />}
    {tab === 'recruiting' && <div className={s.sortRow}><span>{teams.length > 0 && <CountText text={t('extension.start.teamCount', { count: teams.length })} value={teams.length} />}</span><select aria-label={t('extension.wallet.byHeat')} value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="heat">{t('extension.wallet.byHeat')}</option><option value="latest">{t('extension.wallet.latest')}</option></select></div>}
    {tab === 'applications' ? applications.length > 0 && <div className={s.applications}>{applications.map(team => {
      const status = state(team);
      return <button type="button" key={team.id} className={s.applicationRow} aria-label={t('extension.dynamic.viewTeam', { name: team.name ?? '' })} onClick={() => open(team)}>
        <TeamAvatar team={team} size="sm" /><span className={s.applicationName}>{team.name}</span>
        {status && <span className={s.statusChip} data-state={status}>{stateLabel[status]}</span>}
        <ChevronRight size={15} aria-hidden="true" />
      </button>;
    })}</div>
    : <div className={s.list}>{teams.map(team => {
      const status = state(team);
      const owner = c.people.find(person => person.id === team.owner);
      const ownerName = owner?.name || team.ownerName || t('common.member');
      return <button type="button" key={team.id} className={s.card} aria-label={t('extension.dynamic.viewTeam', { name: (team.name) ?? '' })} onClick={() => open(team)}>
        <span className={s.cardHeading}><TeamAvatar team={team} /><span className={s.cardTitle}><strong>{team.name}</strong><span className={s.cardOwner}><PersonAvatar person={{ id: team.owner, name: ownerName, avatar: owner?.avatar || team.ownerAvatar, color: owner?.color ?? '#e9edf0' }} size="xs" /><span>{ownerName}</span><span className={s.memberCount} role="img" aria-label={t('extension.dynamic.memberCapacity', { count: ((team.memberCount ?? team.memberIds.length)) ?? '' })}><Users size={13} /><Count value={team.memberCount ?? team.memberIds.length} /><span>/{TEAM_MEMBER_LIMIT}</span></span></span></span>{status ? <span className={s.statusChip} data-state={status}>{stateLabel[status]}</span> : <span className={s.cardArrow}><ChevronRight size={17} /></span>}</span>
        {team.description && <span className={s.description}>{team.description}</span>}
        <span className={s.badges}><LevelChip level={team.activity?.level ?? 1} />{sort === 'heat' && team.activity?.rank && <Chip>#<Count value={team.activity.rank} /></Chip>}</span>
      </button>;
    })}</div>}
    {c.lobbyError && <div className={base.empty}><p role="alert">{c.lobbyError}</p><Button loadingLabel={t('common.working')} size="sm" loading={c.lobbyLoading} onClick={() => void c.refreshLobby()}>{t('common.retry')}</Button></div>}
    {!teams.length && !c.lobbyError && c.lobbyLoading && <div className={base.empty}><p role="status">{t('extension.copy.loadingTeamsEllipsis')}</p></div>}
    {!teams.length && !c.lobbyError && !c.lobbyLoading && <div className={base.empty}><p>{tab === 'applications' ? t('extension.copy.noApplications') : query.trim() ? t('extension.copy.noTeamsFound') : t('extension.copy.noRecruitment')}</p>{tab === 'recruiting' && query.trim() && <Button onClick={() => setQuery('')}>{t('extension.copy.clearFilter')}</Button>}</div>}
    </div>
  </>;
}

export function Recruitment({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const locale = useLocale();
  const [note, setNote] = useState('');
  const pending = Boolean(c.discoveryTeams.find(t => t.id === c.recruitmentId)?.requested) || c.requests.some(request => request.teamId === c.recruitmentId && request.personId === c.data.self);
  const team = c.discoveryTeams.find(item => item.id === c.recruitmentId && (isRecruiting(item, c.now) || pending || item.joined || Boolean(item.applicationStatus && (item.applicationExpiresAt ?? 0) > c.now)));
  if (!team && c.lobbyLoading) return <div className={base.empty} data-fill><p role="status">{t('extension.copy.loadingTeamsEllipsis')}</p></div>;
  if (!team && c.lobbyError) return <div className={base.empty} data-fill><p role="alert">{c.lobbyError}</p><Button onClick={() => void c.refreshLobby()}>{t('common.retry')}</Button></div>;
  if (!team) return <div className={base.empty} data-fill><Clock3 /><p>{t('extension.copy.teamUnavailable')}</p><Button onClick={() => c.go('lobby')}>{t('extension.copy.backLobby')}</Button></div>;
  const owner = c.people.find(person => person.id === team.owner);
  const ownerName = owner?.name || team.ownerName || t('common.member');
  const count = team.memberCount ?? team.memberIds.length;
  const full = count >= TEAM_MEMBER_LIMIT;
  const retryLater = (team.applicationRetryAt ?? 0) > c.now;
  const tooLong = characterLength(note) > APPLICATION_NOTE_LENGTH;
  return <div className={s.detail}>
    <section className={s.hero} aria-labelledby="recruitment-name">
      <div className={s.heroTop}>
        <TeamAvatar team={team} size="lg" />
        {c.live && <Tooltip content={t('extension.copy.reportTeam')}><IconButton label={t('extension.copy.reportTeam')} size="sm" variant="quiet" className={s.heroReport} onClick={() => { c.setReportTarget({ kind: 'team', targetId: team.id, team, preview: `${team.name}\n${team.description}` }); c.go('report'); }}><Flag size={15} /></IconButton></Tooltip>}
      </div>
      <h2 id="recruitment-name">{team.name}</h2>
      <p className={s.heroMeta}><span className={s.memberCount} role="img" aria-label={t('extension.dynamic.memberCapacity', { count })}><Users size={14} /><Count value={count} /><span>/{TEAM_MEMBER_LIMIT}</span></span>{isRecruiting(team, c.now) && team.recruitmentExpiresAt && <span>{t('extension.dynamic.recruitmentUntil', { date: deadlineTime(team.recruitmentExpiresAt, localeOrEnglish(locale), c.now) })}</span>}</p>
      {team.description && <p className={s.detailDescription}>{team.description}</p>}
      <div className={s.detailOwner}><span>{t('extension.copy.owner')}</span><span className={s.ownerIdentity}><PersonAvatar person={{ id: team.owner, name: ownerName, avatar: owner?.avatar || team.ownerAvatar, color: owner?.color ?? '#e9edf0' }} size="sm" /><strong>{ownerName}</strong></span></div>
    </section>
    {team.joined ? <Button variant="primary" size="lg" onClick={() => c.chooseTeam(team.id)}>{t('extension.copy.openTeam')}</Button>
      : pending ? <div className={s.application}><p><Check size={16} />{t('extension.copy.applicationSent')}</p><Button onClick={() => c.cancelApplication(team.id)}>{t('extension.copy.cancelApplication')}</Button></div>
      : <form className={s.applyForm} onSubmit={event => { event.preventDefault(); c.requestTeam(team.id, note); }}>
        {team.applicationStatus === 'rejected' && <p className={s.applyNotice} role="status">{retryLater ? t('extension.dynamic.applicationRejectedUntil', { date: deadlineTime(team.applicationRetryAt!, localeOrEnglish(locale), c.now) }) : t('extension.copy.applicationRejected')}</p>}
        <Field id="application-note" label={t('extension.copy.applicationNote')} optional={t('extension.copy.optional')} counter={<CharacterCount label={t('extension.dynamic.characterCount', { count: characterLength(note), maximum: APPLICATION_NOTE_LENGTH, excess: Math.max(0, characterLength(note) - APPLICATION_NOTE_LENGTH) })} value={note} limit={APPLICATION_NOTE_LENGTH} />}>{props => <Textarea {...props} aria-invalid={tooLong} value={note} onChange={event => setNote(event.target.value)} placeholder={t('extension.copy.introduceYourself')} />}</Field>
        <Button type="submit" variant="primary" size="lg" disabled={full || tooLong || !isRecruiting(team, c.now) || retryLater}>{full ? t('extension.copy.teamFull') : !isRecruiting(team, c.now) ? t('extension.copy.recruitmentEnded') : retryLater ? t('extension.copy.applyLater') : t('extension.copy.apply')}</Button>
      </form>}
  </div>;
}

export function RecruitmentSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const locale = useLocale();
  const active = isRecruiting(c.team, c.now);
  const expired = !active && Boolean(c.team.recruitmentExpiresAt);
  // Ending is immediate; a first listing is confirmed because it makes the team public; an ended one is listed again directly.
  return <SettingControl icon={<Megaphone size={16} />}><Switch className={rows.switch} label={t('extension.copy.lobbyRecruitment')} checked={active}
    status={active ? t('extension.dynamic.recruitmentUntil', { date: deadlineTime(c.team.recruitmentExpiresAt!, localeOrEnglish(locale), c.now) }) : expired ? t('extension.copy.ended') : undefined}
    onChange={event => {
      if (!event.target.checked) { c.setRecruitment(false); return; }
      if (expired) { c.setRecruitment(true); return; }
      c.setConfirmation({ title: uiMessage('extension.copy.publishRecruitmentTitle'), description: uiMessage('extension.copy.publishRecruitmentDescription'), action: uiMessage('extension.copy.publishRecruitment'), confirm: () => c.setRecruitment(true) });
    }} /></SettingControl>;
}
