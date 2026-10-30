'use client';
import { tagKey, tagLabel } from '../../../domain/account/profile-tags';
import { useTranslations } from 'use-intl';
import { useEffect, useState } from 'react';
import { ArrowLeftRight, AtSign, ChevronRight, Footprints, PenLine, UserRoundPlus, X } from 'lucide-react';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { Tooltip } from '@palside/ui/tooltip';
import { useDialogBehavior } from '@palside/ui/dialog';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { accountLabel } from './account-label';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import { openTransfer } from '../wallet/payment-sheet';
import card from './person-card.module.css';

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Who, how they relate to this team, their intro and tags, what they are looking at, and the three things you can do with them — all visible, nothing behind ⋯. */
export function PersonCard({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const follow = useSocialUi().follow;
  const [busy, setBusy] = useState(false);
  const person = c.people.find(p => p.id === c.personId);
  const close = () => c.setPersonId(undefined);
  const { dialogRef, dialogProps } = useDialogBehavior({ open: Boolean(person), onOpenChange: open => { if (!open) close(); } });
  const command = c.live?.command, personId = person?.id, chainEnabled = c.live?.state.wallet?.config?.enabled;
  useEffect(() => { if (personId && chainEnabled) void command?.('wallet-person', { accountId: personId }).catch(() => {}); }, [command, personId, chainEnabled]);
  if (!person) return null;
  const self = person.id === c.data.self;
  const member = c.team.memberIds.includes(person.id);
  const applicant = c.requests.some(request => request.teamId === c.current && request.personId === person.id);
  const view = member ? c.data.views.find(v => v.id === person.viewing) : undefined;
  const role = member ? person.id === c.team.owner ? t('extension.copy.owner') : t('common.member') : applicant ? t('extension.copy.applyTeam') : t('extension.copy.notMember');
  const presence = member && !self && person.presence ? person.presence === 'active' ? t('extension.copy.presenceActive') : t('extension.copy.presenceAway') : undefined;
  const bio = self ? c.live?.state.account?.bio ?? person.bio : person.bio;
  const tags = (self ? c.live?.state.account?.tags ?? person.tags : person.tags) ?? [];
  // 喊来看 needs my token page shared with this team and the teammate to be here.
  const ownView = c.data.views.find(item => item.id === c.viewingId);
  const sharing = c.live ? c.live.state.publishedViewing?.teamId === c.current && ownView?.kind === 'asset' : Boolean(ownView);
  const reason = !sharing ? t('extension.member.needSharing') : person.presence !== 'active' ? t('extension.member.offline') : undefined;
  const following = follow?.teamId === c.current && follow.personId === person.id;
  const teammate = member && !self && c.canWrite;
  const transferReason = person.walletVerified === false ? t('extension.wallet.noWallet') : undefined;
  async function poke() {
    if (!c.live || reason || busy || !person) return;
    setBusy(true);
    try { await c.live.command('poke', { teamId: c.current, accountId: person.id }); c.setNotice(uiMessage('extension.member.poked')); close(); }
    catch (error) { c.setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialogRef} className={`${s.personCard} ${card.person}`} aria-label={t('extension.dynamic.profileTitle', { name: person.name ?? '' })} {...dialogProps}>
    <header className={card.head}>
      <PersonAvatar person={person} size="lg" />
      <div className={card.name}>
        <h2>{person.name}</h2>
        <p><span>{role}</span>{presence && <span data-presence={person.presence}>{presence}</span>}<span className={card.handle}>{accountLabel(person.id)}</span></p>
      </div>
      <Action label={t('extension.copy.closeProfile')} onClick={close}><X /></Action>
    </header>
    {(bio || tags.length > 0) && <div className={card.about}>
      {bio && <p className={card.bio}>{bio}</p>}
      {tags.length > 0 && <ul className={card.tags} aria-label={t('extension.member.tags')}>{tags.map(tag => <li key={tagKey(tag)}>{tagLabel(tag, t)}</li>)}</ul>}
    </div>}
    {view && <button type="button" className={card.watching} onClick={() => { close(); c.selectAsset(view.id); }}>
      <small>{t('extension.web.viewing')}</small>
      <span className={card.watchingRow}><Token view={view} size="sm" /><b>{view.name}</b><em>{view.source || hostOf(view.url)}</em><ChevronRight size={16} aria-hidden="true" /></span>
    </button>}
    {self ? <div className={card.actions} data-single>
      <button type="button" className={card.action} onClick={() => { close(); c.go('profile'); }}><PenLine size={18} /><span>{t('extension.copy.editProfile')}</span></button>
    </div> : teammate && <div className={card.actions}>
      <Tooltip content={t('extension.dynamic.mentionPerson', { name: person.name })}>
        <button type="button" className={card.action} onClick={() => { close(); c.mention(person.id); c.go('chat'); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')?.focus()); }}><AtSign size={18} /><span>{t('extension.web.mention')}</span></button>
      </Tooltip>
      {c.live && <Tooltip content={reason ?? t('extension.member.poke')}>
        <button type="button" className={card.action} aria-disabled={reason ? true : undefined} disabled={busy} onClick={() => void poke()}><UserRoundPlus size={18} /><span>{t('extension.web.bringOver')}</span></button>
      </Tooltip>}
      {c.live && <Tooltip content={following ? t('extension.member.stopFollowing') : t('extension.member.follow')}>
        <button type="button" className={card.action} aria-pressed={following} onClick={() => { setSocialUi({ follow: following ? undefined : { teamId: c.current, personId: person.id } }); close(); }}><Footprints size={18} /><span>{following ? t('extension.web.followingShort') : t('extension.web.followShort')}</span></button>
      </Tooltip>}
      {/* 转账 sits with the other teammate actions while the chain is open; it needs the teammate's verified wallet. */}
      {chainEnabled && <Tooltip content={transferReason ?? t('extension.wallet.transferTo', { name: person.name })}>
        <button type="button" className={card.action} aria-disabled={transferReason ? true : undefined} onClick={() => { if (transferReason) return; close(); openTransfer(person.id); }}><ArrowLeftRight size={18} /><span>{t('extension.wallet.transfer')}</span></button>
      </Tooltip>}
    </div>}
  </dialog>;
}
