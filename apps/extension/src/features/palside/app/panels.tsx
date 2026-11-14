'use client';
import { useTranslations } from 'use-intl';
import { FollowBar } from '../annotations/follow-bar';
import { MessageSearch } from '../chat/message-search';
import { assetView } from '../../../domain/assets/model';
import { NotificationSettings, Settings } from '../settings/settings';
import { InteractionSettings } from '../settings/web-settings';
import { SiteDetail, SitesSettings } from '../settings/sites';
import { siteOf } from '../settings/site-catalog';
import { Privacy } from '../settings/privacy';
import { Favorites } from '../favorites/favorites';
import { About } from '../settings/about';
import { WalletHome, WalletReceive, WalletRecords } from '../wallet/wallet';
import { WalletSettings } from '../wallet/security';
import { PacketPage } from '../wallet/packet';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ProfileForm, TeamProfileForm } from '../account/profile-form';
import { TeamSettings } from '../teams/team-settings';
import { TeamLevel } from '../teams/team-level';
import { Members, Requests } from '../teams/member-list';
import { EmptyState } from '../ui/empty-state';
import { Report } from '../feedback/report';
import { DeleteAccountForm, Security } from '../account/identity';
import { Lobby, Recruitment } from '../teams/lobby';
import { FormerTeams, JoinPage, TeamStartForm } from '../teams/team-start';
import { AssetDiscussion, AssetHeaderActions } from '../assets/asset-discussion';
import { BlockedPeople, RoomPeople } from '../rooms/danmaku-view';
import { Hot, hotStartChain } from '../rooms/hot';
import { Action } from '../ui/primitives';
import { ConnectionCard, ConnectionState, NeedsService, pageIssue } from '../feedback/session-notice';

import type { PalsideController } from './use-palside';
import s from './palside.module.css';

const titles: Record<string, string> = { wallet: 'extension.wallet.title', 'wallet-receive': 'extension.wallet.receive', 'wallet-records': 'extension.wallet.records', 'wallet-settings': 'extension.wallet.settings', 'wallet-packet': 'extension.wallet.createPacket', report: 'extension.copy.report', 'delete-account': 'extension.copy.deleteAccount', lobby: 'extension.copy.visitLobby', join: 'extension.copy.joinInvitation', 'add-team': 'extension.copy.lobby', 'former-teams': 'extension.start.formerTeams', recruitment: 'extension.copy.teamIntro', team: 'extension.copy.teamSettings', members: 'extension.copy.teamMembers', requests: 'extension.copy.joinRequests', 'team-profile': 'extension.copy.editTeam', settings: 'extension.copy.settings', search: 'extension.copy.searchMessages', asset: 'extension.copy.details', profile: 'extension.copy.editProfile', security: 'extension.copy.security', interaction: 'extension.settings.interaction', sites: 'extension.settings.sites', notifications: 'extension.settings.notifications', favorites: 'extension.web.myFavorites', privacy: 'extension.settings.privacy', about: 'extension.copy.aboutPalside', 'room-people': 'extension.room.people', blocked: 'extension.room.blocked', hot: 'extension.hot.tokens' };

/** Pages whose content or actions come from the business service: they carry the connection card at the top. */
const serviceScreens = new Set(['team', 'members', 'requests', 'team-profile', 'asset', 'recruitment', 'join', 'add-team', 'former-teams', 'profile', 'security', 'delete-account', 'blocked', 'report', 'wallet', 'wallet-receive', 'wallet-records', 'wallet-settings', 'wallet-packet']);
/** Pages that are nothing but live server data: without the service the whole page is the connection state, never an old list. */
const liveScreens = new Set(['hot', 'lobby', 'room-people']);

