'use client';
import type { CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { siteFeatures, siteInteraction, type SiteFeature } from '../../../domain/annotations/interaction';
import { roomsOn } from '../rooms/rooms';
import { DanmakuIcon, featureIcons } from '../ui/icons';
import type { PalsideController } from '../app/use-palside';
import s from './site-feature-tiles.module.css';

/**
 * A site's 弹幕 (while 参与弹幕 is on), 信号 and 便利贴 as equal tiles under its 网页互动 switch, always shown. A lit tile runs on the
 * site; while 网页互动 is off (or Chrome has not allowed the site) every tile reads off and cannot be pressed, and switching back on
 * brings back the choice it had.
 */
export function SiteFeatureTiles({ c, host, live, className }: { c: PalsideController; host: string; live: boolean; className?: string }) {
  const t = useTranslations();
  const setting = siteInteraction(c.siteInteraction, host);
  const features = siteFeatures.filter(feature => feature !== 'danmaku' || roomsOn(c));
  const label = (feature: SiteFeature) => t(feature === 'danmaku' ? 'extension.room.name' : `extension.web.${feature}`);
  return <div className={`${s.tiles}${className ? ` ${className}` : ''}`} style={{ '--count': features.length } as CSSProperties} data-dim={!live || undefined}>
    {features.map(feature => <button key={feature} type="button" className={s.tile} aria-pressed={live && setting[feature]} disabled={!live}
      onClick={() => { void c.setSite(host, { [feature]: !setting[feature] }); }}>
      {feature === 'danmaku' ? <DanmakuIcon size={18} /> : featureIcons[feature]()}
      <span>{label(feature)}</span>
    </button>)}
  </div>;
}
