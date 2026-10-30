'use client';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, Coins, Globe2, Plus } from 'lucide-react';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Switch } from '@palside/ui/switch';
import { Tooltip } from '@palside/ui/tooltip';
import { SiteLogo } from '../assets/site-logo';
import { siteTags, type Site } from './site-catalog';
import { addSite } from './access';
import { setSocialUi } from '../annotations/social-state';
import { SettingDanger, SettingGroup, settingRows } from './setting-rows';
import { allowedSites, siteAllowed, useGrants } from './use-grants';
import type { PalsideController } from '../app/use-palside';
import s from '../app/pages.module.css';

export function siteOf(c: PalsideController, host: string): Site {
  return c.sites.find(site => site.domain === host) ?? { id: host, name: host, domain: host };
}

/** One site row everywhere — the list and the detail head: logo, name with capability tags, the domain under it. */
export function SiteRow({ site, sub, end }: { site: Site; sub?: ReactNode; end?: ReactNode }) {
  const t = useTranslations();
  const tags = siteTags(site.domain);
  return <div className={s.siteRow}>
    <SiteLogo site={site} />
    <span className={s.siteText}>
      <span className={s.siteLine}><span className={s.siteName}>{site.name}</span>{tags.token && <span className={s.tag}>{t('extension.settings.tagToken')}</span>}</span>
      {sub ?? (site.name !== site.domain && <span className={s.siteUrl}>{site.domain}</span>)}
    </span>
    {end}
  </div>;
}

/**
 * 网站 (under 网页互动): the sites Chrome allows Palside to read and change, each opening its detail, then 添加网站 and, last and
 * quietest, 允许所有网站. Once every site is allowed the list is one row, 所有网站; the sites added one by one come back when it is removed.
 * A site revoked in Chrome leaves the list by itself.
 */
export function SitesSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const { all, hosts } = allowedSites(c, grants);
  return <div className={s.page}>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('common.error')}</InlineFeedback>}
    <SettingGroup title={t('extension.access.sites')}>
      {all && <button type="button" className={s.siteButton} onClick={() => c.openSite('all')}>
        <SiteRow site={{ id: 'all', name: t('extension.sites.allSites'), domain: '*' }} sub={<span className={s.siteUrl}>{t('extension.privacy.allowed')}</span>} end={<ChevronRight className={s.chevron} size={15} aria-hidden="true" />} />
      </button>}
      {!all && hosts.map(host => <button key={host} type="button" className={s.siteButton} onClick={() => c.openSite(host)}>
        <SiteRow site={siteOf(c, host)} end={<ChevronRight className={s.chevron} size={15} aria-hidden="true" />} />
      </button>)}
      {!all && !hosts.length && <p className={s.empty}>{t('extension.sites.empty')}</p>}
      {!all && <button type="button" className={s.addRow} onClick={() => addSite(c)}><span className={s.addMark} aria-hidden="true"><Plus size={14} /></span>{t('extension.sites.add')}</button>}
      {c.live && !all && <button type="button" className={s.addRow} aria-haspopup="dialog" onClick={() => setSocialUi({ allSites: true })}><span className={s.addMark} aria-hidden="true"><Globe2 size={13} /></span>{t('extension.sites.allowAll')}</button>}
    </SettingGroup>
  </div>;
}

/** 网站详情: the site, 代币数据 where the site has a token profile, then 移除网站. A site that stops being allowed leaves the page. */
export function SiteDetail({ c, host }: { c: PalsideController; host: string }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const all = host === 'all';
  const site = all ? { id: 'all', name: t('extension.sites.allSites'), domain: '*' } : siteOf(c, host);
  const allowed = all ? grants.broad : siteAllowed(c, grants, host);
  const back = useRef(c.back);
  useEffect(() => { back.current = c.back; });
  const gone = grants.ready && !allowed;
  useEffect(() => { if (gone) back.current(); }, [gone]);
  // The notice outlives this page. Removing broad access preserves individually added sites.
  const remove = () => {
    if (!all) { c.back(); c.removeSite(host); return; }
    c.setConfirmation({ title: uiMessage('extension.sites.removeAllTitle'), description: uiMessage('extension.sites.removeAllDescription'), action: uiMessage('extension.sites.removeAll'), danger: true, confirm: () => { c.back(); c.removeSite(host); } });
  };
  return <div className={s.page}>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('common.error')}</InlineFeedback>}
    <div className={`${s.card} ${s.hero}`}>
      {all ? <span className={s.allMark} aria-hidden="true"><Globe2 size={20} /></span> : <SiteLogo site={site} size="lg" />}
      <span className={s.heroText}><strong>{site.name}</strong>
        {all ? <span className={s.siteUrl}>{t('extension.privacy.allowed')}</span>
          : <Tooltip content={t('extension.web.openSite', { host })}><a className={s.siteUrl} href={`https://${host}/`} target="_blank" rel="noreferrer">{host}</a></Tooltip>}
      </span>
    </div>
    {!all && siteTags(host).profile && <SettingGroup>
      <div className={s.row}><span className={s.icon} aria-hidden="true"><Coins size={16} /></span>
        <Switch className={settingRows.switch} label={t('extension.sites.tokenData')} help={{ label: t('extension.settings.aboutFeature', { name: t('extension.sites.tokenData') }), content: t('extension.sites.tokenDataHint') }} checked={!c.tokenOff.includes(host)} onChange={event => c.setTokenData(host, event.currentTarget.checked)} />
      </div>
    </SettingGroup>}
    <SettingDanger onClick={remove}>{t(all ? 'extension.sites.removeAll' : 'extension.sites.remove')}</SettingDanger>
  </div>;
}
