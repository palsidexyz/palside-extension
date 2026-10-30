'use client';
import { useTranslations } from 'use-intl';
import { CountText } from '../ui/motion-details';
import { hitSegments } from '../chat/text-highlights';
import { assetView, relatedMessages } from '../../../domain/assets/model';
import { personFor } from '../../../domain/account/model';
import { NotificationSettings, Settings } from '../settings/settings';
import { InteractionSettings } from '../settings/web-settings';
import { SiteDetail, SitesSettings, siteOf } from '../settings/sites';
import { Privacy } from '../settings/privacy';
import { Favorites } from '../favorites/favorites';
import { About } from '../settings/about';
import { WalletHome, WalletReceive, WalletRecords } from '../wallet/wallet';
import { WalletSettings } from '../wallet/security';
import { PacketPage } from '../wallet/packet';

import { useEffect, useRef } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { ProfileForm, TeamProfileForm } from '../account/profile-form';
import { TeamSettings } from '../teams/team-settings';
import { TeamLevel } from '../teams/team-level';
import { Members, Requests } from '../teams/member-list';
import { SharedContent } from '../assets/shared-content';
import { EmptyState, HistoryMore } from '../chat/history-scope';
import { Report } from '../feedback/report';
import { DeleteAccountForm, Security } from '../account/identity';
import { Lobby, Recruitment } from '../teams/lobby';
import { FormerTeams, JoinPage, TeamStartForm } from '../teams/team-start';
import { AssetDiscussion } from '../assets/asset-discussion';
import { BlockedPeople, RoomPeople } from '../rooms/danmaku-view';
import { Hot } from '../rooms/hot';
import { Input } from '@palside/ui/field';
import { Action, PersonAvatar } from '../ui/primitives';

import type { PalsideController } from './use-palside';
import s from './palside.module.css';

const titles: Record<string, string> = { wallet: 'extension.wallet.title', 'wallet-receive': 'extension.wallet.receive', 'wallet-records': 'extension.wallet.records', 'wallet-settings': 'extension.wallet.settings', 'wallet-packet': 'extension.wallet.createPacket', 'wallet-invitation': 'extension.wallet.invitationPacket', 'team-level': 'extension.wallet.level', shared: 'extension.copy.sharedItems', report: 'extension.copy.report', 'delete-account': 'extension.copy.deleteAccount', lobby: 'extension.copy.visitLobby', join: 'extension.copy.joinInvitation', 'add-team': 'extension.copy.lobby', 'former-teams': 'extension.start.formerTeams', recruitment: 'extension.copy.teamIntro', team: 'extension.copy.teamSettings', members: 'extension.copy.teamMembers', requests: 'extension.copy.joinRequests', 'team-profile': 'extension.copy.editTeam', settings: 'extension.copy.settings', search: 'extension.copy.searchMessages', asset: 'extension.copy.details', profile: 'extension.copy.editProfile', security: 'extension.copy.security', interaction: 'extension.settings.interactionOptions', sites: 'extension.settings.sites', notifications: 'extension.settings.notifications', favorites: 'extension.web.favorites', privacy: 'extension.settings.privacy', about: 'extension.copy.aboutPalside', 'room-people': 'extension.room.people', blocked: 'extension.room.blocked', hot: 'extension.hot.title' };

