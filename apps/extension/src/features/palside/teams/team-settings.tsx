'use client';
import { LevelChip } from './team-level';
import type { TeamRetentionDays } from '@palside/shared/contracts/team-model';

import { errorMessage, message as uiMessage } from '@palside/i18n';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ArrowRightLeft, Bell, ChevronRight, Clock, LogOut, Trash2, Users, UserPlus } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { Switch } from '@palside/ui/switch';
import { Count } from '../ui/motion-details';
import { TeamAvatar } from './team-avatar';
import { AvatarEditor } from '../account/avatar-editor';
import { InvitationPanel } from './invitation-panel';
import { defaultRetentionDays, retentionOptions, retentionPeriod } from './retention';
import { useText } from '../ui/text';
import { RecruitmentSettings } from './lobby';
import { SettingControl, SettingCount, SettingDanger, SettingGroup, SettingItem, ValueSelect, settingRows as r } from '../settings/setting-rows';
import type { PalsideController } from '../app/use-palside';
import { whenWalletOpen } from '../wallet/closed';
import s from './team-settings.module.css';

export function TeamSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const text = useText();
  const owner = c.team.owner === c.data.self && c.canWrite;
  const requests = c.requests.filter(request => request.teamId === c.current).length;
  const remote = c.live?.state.remoteTeams.find(team => team.id === c.current);
  const transfer = remote?.transfer;
  const receiving = transfer?.toId === c.data.self;
  const retention = c.team.retentionDays ?? defaultRetentionDays;
  const retentionPending = useRef(false);
  const [retentionBusy, setRetentionBusy] = useState(false);
  function changeRetention(days: number) {
    if (days === retention || retentionPending.current) return;
    const apply = async () => {
      if (retentionPending.current) return;
      retentionPending.current = true;
      setRetentionBusy(true);
      try {
        if (c.live) await c.live.command('retention', { teamId: c.current, retentionDays: days as TeamRetentionDays });
        else c.setTeams(old => old.map(team => team.id === c.current ? { ...team, retentionDays: days as TeamRetentionDays } : team));
      } finally {
        retentionPending.current = false;
        setRetentionBusy(false);
      }
    };
    if (days < retention) c.setConfirmation({ title: uiMessage('extension.copy.retentionShorterTitle'), description: uiMessage('extension.dynamic.retentionShorterDescription', { period: text(retentionPeriod(days)) }), confirm: apply });
    else void apply().catch(error => c.setConfirmation({ title: uiMessage('common.error'), description: error instanceof Error ? errorMessage(error) : uiMessage('common.error'), action: uiMessage('common.retry'), confirm: apply }));
  }
  const members = () => { c.setMemberFilter(undefined); c.go('members'); };
  const dissolve = () => c.setConfirmation({ title: uiMessage('extension.copy.dissolveTitle'), description: uiMessage('extension.copy.dissolveDescription'), action: uiMessage('extension.copy.dissolveTeam'), danger: true, confirm: () => { const { current, team } = c; const done = () => c.exitTeam(current, uiMessage('extension.start.dissolvedNotice', { name: team.name })); if (c.live) return c.live.command('dissolve', { teamId: current }).then(done); c.setTeams(old => old.map(item => item.id === current ? { ...item, joined: false, readonly: true, readonlyReason: 'dissolved', published: false } : item)); done(); } });
  const identity = <span className={s.identityText}><strong>{c.team.name}</strong>{c.team.description && <span>{c.team.description}</span>}</span>;

  return <div className={s.page}>
    {/* The owner's card is the way into 编辑资料; the avatar alone changes the picture. */}
    <header className={s.identity}>
      {owner ? <AvatarEditor c={c} team><TeamAvatar team={c.team} size="lg" /></AvatarEditor> : <TeamAvatar team={c.team} size="lg" />}
      {owner ? <button type="button" className={s.identityLink} aria-label={t('extension.copy.editTeam')} onClick={() => c.go('team-profile')}>{identity}<ChevronRight size={15} aria-hidden="true" /></button> : identity}
    </header>

    {transfer && c.canWrite && (owner || receiving) && <section className={s.transfer} aria-label={t('extension.copy.teamTransfer')}>
      <p>{receiving ? t('extension.copy.transferOffered') : t('extension.copy.transferWaiting')}</p>
      <div>{receiving ? <><Button size="sm" onClick={() => void c.run('transfer', { teamId: c.current, action: 'reject' })}>{t('extension.copy.reject')}</Button><Button size="sm" variant="primary" onClick={() => void c.run('transfer', { teamId: c.current, action: 'accept' })}>{t('extension.copy.acceptTransfer')}</Button></> : <Button size="sm" onClick={() => void c.run('transfer', { teamId: c.current, action: 'cancel' })}>{t('extension.copy.cancelTransfer')}</Button>}</div>
    </section>}

    <SettingGroup><SettingItem title={t('extension.wallet.level')} value={<LevelChip level={c.team.activity?.level ?? 1} />} onClick={() => c.go('team-level')} /></SettingGroup>
    <SettingGroup title={t('extension.copy.teamMembers')}>
      <SettingItem icon={<Users size={16} />} title={t('extension.copy.teamMembers')} value={<Count value={c.team.memberCount ?? c.team.memberIds.length} />} onClick={members} />
      {owner && <SettingItem icon={<UserPlus size={16} />} title={t('extension.copy.joinRequests')} value={requests > 0 ? <SettingCount><Count value={requests} /></SettingCount> : undefined} onClick={() => c.go('requests')} />}
    </SettingGroup>

    {owner && <SettingGroup title={t('extension.copy.joiningGroup')}>
      <InvitationPanel key={c.current} c={c} />
      <SettingItem title={t('extension.wallet.invitationPacket')} onClick={() => whenWalletOpen(c, () => c.go('wallet-invitation'))} />
      <RecruitmentSettings c={c} />
      {c.live && <SettingControl icon={<UserPlus size={16} />}><Switch className={r.switch} label={t('extension.invite.membersCan')} checked={Boolean(remote?.membersCanInvite)} onChange={event => void c.run('team-invite-permission', { teamId: c.current, on: event.currentTarget.checked })} /></SettingControl>}
    </SettingGroup>}

    <SettingGroup title={t('extension.copy.messagesGroup')}>
      {owner
        ? <SettingControl icon={<Clock size={16} />}><label className={r.label} htmlFor="team-retention">{t('extension.copy.messageRetention')}</label><ValueSelect id="team-retention" value={String(retention)} disabled={retentionBusy} onChange={event => changeRetention(Number(event.target.value))} options={retentionOptions.map(days => [String(days), text(retentionPeriod(days))] as const)} /></SettingControl>
        : <SettingItem icon={<Clock size={16} />} title={t('extension.copy.messageRetention')} end={text(retentionPeriod(retention))} />}
      <SettingControl icon={<Bell size={16} />}><Switch className={r.switch} label={t('extension.copy.muteMessages')} checked={c.team.muted} onChange={event => { if (c.live) void c.run('team-preferences', { teamId: c.current, muted: event.target.checked }); else c.setTeams(old => old.map(team => team.id === c.current ? { ...team, muted: event.target.checked } : team)); }} /></SettingControl>
    </SettingGroup>

    {owner && <SettingGroup><SettingItem icon={<ArrowRightLeft size={16} />} title={t('extension.copy.transferTeam')} disabled={Boolean(transfer)} onClick={() => { c.setMemberFilter(undefined); c.setSelectingOwner(true); c.go('members'); }} /></SettingGroup>}
    {c.canWrite && <SettingDanger icon={owner ? <Trash2 size={16} /> : <LogOut size={16} />} onClick={owner ? dissolve : c.leave}>{owner ? t('extension.copy.dissolveTeam') : t('extension.copy.leaveTeam')}</SettingDanger>}
  </div>;
}
