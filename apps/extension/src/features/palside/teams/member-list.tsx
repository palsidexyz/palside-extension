'use client';
import { tagKey, tagLabel } from '../../../domain/account/profile-tags';
import { localeOrEnglish, pastTime, message as uiMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { AtSign, Flag, Globe2, UserRoundMinus, ArrowRightLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import styles from './member-list.module.css';
import { CountText } from '../ui/motion-details';
import { PersonAvatar, Row } from '../ui/primitives';
import { personFor, type Person } from '../../../domain/account/model';
import { viewingKey } from '../../../domain/assets/model';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import edge from '../feedback/edge-states.module.css';

export function Members({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const owner = c.team.owner === c.data.self;
  const filter = c.data.views.find(view => viewingKey(view) === c.memberFilter);
  const members = c.team.memberIds.map(id => personFor(c.people, id, t('common.member'))).filter(person => {
    if (c.selectingOwner) return person.id !== c.data.self;
    if (!c.memberFilter) return true;
    const view = c.data.views.find(view => view.id === person.viewing);
    return Boolean(view && viewingKey(view) === c.memberFilter);
  });
  function transfer(person: Person) {
    c.setConfirmation({ title: uiMessage('extension.dynamic.transferOffer', { name: (person.name) ?? '' }), description: uiMessage('extension.copy.transferAcceptance'), confirm: async () => {
      if (c.live) await c.live.command('transfer', { teamId: c.current, action: 'request', accountId: person.id });
      c.go('team');
      if (!c.live) c.setNotice(uiMessage('extension.dynamic.transferDemo', { name: (person.name) ?? '' }));
    } });
  }
  return <>
    {c.memberFilter && !c.selectingOwner && <div className={s.listCaption}><span><CountText last text={t('extension.dynamic.viewingMembersCaption', { name: filter?.name ?? t('extension.copy.thisPage'), count: members.length })} value={members.length} /></span></div>}
    {members.length > 0 && <div className={s.group}>{members.map(person => {
      const self = person.id === c.data.self;
      const known = c.people.some(item => item.id === person.id);
      const viewId = person.viewing;
      const view = c.data.views.find(item => item.id === viewId);
      const canManage = owner && c.canWrite && !self;
      const canMention = !self && c.canWrite;
      const hasActions = (!self && c.live) || canMention || view || canManage;
      if (c.selectingOwner) return <button type="button" className={edge.memberChoice} key={person.id} onClick={() => transfer(person)}><PersonAvatar person={person} /><span>{person.name}</span><ChevronRight size={16} /></button>;
      return <div className={s.memberRow} key={person.id}>
        <PersonAvatar person={person} onClick={known ? () => c.setPersonId(person.id) : undefined} />
        <div><span className={styles.memberTitle}>{known ? <button type="button" className={s.memberName} onClick={() => c.setPersonId(person.id)}>{person.name}</button> : <strong>{person.name}</strong>}{person.id === c.team.owner && <small className={styles.memberRole}>{t('extension.copy.owner')}</small>}</span>{Boolean(person.bio || person.tags?.length) && <span className={styles.memberBio}>{person.tags?.map(tag => <b key={tagKey(tag)} className={styles.memberTag}>{tagLabel(tag, t)}</b>)}{person.bio && <span>{person.bio}</span>}</span>}</div>
        {hasActions && <Menu boundarySelector="[data-palside-app]" align="end">
          <MenuTrigger asChild><IconButton label={t('extension.dynamic.memberActions', { name: (person.name) ?? '' })} size="sm" variant="quiet"><MoreHorizontal size={16} /></IconButton></MenuTrigger>
          <MenuContent aria-label={t('extension.dynamic.memberActions', { name: (person.name) ?? '' })} className={styles.menu}>
          {!self && c.live && <MenuItem icon={<Flag size={16} />} onClick={() => { c.setReportTarget({ kind: 'account', targetId: person.id, preview: `${person.name} #${person.id}` }); c.go('report'); }}>{t('extension.copy.reportAccount')}</MenuItem>}
          {canMention && <MenuItem icon={<AtSign size={16} />} onClick={() => { c.mention(person.id); c.go('chat'); }}>@ {person.name}</MenuItem>}
          {view && <MenuItem icon={<Globe2 size={16} />} onClick={() => { c.selectAsset(view.id); }}>{t('extension.copy.openViewing')}</MenuItem>}
          {canManage && <><MenuItem icon={<UserRoundMinus size={16} />} onClick={() => { c.setConfirmation({ title: uiMessage('extension.dynamic.removeMember', { name: (person.name) ?? '' }), description: uiMessage('extension.copy.removeMemberDescription'), action: uiMessage('extension.copy.removeMember'), danger: true, confirm: async () => { if (c.live) await c.live.command('remove', { teamId: c.current, accountId: person.id }); else c.setTeams(old => old.map(team => team.id === c.current ? { ...team, memberIds: team.memberIds.filter(id => id !== person.id) } : team)); } }); }}>{t('extension.copy.removeMember')}</MenuItem><MenuItem icon={<ArrowRightLeft size={16} />} onClick={() => { transfer(person); }}>{t('extension.copy.transferTeam')}</MenuItem></>}
        </MenuContent></Menu>}
      </div>;
    })}</div>}
    {!members.length && <p className={edge.quietState}>{c.selectingOwner ? t('extension.copy.noEligibleOwner') : c.memberFilter ? t('extension.copy.nobodyViewing') : t('extension.copy.noMembers')}</p>}
    {!c.selectingOwner && owner && c.canWrite && Boolean(c.live?.state.remoteTeams.find(team => team.id === c.current)?.bans.length) && <div className={s.group}>{c.live?.state.remoteTeams.find(team => team.id === c.current)?.bans.map(person => <Row key={person.accountId} detail={t('extension.copy.allowRejoin')} onClick={() => void c.run('unban', { teamId: c.current, accountId: person.accountId })}>{person.deleted ? t('common.deletedMember') : person.nickname || t('extension.copy.removedMembers')}</Row>)}</div>}
  </>;
}

export function Requests({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const locale = useLocale();
  const requests = c.requests.filter(request => request.teamId === c.current);
  return <>{requests.map(request => {
    const person = personFor(c.people, request.personId, t('common.member'));
    const known = c.people.some(item => item.id === person.id);
    return <div className={s.requestRow} key={request.id}><PersonAvatar person={person} onClick={known ? () => c.setPersonId(person.id) : undefined} /><div><strong>{person.name}</strong>{request.text && <p>{request.text}</p>}{request.createdAt && <small>{pastTime(request.createdAt, localeOrEnglish(locale), c.now)}</small>}<div className={s.inlineActions}><Button size="sm" onClick={() => c.approve(request.id, false)}>{t('extension.copy.reject')}</Button><Button size="sm" variant="primary" onClick={() => c.approve(request.id, true)}>{t('extension.copy.approve')}</Button></div></div></div>;
  })}{!requests.length && <p className={edge.quietState}>{t('extension.copy.noRequests')}</p>}</>;
}
