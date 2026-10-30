'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Button } from '@palside/ui/button';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { Tooltip } from '@palside/ui/tooltip';
import type { TeamInvite } from '../../../runtime/rooms/contract-types';
import { CountText } from '../ui/motion-details';
import { PersonAvatar } from '../ui/primitives';
import { TeamAvatar } from './team-avatar';
import { PalsAmount } from '../wallet/amount';
import { roomPerson, useRoomRead } from '../rooms/rooms';
import type { PalsideController } from '../app/use-palside';
import d from '../rooms/danmaku.module.css';
import l from './lobby.module.css';

/** 添加小队 › 收到的邀请: teams someone met in 弹幕 invited you to. 加入 joins at once; 忽略 keeps that team from asking again for a week. */
export function ReceivedInvites({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const read = useRoomRead(c, 'invites');
  const invites = c.live?.state.rooms.invites ?? [];
  const feedback = read.status === 'error' ? <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback> : null;
  if (!invites.length) return feedback ?? (read.status === 'loading' ? <p role="status">{t('extension.copy.loading')}</p> : null);
  return <section className={l.received} aria-label={t('extension.invite.received')}>
    <h2 className={l.receivedTitle}>{t('extension.invite.received')}</h2>
    {feedback}
    <div className={d.invites}>{invites.map(invite => <InviteCard key={invite.id} c={c} invite={invite} />)}</div>
  </section>;
}

function InviteCard({ c, invite }: { c: PalsideController; invite: TeamInvite }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const from = roomPerson(c, invite.from, t('common.member'));
  const avatar = c.live?.state.rooms.avatars[`team:${invite.team.id}`];
  async function run(name: 'invite-accept' | 'invite-ignore') {
    if (busy) return;
    setBusy(true);
    try {
      const result = await c.run(name, { id: invite.id });
      if (name === 'invite-accept' && result && 'teamId' in result && result.teamId) { c.chooseTeam(result.teamId); c.setNotice(uiMessage('extension.invite.joined', { name: invite.team.name })); }
    } finally { setBusy(false); }
  }
  const days = Math.max(1, Math.ceil((invite.expiresAt - c.now) / 86_400_000));
  return <Tooltip content={t('extension.invite.expires', { count: days })}><div className={d.invite} tabIndex={0}>
    <TeamAvatar team={{ id: invite.team.id, name: invite.team.name, avatar }} size="sm" />
    <span><strong>{invite.team.name}</strong><small><PersonAvatar person={from} size="xs" /><CountText last text={t('extension.invite.from', { name: from.name, count: invite.team.memberCount })} value={invite.team.memberCount} /></small>{invite.invitationReward && invite.invitationReward.expiresAt > c.now && <small>{t('extension.wallet.invitationPacket')} · <PalsAmount value={invite.invitationReward.amount} /></small>}</span>
    <Button size="sm" disabled={busy} onClick={() => void run('invite-ignore')}>{t('extension.invite.ignore')}</Button>
    <Button size="sm" variant="surface" className={l.acceptInvite} disabled={busy} onClick={() => void run('invite-accept')}>{t('extension.invite.accept')}</Button>
  </div></Tooltip>;
}
