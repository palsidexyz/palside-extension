'use client';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { ArrowUpRight, Bell, ChevronRight, Keyboard, KeyRound, Languages, Layers, LogOut, Monitor, ShieldCheck, Wallet } from 'lucide-react';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { usePreferences } from './use-preferences';
import { Switch } from '@palside/ui/switch';
import { interactionFeatures } from '../../../domain/annotations/interaction';
import { permissionRemovalPending, requestNotifications, revokeNotifications } from '../../../runtime/browser/permissions';
import { openShortcuts, shortcutKeys } from '../../../runtime/browser/shortcuts';
import { addSite } from './access';
import { LanguageSetting } from './language-setting';
import { accountLabel } from '../account/account-label';
import { Brand } from '../ui/brand';
import { AppearanceSetting } from './appearance';
import { ShareIcon } from '../ui/icons';
import { KeyCaps } from './signal-settings';
import { useCaptureShortcut } from './use-shortcut';
import { CountText } from '../ui/motion-details';
import { PersonAvatar } from '../ui/primitives';
import { PalsAmount } from '../wallet/amount';
import { SettingControl, SettingGroup, SettingItem, settingRows } from './setting-rows';
import { allowedSites, useGrants } from './use-grants';
import type { PalsideController } from '../app/use-palside';
import pages from '../app/pages.module.css';
import { whenWalletOpen } from '../wallet/closed';
import s from './settings.module.css';

type Mode = 'off' | 'mentions' | 'all';
const modes: Mode[] = ['all', 'mentions', 'off'];
const modeKey = { off: 'extension.settings.notifyOff', mentions: 'extension.settings.notifyMentions', all: 'extension.settings.notifyAll' } as const;

/**
 * 设置: the account first — 资料 and 零钱 in one card. Then 网页, one card: 共享在看 and 网页互动 are switches, each asking Chrome for its
 * permission in the same click, and 网页互动 carries its 网站 and 互动选项 under it. Then 通用 (通知, 截图快捷键, 外观, 语言) and 账号
 * (隐私与数据, 账号与安全, 关于) — then 退出登录.
 * Every page opens one level down and leads nowhere else, so 返回 always comes back here.
 */
export function Settings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const shortcut = useCaptureShortcut(c);
  const notifications = notifyMode(c, grants.notifications);
  const sites = allowedSites(c, grants);
  const roomsOn = c.live ? !c.live.state.preferences.rooms?.off : false;
  const features = [roomsOn ? t('extension.room.name') : '', ...interactionFeatures.filter(id => c.interaction[id]).map(id => t(`extension.web.${id}`))].filter(Boolean);
  const options = !c.web.interact ? t('extension.settings.off') : features.join(t('extension.access.separator')) || t('extension.access.none');
  const shareOn = c.web.share && (!c.live || grants.tabs);
  function setShare(on: boolean) { c.setWeb('share', on); }
  function setInteract(on: boolean) {
    c.setWeb('interact', on);
    // The first time there is no site to act on yet: 添加网站 opens at once. Re-enabling requests remembered sites through Chrome.
    if (on && c.live && !permissionRemovalPending('sites') && !sites.all && !sites.hosts.length && !c.live.state.preferences.restoreSites?.length) addSite(c);
  }
  const wallet = c.live?.state.wallet;
  const balance = wallet?.config?.enabled && wallet.availability === 'ready' ? wallet.balance?.balance : undefined;
  // With the chain off, a payment still settling or an order left to recover keeps the wallet reachable until it resolves.
  const pending = !wallet?.config?.enabled && Boolean((wallet?.payment && !['confirmed', 'expired', 'failed'].includes(wallet.payment.phase)) || wallet?.recovery?.items.length);
  return <div className={s.page}>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('common.error')}</InlineFeedback>}
    <SettingGroup>
      <button type="button" className={s.profile} onClick={() => c.go('profile')} aria-label={t('extension.copy.editPersonalProfile')}>
        <PersonAvatar person={c.me} size="lg" />
        <span className={s.identity}><strong>{c.me.name}</strong><small>{accountLabel(c.data.self)}</small></span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <SettingItem icon={<Wallet size={16} />} title={t('extension.wallet.title')} value={!wallet?.config?.enabled ? t(pending ? 'extension.wallet.pending' : 'extension.wallet.soon') : balance !== undefined ? <PalsAmount value={balance} hidden={wallet.preferences.hideAmounts} /> : undefined} onClick={() => { if (pending) c.go('wallet'); else whenWalletOpen(c, () => c.go('wallet')); }} />
    </SettingGroup>
    <SettingGroup title={t('extension.settings.groupWeb')}>
      <SettingControl icon={<ShareIcon size={16} />}>
        <Switch className={settingRows.switch} label={t('extension.web.share')} help={{ label: t('extension.settings.aboutFeature', { name: t('extension.web.share') }), content: t('extension.settings.shareHint') }} checked={shareOn} onChange={event => setShare(event.currentTarget.checked)} />
      </SettingControl>
      <SettingControl icon={<Layers size={16} />}>
        <Switch className={settingRows.switch} label={t('extension.settings.interaction')} help={{ label: t('extension.settings.aboutFeature', { name: t('extension.settings.interaction') }), content: t('extension.settings.interactHint') }} checked={c.web.interact} onChange={event => setInteract(event.currentTarget.checked)} />
      </SettingControl>
      {c.web.interact && <div className={s.reveal}><SettingItem title={t('extension.settings.sites')} value={sites.all ? t('extension.sites.allSites') : <CountText text={t('extension.web.siteCount', { count: sites.hosts.length })} value={sites.hosts.length} />} onClick={() => c.go('sites')} /></div>}
      <SettingItem title={t('extension.settings.interactionOptions')} value={options} onClick={() => c.go('interaction')} />
    </SettingGroup>
    <SettingGroup title={t('extension.settings.groupGeneral')}>
      {c.live && <SettingItem icon={<Bell size={16} />} title={t('extension.settings.notifications')} value={t(modeKey[notifications])} onClick={() => c.go('notifications')} />}
      {c.live && <SettingItem icon={<Keyboard size={16} />} title={t('extension.shot.shortcut')} value={shortcut ? <KeyCaps keys={shortcutKeys(shortcut)} /> : t('extension.shot.unset')} end={<span className={settingRows.arrow} aria-hidden="true"><ArrowUpRight size={15} /></span>} onClick={() => void openShortcuts()} />}
      <SettingControl icon={<Monitor size={16} />}><label className={settingRows.label} htmlFor="appearance">{t('extension.copy.appearance')}</label><AppearanceSetting /></SettingControl>
      {c.live && <SettingControl icon={<Languages size={16} />}><label className={settingRows.label} htmlFor="language">{t('common.language')}</label><LanguageSetting /></SettingControl>}
    </SettingGroup>
    <SettingGroup title={t('extension.settings.groupAccount')}>
      <SettingItem icon={<ShieldCheck size={16} />} title={t('extension.settings.privacy')} onClick={() => c.go('privacy')} />
      {c.live && <SettingItem icon={<KeyRound size={16} />} title={t('extension.copy.security')} onClick={() => c.go('security')} />}
      <SettingItem icon={<Brand markOnly />} title={t('extension.copy.aboutPalside')} onClick={() => c.go('about')} />
    </SettingGroup>
    <SettingGroup>
      <SettingItem tone="danger" icon={<LogOut size={16} />} title={t('extension.copy.signOut')} end={null} onClick={() => c.setConfirmation({ title: uiMessage('extension.copy.signOutTitle'), description: uiMessage('extension.wallet.logoutRecovery'), action: uiMessage('extension.copy.signOut'), danger: true, confirm: () => { if (c.live) return c.live.command('logout').then(() => {}); c.setNotice(uiMessage('extension.copy.previewNotConnected')); } })} />
    </SettingGroup>
  </div>;
}

