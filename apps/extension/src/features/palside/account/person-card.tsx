'use client';
import { tagKey, tagLabel } from '../../../domain/account/profile-tags';
import { askFollowGroup } from '../annotations/follow-group';
import { useCall } from '../annotations/call-key';
import { useTranslations } from 'use-intl';
import { useEffect, useRef } from 'react';
import { ArrowLeftRight, AtSign, ChevronRight, Footprints, PenLine, UserRoundPlus, X } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { useDialogBehavior } from '@palside/ui/dialog';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { AccountId } from './account-id';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import { openTransfer } from '../wallet/payment-sheet';
import card from './person-card.module.css';
import { TokenName,tokenWaiting } from '../assets/token-name';
import { liveView } from '../assets/token-data';
import { displayHost } from '../../../domain/assets/site-host';

const hostOf = (url: string) => displayHost(url) ?? '';

/** Who, how they relate to this team, their intro and tags, what they are looking at, and the three things you can do with them — all visible, nothing behind ⋯. */
export function PersonCard({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const follow = useSocialUi().follow;
  const person = c.people.find(p => p.id === c.personId);
  const close = () => c.setPersonId(undefined);
  // Focus starts on 关闭, not on the first control (the account ID), so opening never draws a ring around the ID.
  const closeRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, dialogProps } = useDialogBehavior({ open: Boolean(person), onOpenChange: open => { if (!open) close(); }, initialFocusRef: closeRef });
  const command = c.live.command, personId = person?.id, chainEnabled = c.live.state.wallet?.config?.enabled;
  useEffect(() => { if (personId && chainEnabled) void command('wallet-person', { accountId: personId }).catch(() => {}); }, [command, personId, chainEnabled]);
  // 喊 TA 来看: the page in front, as a card in the chat that calls this teammate, online or not.
  const called = useCall(c);
  if (!person) return null;
  const self = person.id === c.data.self;
  const member = c.team.memberIds.includes(person.id);
  const applicant = c.requests.some(request => request.teamId === c.current && request.personId === person.id);
  const found = member ? c.data.views.find(v => v.id === person.viewing) : undefined;
  const view = found && liveView(c, found);
  const role = member ? person.id === c.team.owner ? t('extension.copy.owner') : t('common.member') : applicant ? t('extension.copy.applyTeam') : t('extension.copy.notMember');
  const presence = member ? person.presence === 'active' ? t('extension.copy.presenceActive') : person.presence === 'away' ? t('extension.copy.presenceAway') : undefined : undefined;
  const bio = self ? c.live.state.account?.bio ?? person.bio : person.bio;
  const tags = (self ? c.live.state.account?.tags ?? person.tags : person.tags) ?? [];
  const following = follow?.teamId === c.current && follow.personId === person.id;
  const teammate = member && !self && c.canWrite;
  const transferReason = person.walletVerified === false ? t('extension.wallet.noWallet') : undefined;
  return <dialog ref={dialogRef} className={`${s.personCard} ${card.person}`} aria-label={t('extension.dynamic.profileTitle', { name: person.name ?? '' })} {...dialogProps}>
    <header className={card.head}>
      <PersonAvatar person={person} size="lg" />
      <div className={card.name}>
        <h2>{person.name}</h2>
        <p><span>{role}</span>{presence && <span data-presence={person.presence}>{presence}</span>}{person.walletAddress && <span className={card.handle}><AccountId c={c} address={person.walletAddress} /></span>}</p>
      </div>
      <Action ref={closeRef} label={t('extension.copy.closeProfile')} onClick={close}><X /></Action>
    </header>
    {(bio || tags.length > 0) && <div className={card.about}>
      {bio && <p className={card.bio}>{bio}</p>}
      {tags.length > 0 && <ul className={card.tags} aria-label={t('extension.member.tags')}>{tags.map(tag => <li key={tagKey(tag)}>{tagLabel(tag, t)}</li>)}</ul>}
    </div>}
    {view && <button type="button" className={card.watching} onClick={() => { close(); c.selectAsset(view.id); }}>
      <small>{t('extension.web.viewing')}</small>
      <span className={card.watchingRow}><Token view={view} size="sm" waiting={tokenWaiting(c, view)} /><b><TokenName c={c} view={view} /></b><em>{view.source || hostOf(view.url)}</em><ChevronRight size={16} aria-hidden="true" /></span>
    </button>}
    {self ? <div className={card.actions}>
      <button type="button" className={card.action} onClick={() => { close(); c.go('profile'); }}><PenLine size={18} /><span>{t('extension.copy.editProfile')}</span></button>
    </div> : teammate && <div className={card.actions}>
      <Tooltip content={t('extension.dynamic.mentionPerson', { name: person.name })}>
        <button type="button" className={card.action} onClick={() => { close(); c.mention(person.id); c.go('chat'); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')?.focus()); }}><AtSign size={18} /><span>{t('extension.web.mention')}</span></button>
      </Tooltip>
      <Tooltip content={called.reason ? t(called.reason) : t('extension.member.callPerson')}>
        <button type="button" className={card.action} aria-disabled={called.reason ? true : undefined} aria-busy={called.busy || undefined} onClick={() => called.press(person.id, () => { close(); c.go('chat'); })}><UserRoundPlus size={18} /><span>{t('extension.web.bringOver')}</span></button>
      </Tooltip>
      <Tooltip content={following ? t('extension.member.stopFollowing') : t('extension.member.follow')}>
        <button type="button" className={card.action} aria-pressed={following} onClick={() => { const follow = () => { setSocialUi({ follow: following ? undefined : { teamId: c.current, personId: person.id, startedAt: Date.now() } }); close(); }; if (following) follow(); else void askFollowGroup().finally(follow); }}><Footprints size={18} /><span>{following ? follow?.paused ? t('extension.web.followPausedShort') : t('extension.web.followingShort') : t('extension.web.followShort')}</span></button>
      </Tooltip>
      {/* 转账 sits with the other teammate actions while the chain is open; it needs the teammate's verified wallet. */}
      {chainEnabled && <Tooltip content={transferReason ?? t('extension.wallet.transferTo', { name: person.name })}>
        <button type="button" className={card.action} aria-disabled={transferReason ? true : undefined} onClick={() => { if (transferReason) return; close(); openTransfer(person.id); }}><ArrowLeftRight size={18} /><span>{t('extension.wallet.transfer')}</span></button>
      </Tooltip>}
    </div>}
  </dialog>;
}