export function Panels({ c, onJump }: { c: PalsideController; onJump: (id: string) => void }) {
  const t = useTranslations();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const section = heading.current?.parentElement?.parentElement; if (!section?.contains(document.activeElement)) heading.current?.focus({ preventScroll: true }); }, []);
  const draftAsset = assetView(c.draft.attachment);
  const asset = draftAsset?.id === c.selectedAsset ? draftAsset : c.selectedView?.id === c.selectedAsset ? c.selectedView : c.data.views.find(v => v.id === c.selectedAsset) ?? c.selectedView;
  const searchScope = c.assetFilter ? relatedMessages(c.currentMessages, c.assetFilter, c.data.views) : c.currentMessages.filter(m => !m.recalled && m.status === 'sent');
  const results = searchScope.filter(m => {
    const view = assetView(m.attachment);
    return `${m.text} ${view?.name ?? ''} ${view?.address ?? ''}`.toLocaleLowerCase().includes(c.query.toLocaleLowerCase());
  });
  if (c.screen === 'chat' || c.screen === 'room') return null;
  function back() { if (c.screen === 'members' && c.selectingOwner) c.go('team'); else c.back(); }
  const title = titles[c.screen] ?? 'extension.copy.signIn';
  const siteTitle = c.siteHost === 'all' ? t('extension.sites.allSites') : siteOf(c, c.siteHost).name;
  return <section className={s.secondary} aria-label={c.screen === 'site' ? siteTitle : t(title)} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); back(); }
  }}>
    <header className={s.secondaryHeader}><><Action label={t('common.back')} onClick={back}><ArrowLeft /></Action><h1 ref={heading} tabIndex={-1}>{c.screen === 'members' && c.selectingOwner ? t('extension.copy.selectNewOwner') : c.screen === 'site' ? siteTitle : t(title)}</h1></></header>
    <div className={s.secondaryBody} data-palside-panel-scroll>
      {c.screen === 'shared' && <SharedContent c={c} onJump={onJump} />}
      {c.screen === 'report' && c.reportTarget && <Report c={c} target={c.reportTarget} />}
      {c.screen === 'lobby' && <Lobby c={c} />}
      {c.screen === 'recruitment' && <Recruitment c={c} />}
      {c.screen === 'join' && <JoinPage c={c} />}
      {c.screen === 'add-team' && <TeamStartForm c={c} />}
      {c.screen === 'former-teams' && <FormerTeams c={c} />}
      {c.screen === 'team' && <TeamSettings key={c.current} c={c} />}
      {c.screen === 'team-level' && <TeamLevel c={c} />}
      {c.screen === 'members' && <Members c={c} />}
      {c.screen === 'requests' && <Requests c={c} />}
      {c.screen === 'team-profile' && c.team.owner === c.data.self && c.canWrite && <TeamProfileForm key={c.current} c={c} />}
      {c.screen === 'search' && <><Input type="search" autoFocus aria-label={t('extension.copy.searchMessageContent')} leadingIcon={<Search size={16} />} placeholder={t('extension.copy.searchPlaceholder')} value={c.query} onChange={e => c.setQuery(e.target.value)} />{results.length > 0 && <div className={s.listCaption}>{c.assetFilter ? t('extension.dynamic.relatedMessages', { name: (c.data.views.find(v => v.id === c.assetFilter)?.name) ?? '' }) : c.query.trim() ? t('extension.copy.searchResults') : t('extension.copy.recentMessages')}<small><CountText text={t('extension.dynamic.messageCount', { count: results.length })} value={results.length} /></small></div>}{results.length > 0 && <div className={s.group}>{results.map(m => <button className={s.searchResult} key={m.id} onClick={() => onJump(m.id)}><PersonAvatar person={personFor(c.people, m.author, t('common.member'))} /><span><strong>{personFor(c.people, m.author, t('common.member')).name}<small>{m.time}</small></strong><p>{m.text ? hitSegments(m.text, c.query).map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : part.text) : m.attachment?.kind === 'image' ? t('extension.copy.imageQuote') : t('extension.copy.tokenQuote')}</p></span></button>)}</div>}{results.length > 0 ? <HistoryMore c={c} /> : <EmptyState icon={<Search />} title={c.query.trim() ? t('extension.copy.noSearchResults') : t('extension.copy.noSearchableMessages')}><HistoryMore c={c} /></EmptyState>}</>}
      {c.screen === 'asset' && !asset && <EmptyState title={t('extension.copy.contentUnavailable')} />}
      {c.screen === 'asset' && asset && <AssetDiscussion key={asset.id} c={c} asset={asset} onJump={onJump} />}
      {c.screen === 'settings' && <Settings c={c} />}
      {c.screen === 'wallet' && <WalletHome c={c} />}
      {c.screen === 'wallet-receive' && <WalletReceive c={c} />}
      {c.screen === 'wallet-records' && <WalletRecords c={c} />}
      {c.screen === 'wallet-settings' && <WalletSettings c={c} />}
      {c.screen === 'wallet-packet' && <PacketPage c={c} />}
      {c.screen === 'wallet-invitation' && <PacketPage c={c} invitation />}
      {c.screen === 'profile' && <ProfileForm c={c} />}
      {c.screen === 'delete-account' && c.live && <DeleteAccountForm c={c} />}
      {c.screen === 'security' && c.live && <Security c={c} />}
      {c.screen === 'privacy' && <Privacy c={c} />}
      {c.screen === 'interaction' && <InteractionSettings c={c} />}
      {c.screen === 'sites' && <SitesSettings c={c} />}
      {c.screen === 'site' && c.siteHost && <SiteDetail key={c.siteHost} c={c} host={c.siteHost} />}
      {c.screen === 'notifications' && <NotificationSettings c={c} />}
      {c.screen === 'favorites' && <Favorites c={c} />}
      {c.screen === 'about' && <About c={c} />}
      {c.screen === 'room-people' && <RoomPeople c={c} />}
      {c.screen === 'hot' && <Hot c={c} />}
      {c.screen === 'blocked' && <BlockedPeople c={c} />}
    </div>
  </section>;
}
