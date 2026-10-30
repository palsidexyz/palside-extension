'use client';
import { Button, IconButton } from '@palside/ui/button';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Ban, Bell, Clock, Coins, HardDrive, Highlighter, MapPin, Scissors, Star, TextQuote, Users, X } from 'lucide-react';
import { emptyFavorites } from '../../../domain/annotations/interaction';
import { revokeAllSites, revokeNotifications } from '../../../runtime/browser/permissions';
import { CountText } from '../ui/motion-details';
import { Sheet } from '@palside/ui/sheet';
import { ChromeMark, DanmakuIcon, ShareIcon } from '../ui/icons';
import { SettingGroup, settingRows } from './setting-rows';
import { setSocialUi, useSocialUi, type ReadKey } from '../annotations/social-state';
import { useTextState } from '../ui/text';
import { allowedSites, useGrants, type Grants } from './use-grants';
import { usePreferences } from './use-preferences';
import type { PalsideController } from '../app/use-palside';
import sheet from './access-sheet.module.css';
import pages from '../app/pages.module.css';
import s from './privacy.module.css';

/** The Chrome permissions Palside runs on, named as Chrome's own prompt words them. `active` (当前标签页) comes with the install. */
type Permission = 'tabs' | 'sites' | 'active' | 'notifications';

/** Each permission and the features that use it. 弹幕 follows the tab's token only on an added site, like every page feature. */
const cards: [Permission, ReadKey[]][] = [
  ['tabs', ['share']],
  ['sites', ['token', 'quote', 'signal', 'sticky', 'room']],
  ['active', ['shot']],
  ['notifications', ['notify']],
];
const uses: Record<ReadKey, Permission[]> = { share: ['tabs'], token: ['sites'], quote: ['sites'], signal: ['sites'], sticky: ['sites'], room: ['sites'], shot: ['active'], notify: ['notifications'] };

const readIcons: Record<ReadKey, () => ReactNode> = {
  share: () => <ShareIcon size={14} />, token: () => <Coins size={14} />, quote: () => <TextQuote size={14} />, signal: () => <MapPin size={14} />,
  sticky: () => <Highlighter size={14} />, room: () => <DanmakuIcon size={14} />, shot: () => <Scissors size={14} />, notify: () => <Bell size={14} />,
};

/** Granted now (`true`/`false`), or `undefined` for 当前标签页, which is always there and cannot be taken back. */
function granted(permission: Permission, grants: Grants, c: PalsideController) {
  if (permission === 'active') return undefined;
  if (permission === 'sites') { const { all, hosts } = allowedSites(c, grants); return all || hosts.length > 0; }
  return grants[permission];
}

/** The state word after a permission's name: 已允许 / N 个网站 / 所有网站 / 未允许, or 安装时自带. */
function PermissionState({ c, grants, permission }: { c: PalsideController; grants: Grants; permission: Permission }) {
  const t = useTranslations();
  const on = granted(permission, grants, c);
  if (on === undefined) return <span className={s.state} data-fixed>{t('extension.privacy.builtIn')}</span>;
  const { all, hosts } = allowedSites(c, grants);
  const text = !on ? t('extension.privacy.notAllowed') : permission !== 'sites' ? t('extension.privacy.allowed') : all ? t('extension.sites.allSites') : <CountText text={t('extension.web.siteCount', { count: hosts.length })} value={hosts.length} />;
  return <span className={s.state} data-on={on || undefined}>{text}</span>;
}

/**
 * 隐私与数据: one card per Chrome permission — Chrome's mark, the permission in Chrome's words, whether it is allowed now, 收回 — and the
 * features that use it; each feature opens what it reads, who sees it and for how long. Then what stays on this device.
 * 收回 gives the permission back to Chrome and turns off what used it; turning that on again later does not make Chrome ask again.
 */
