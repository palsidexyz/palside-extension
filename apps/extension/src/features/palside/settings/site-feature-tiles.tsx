'use client';
import type { CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { ALL_SITES, allSites, siteFeatures, siteInteraction, type SiteFeature } from '../../../domain/annotations/interaction';
import { DanmakuIcon, featureIcons } from '../ui/icons';
import type { PalsideController } from '../app/use-palside';
import s from './site-feature-tiles.module.css';

/**
 * A site's 弹幕 (while 弹幕 itself is on), 信号 and 共享画线 as equal tiles under its 网页互动 switch. A lit icon disc runs on the
 * site; while 网页互动 is off (or Chrome has not allowed the site) every tile reads off and cannot be pressed, and switching back on
 * brings back the choice it had. `ALL_SITES` draws the master tiles of 设置 › 网页互动; a feature switched off there leaves every site's sheet.
 */
export function SiteFeatureTiles({ c, host, live, className }: { c: PalsideController; host: string; live: boolean; className?: string }) {
  const t = useTranslations();
  const setting = siteInteraction(c.siteInteraction, host);
  const all = allSites(c.siteInteraction);
  const features = siteFeatures.filter(feature => host === ALL_SITES || all[feature]);
  if (!features.length) return null;
  const label = (feature: SiteFeature) => t(feature === 'danmaku' ? 'extension.room.name' : `extension.web.${feature}`);
  return <div className={`${s.tiles}${className ? ` ${className}` : ''}`} style={{ '--count': features.length } as CSSProperties} data-dim={!live || undefined}>
    {features.map(feature => <button key={feature} type="button" className={s.tile} aria-pressed={live && setting[feature]} disabled={!live}
      onClick={() => { void c.setSite(host, { [feature]: !setting[feature] }); }}>
      <span className={s.disc}>{feature === 'danmaku' ? <DanmakuIcon size={16} /> : featureIcons[feature]()}</span>
      <span className={s.name}>{label(feature)}</span>
    </button>)}
  </div>;
}