/** The 通知 choice as it works now: one Chrome does not allow is 关闭. */
function notifyMode(c: PalsideController, granted: boolean): Mode {
  const mode = c.live?.state.preferences.notifications ?? 'off';
  return granted ? mode : 'off';
}

/**
 * 通知: which messages notify on this desktop, as one choice from most to fewest, and whether they show their text (hidden while 关闭). Choosing anything but 关闭
 * asks Chrome in the same click and a refusal leaves it on 关闭; 关闭 gives the permission back.
 */
export function NotificationSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const live = c.live;
  const preferences = usePreferences(live);
  if (!live) return null;
  const mode = grants.notifications ? preferences.values.notifications ?? 'off' : 'off';
  function choose(next: Mode) {
    if (!preferences.current()) return;
    if (next !== 'off' && permissionRemovalPending('notifications')) { c.setNotice(uiMessage('common.error')); return; }
    const intent = preferences.beginPermission('notifications');
    const failed = () => { if (intent.current()) c.setNotice(uiMessage('extension.settings.notifyDenied')); };
    if (next === 'off') {
      const work = preferences.save({ notifications: 'off' }).then(() => intent.settled).then(async () => {
        if (intent.current() && !await revokeNotifications(intent.current)) failed();
      }).catch(failed);
      intent.track(work);
      return;
    }
    // Chrome's prompt must open synchronously from this click.
    const asking = requestNotifications();
    const work = asking.then(async allowed => {
      if (!intent.current()) return;
      if (allowed) await preferences.save({ notifications: next });
      else failed();
    }).catch(failed);
    intent.track(work);
  }
  return <div className={pages.page}>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('common.error')}</InlineFeedback>}
    <div className={pages.card} role="radiogroup" aria-label={t('extension.settings.notifications')}>
      {modes.map(value => <button key={value} type="button" role="radio" aria-checked={mode === value} className={pages.radioRow} onClick={() => choose(value)}>
        <span className={pages.text}><strong>{t(modeKey[value])}</strong></span>
        <span className={pages.radio} aria-hidden="true" />
      </button>)}
    </div>
    {mode !== 'off' && <div className={pages.card}><div className={pages.row}>
      <Switch className={pages.switch} label={t('extension.settings.preview')} checked={Boolean(preferences.values.notificationPreview)} onChange={event => { void preferences.save({ notificationPreview: event.currentTarget.checked }).catch(() => { if (preferences.current()) c.setNotice(uiMessage('common.error')); }); }} />
    </div></div>}
  </div>;
}