export function Privacy({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const preferences = usePreferences(c.live);
  const favorites = c.favorites.sites.length + c.favorites.pages.length;
  function revoke(permission: Permission) {
    const intent = permission === 'notifications' ? preferences.beginPermission('notifications') : undefined;
    const { all, hosts } = allowedSites(c, grants);
    const scope = all ? t('extension.sites.allSites') : t('extension.web.siteCount', { count: hosts.length });
    const take = {
      tabs: () => c.setWeb('share', false),
      sites: () => { if (c.web.interact) c.setWeb('interact', false); else void revokeAllSites().catch(() => []); },
      notifications: () => {
        if (!intent?.current()) return;
        const failed = () => { if (intent.current()) c.setNotice(uiMessage('extension.settings.notifyDenied')); };
        const work = preferences.save({ notifications: 'off' }).then(() => intent.settled).then(async () => {
          if (intent.current() && !await revokeNotifications(intent.current)) failed();
        }).catch(failed);
        intent.track(work);
        return work;
      },
      active: () => {},
    }[permission];
    c.setConfirmation({
      title: uiMessage(`extension.privacy.revoke_${permission}_title`), description: permission === 'sites' ? uiMessage('extension.privacy.revoke_sites', { scope }) : uiMessage(`extension.privacy.revoke_${permission}`),
      action: uiMessage('extension.privacy.revoke'), danger: true, confirm: take,
    });
  }
  return <div className={`${pages.page} ${s.page}`}>
    <section className={settingRows.group} aria-label={t('extension.privacy.chrome')}>
    <div className={settingRows.head}><span>{t('extension.privacy.chrome')}</span></div>
    <div className={s.cards}>
      {cards.map(([permission, features]) => <section key={permission} className={s.card} aria-label={t(`extension.privacy.perm_${permission}`)}>
        <header className={s.head}>
          <ChromeMark />
          <h2 className={s.name}>{t(`extension.privacy.perm_${permission}`)}</h2>
          <PermissionState c={c} grants={grants} permission={permission} />
          {granted(permission, grants, c) && <Button size="xs" variant="surface" className={s.revoke} onClick={() => revoke(permission)}>{t('extension.privacy.revoke')}</Button>}
        </header>
        <div className={s.chips}>
          {features.filter(id => c.live || id !== 'room').map(id => <button key={id} type="button" className={s.chip} onClick={() => setSocialUi({ read: id })}>{readIcons[id]()}{t(`extension.privacy.feature_${id}`)}</button>)}
        </div>
      </section>)}
    </div>
    </section>
    <SettingGroup title={t('extension.settings.seeLocal')}>
      <Cache c={c} />
      <div className={pages.row}><span className={pages.icon} aria-hidden="true"><Star size={16} /></span>
        <span className={pages.text}><strong>{t('extension.web.favorites')}</strong><small><CountText text={t('extension.web.favoriteCount', { count: favorites })} value={favorites} /></small></span>
        <Button size="sm" disabled={!favorites} onClick={() => c.setConfirmation({ title: uiMessage('extension.web.clearFavoritesTitle'), description: uiMessage('extension.web.clearFavoritesDescription'), action: uiMessage('extension.center.clear'), danger: true, confirm: () => c.setFavorites(() => emptyFavorites) })}>{t('extension.center.clear')}</Button>
      </div>
    </SettingGroup>
  </div>;
}

/** One feature, opened from 隐私与数据: the Chrome permission it runs on and whether it is allowed, then what it reads, who sees it, how long it is kept and what it never reads. */
export function ReadSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const id = useSocialUi().read;
  const close = () => setSocialUi({ read: undefined });
  const permissions = id ? uses[id] : [];
  return <Sheet open={Boolean(id)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="read-sheet-title" className={`${sheet.sheet} ${s.drawer}`}>
    {id && <>
      <header className={sheet.head}>
        <span className={sheet.target} aria-hidden="true">{readIcons[id]()}</span>
        <h2 id="read-sheet-title" className={sheet.title}>{t(`extension.privacy.feature_${id}`)}</h2>
        <IconButton size="sm" variant="quiet" className={sheet.close} label={t('common.close')} onClick={close}><X size={16} /></IconButton>
      </header>
      <div className={s.permBox}>
        <small>{t('extension.privacy.chrome')}</small>
        {permissions.map(permission => <div key={permission} className={s.permRow}><ChromeMark size={18} /><b>{t(`extension.privacy.perm_${permission}`)}</b><PermissionState c={c} grants={grants} permission={permission} /></div>)}
      </div>
      <p className={sheet.lead}>{t(`extension.privacy.read.${id}.line`)}</p>
      <dl className={sheet.facts}>
        {([['who', Users], ['keep', Clock], ['no', Ban]] as const).map(([key, Icon]) => <div key={key}><Icon size={16} /><dt>{t(`extension.access.${key}`)}</dt><dd>{t(`extension.privacy.read.${id}.${key}`)}</dd></div>)}
      </dl>
    </>}
  </Sheet>;
}

function formatBytes(bytes: number, locale: string) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit > 1 && value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

function Cache({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [bytes, setBytes] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useTextState();
  const [reload, setReload] = useState(0);
  const live = c.live;
  useEffect(() => {
    if (!live) return;
    let current = true;
    void live.command('cache-usage').then(value => { if (current) { setBytes(value?.bytes); setError(''); } }, () => { if (current) setError(uiMessage('extension.center.cacheUnavailable')); });
    return () => { current = false; };
  }, [live, reload, setError]);
  function clear() {
    if (!live) return;
    c.setConfirmation({ title: uiMessage('extension.center.clearTitle'), description: uiMessage('extension.center.clearDescription'), action: uiMessage('extension.center.clear'), confirm: async () => {
      setBusy(true);
      try { setBytes((await live.command('clear-cache'))?.bytes); } finally { setBusy(false); }
    } });
  }
  return <div className={pages.row}><span className={pages.icon} aria-hidden="true"><HardDrive size={16} /></span>
    <span className={pages.text}><strong>{t('extension.center.cache')}</strong><small>{error ? <span role="alert">{error}</span> : bytes === undefined ? live ? t('extension.copy.loading') : '—' : formatBytes(bytes, c.locale)}</small></span>
    {live && <Button size="sm" disabled={busy || (!error && !bytes)} onClick={error ? () => { setError(''); setBytes(undefined); setReload(value => value + 1); } : clear}>{t(error ? 'common.retry' : 'extension.center.clear')}</Button>}
  </div>;
}
