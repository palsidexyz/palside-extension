'use client';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, Globe2, Layers, Plus } from 'lucide-react';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Switch } from '@palside/ui/switch';
import { Tooltip } from '@palside/ui/tooltip';
import { SiteLogo } from '../assets/site-logo';
import { siteOf, siteTags, type Site } from './site-catalog';
import { addSite } from './access';
import { setSocialUi } from '../annotations/social-state';
import { SettingControl, SettingDanger, SettingGroup, settingRows } from './setting-rows';
import { siteFeatures, siteInteraction, type SiteFeature } from '../../../domain/annotations/interaction';
import { roomsOn } from '../rooms/rooms';
import { SiteFeatureTiles } from './site-feature-tiles';
import { allowedSites, siteAllowed, useGrants } from './use-grants';
import type { PalsideController } from '../app/use-palside';
import s from '../app/pages.module.css';
import motion from './settings.module.css';

/** The features that run on a site, in the site sheet's order: 弹幕、信号, or 已关闭. 弹幕 counts only while 弹幕 itself is on. */
export function useSiteSummary(c: PalsideController) {
  const t = useTranslations();
  return (host: string) => {
    const setting = siteInteraction(c.siteInteraction, host);
    if (!setting.on) return t('extension.settings.off');
    const names = siteFeatures.filter(feature => setting[feature] && (feature !== 'danmaku' || roomsOn(c))).map(feature => featureName(t, feature));
    return names.join(t('extension.access.separator')) || t('extension.access.none');
  };
}

function featureName(t: ReturnType<typeof useTranslations>, feature: SiteFeature) {
  return t(feature === 'danmaku' ? 'extension.room.name' : `extension.web.${feature}`);
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
  const summary = useSiteSummary(c);
  return <div className={s.page}>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('extension.settings.permissionsReadFailed')}</InlineFeedback>}
    <SettingGroup title={t('extension.access.sites')}>
      {all && <button type="button" className={s.siteButton} onClick={() => c.openSite('all')}>
        <SiteRow site={{ id: 'all', name: t('extension.sites.allSites'), domain: '*' }} sub={<span className={s.siteUrl}>{t('extension.privacy.allowed')}</span>} end={<ChevronRight className={s.chevron} size={15} aria-hidden="true" />} />
      </button>}
      {!all && hosts.map(host => <button key={host} type="button" className={s.siteButton} onClick={() => c.openSite(host)}>
        <SiteRow site={siteOf(c, host)} sub={<span className={s.siteUrl}>{summary(host)}</span>} end={<ChevronRight className={s.chevron} size={15} aria-hidden="true" />} />
      </button>)}
      {!all && !hosts.length && <p className={s.empty}>{t('extension.sites.empty')}</p>}
      {!all && <button type="button" className={s.addRow} onClick={() => addSite(c)}><span className={s.addMark} aria-hidden="true"><Plus size={14} /></span>{t('extension.sites.add')}</button>}
      {c.live && !all && <button type="button" className={s.addRow} aria-haspopup="dialog" onClick={() => setSocialUi({ allSites: true })}><span className={s.addMark} aria-hidden="true"><Globe2 size={13} /></span>{t('extension.sites.allowAll')}</button>}
    </SettingGroup>
  </div>;
}

/** 网站详情: the site, its 网页互动 and features (the same as the site sheet), 代币数据 where the site has a token profile, then 移除网站. A site that stops being allowed leaves the page. */
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
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('extension.settings.permissionsReadFailed')}</InlineFeedback>}
    <div className={`${s.card} ${s.hero}`}>
      {all ? <span className={s.allMark} aria-hidden="true"><Globe2 size={20} /></span> : <SiteLogo site={site} size="lg" />}
      <span className={s.heroText}><strong>{site.name}</strong>
        {all ? <span className={s.siteUrl}>{t('extension.privacy.allowed')}</span>
          : <Tooltip content={t('extension.web.openSite', { host })}><a className={s.siteUrl} href={`https://${host}/`} target="_blank" rel="noreferrer">{host}</a></Tooltip>}
      </span>
    </div>
    {!all && <SiteFeatures c={c} host={host} />}
    <SettingDanger onClick={remove}>{t(all ? 'extension.sites.removeAll' : 'extension.sites.remove')}</SettingDanger>
  </div>;
}

/** 网页互动 on one allowed site, with its 弹幕, 信号 and 便利贴 tiles under the switch — the same card as the site sheet's. */
function SiteFeatures({ c, host }: { c: PalsideController; host: string }) {
  const t = useTranslations();
  const setting = siteInteraction(c.siteInteraction, host);
  return <SettingGroup>
    <SettingControl icon={<Layers size={16} />}>
      <Switch className={settingRows.switch} label={t('extension.settings.interaction')} checked={setting.on} onChange={event => void c.setSite(host, { on: event.currentTarget.checked })} />
    </SettingControl>
    <SiteFeatureTiles c={c} host={host} live={setting.on} className={motion.siteTiles} />
  </SettingGroup>;
}