export function Panels({ c, onJump }: { c: PalsideController; onJump: (id: string) => void }) {
  const t = useTranslations();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const section = heading.current?.parentElement?.parentElement; if (!section?.contains(document.activeElement)) heading.current?.focus({ preventScroll: true }); }, []);
  const [hotChain, setHotChain] = useState<string | null>(hotStartChain);
  const draftAsset = assetView(c.draft.attachment);
  const asset = draftAsset?.id === c.selectedAsset ? draftAsset : c.selectedView?.id === c.selectedAsset ? c.selectedView : c.data.views.find(v => v.id === c.selectedAsset) ?? c.selectedView;
  if (c.screen === 'chat') return null;
  function back() { if (c.screen === 'members' && c.selectingOwner) c.go('team'); else c.back(); }
  const title = titles[c.screen] ?? 'extension.copy.signIn';
  const siteTitle = c.siteHost === 'all' ? t('extension.sites.allSites') : siteOf(c, c.siteHost).name;
  return <section className={s.secondary} aria-label={c.screen === 'site' ? siteTitle : t(title)} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); back(); }
  }}>
    <header className={`${s.secondaryHeader} ${s.pageHeader}`}><span className={s.headerSide}><Action label={t('common.back')} onClick={back}><ArrowLeft /></Action></span><h1 ref={heading} tabIndex={-1}>{c.screen === 'members' && c.selectingOwner ? t('extension.copy.selectNewOwner') : c.screen === 'site' ? siteTitle : t(title)}</h1><span className={s.headerSide}>{c.screen === 'asset' && asset && <AssetHeaderActions c={c} asset={asset} />}</span></header>
    <FollowBar c={c} />
    <div className={s.secondaryBody} data-palside-panel-scroll>
      {serviceScreens.has(c.screen) && <ConnectionCard c={c} />}
      {liveScreens.has(c.screen) && pageIssue(c, 'service') ? <ConnectionState c={c} /> : <>
      {c.screen === 'report' && c.reportTarget && <Report c={c} target={c.reportTarget} />}
      {c.screen === 'lobby' && <Lobby c={c} />}
      {c.screen === 'recruitment' && <NeedsService c={c}><Recruitment c={c} /></NeedsService>}
      {c.screen === 'join' && <NeedsService c={c}><JoinPage c={c} /></NeedsService>}
      {c.screen === 'add-team' && <NeedsService c={c}><TeamStartForm c={c} /></NeedsService>}
      {c.screen === 'former-teams' && <FormerTeams c={c} />}
      {c.screen === 'team' && <TeamSettings key={c.current} c={c} />}
      {c.screen === 'members' && <Members c={c} />}
      {c.screen === 'requests' && <NeedsService c={c}><Requests c={c} /></NeedsService>}
      {c.screen === 'team-profile' && <>{c.team.owner === c.data.self && c.canWrite && <NeedsService c={c}><TeamProfileForm key={c.current} c={c} /></NeedsService>}<TeamLevel c={c} /></>}
      {c.screen === 'search' && <MessageSearch c={c} onJump={onJump} />}
      {c.screen === 'asset' && !asset && <EmptyState title={t('extension.copy.contentUnavailable')} />}
      {c.screen === 'asset' && asset && <AssetDiscussion key={asset.id} c={c} asset={asset} onJump={onJump} />}
      {c.screen === 'settings' && <Settings c={c} />}
      {c.screen === 'wallet' && <WalletHome c={c} />}
      {c.screen === 'wallet-receive' && <WalletReceive c={c} />}
      {c.screen === 'wallet-records' && <WalletRecords c={c} />}
      {c.screen === 'wallet-settings' && <WalletSettings c={c} />}
      {c.screen === 'wallet-packet' && <PacketPage c={c} />}
      {c.screen === 'profile' && <NeedsService c={c}><ProfileForm c={c} /></NeedsService>}
      {c.screen === 'delete-account' && <NeedsService c={c}><DeleteAccountForm c={c} /></NeedsService>}
      {c.screen === 'security' && <Security c={c} />}
      {c.screen === 'privacy' && <Privacy c={c} />}
      {c.screen === 'interaction' && <InteractionSettings c={c} />}
      {c.screen === 'sites' && <SitesSettings c={c} />}
      {c.screen === 'site' && c.siteHost && <SiteDetail key={c.siteHost} c={c} host={c.siteHost} />}
      {c.screen === 'notifications' && <NotificationSettings c={c} />}
      {c.screen === 'favorites' && <Favorites c={c} />}
      {c.screen === 'about' && <About c={c} />}
      {c.screen === 'room-people' && <RoomPeople c={c} />}
      {c.screen === 'hot' && <Hot c={c} chain={hotChain} onChain={setHotChain} />}
      {c.screen === 'blocked' && <BlockedPeople c={c} />}
      </>}
    </div>
  </section>;
}
