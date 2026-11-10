'use client';
import { errorMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import type { CSSProperties, ReactNode } from 'react';
import { Ban, ChevronRight, Layers, UserPlus } from 'lucide-react';
import { Switch } from '@palside/ui/switch';
import { useSavingSwitch } from '../ui/use-saving-switch';
import { defaultDanmakuSettings, type DanmakuSettings } from '../../../runtime/browser/page-protocol';
import { CountText } from '../ui/motion-details';
import { DanmakuIcon, featureIcons } from '../ui/icons';
import { ChartOptions, SignalOptions } from './signal-settings';
import { ALL_SITES, allSites, siteFeatures, type SiteFeature } from '../../../domain/annotations/interaction';
import { SettingControl, SettingItem, settingRows } from './setting-rows';
import { Range, Seg, Sub } from '../ui/sub-rows';
import { setSocialUi, useSocialUi } from '../annotations/social-state';
import d from '../rooms/danmaku.module.css';
import type { PalsideController } from '../app/use-palside';
import s from '../app/pages.module.css';
import w from './web-settings.module.css';

/**
 * 网页互动: the master switch heads the page, for every site; under it 弹幕, 信号 and 共享画线 are one card each — its name and its
 * switch for every site, with its options opening in place under the name, one card at a time. Master off, nothing runs on any page and
 * the cards grey; a feature off here is off on every site and leaves the site sheets, while each site keeps its own choice for when it
 * comes back. 弹幕's card needs the service, so it waits while offline.
 */
export function InteractionSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const all = allSites(c.siteInteraction);
  const open = useSocialUi().settingsTab;
  const features = siteFeatures.filter(feature => feature !== 'danmaku' || c.live);
  return <div className={s.page}>
    <div className={w.master} data-on={all.on || undefined}>
      <span className={w.masterIcon} aria-hidden="true"><Layers size={20} /></span>
      <strong className={w.masterName}>{t('extension.settings.interaction')}</strong>
      <Switch hideLabel label={t('extension.settings.interaction')} checked={all.on} onChange={event => void c.setSite(ALL_SITES, { on: event.currentTarget.checked })} />
    </div>
    <div className={w.cards} data-dim={!all.on || undefined}>
      {features.map(feature => <FeatureCard key={feature} c={c} feature={feature} open={open === feature} />)}
    </div>
    {c.preferenceError && <p className={s.error} role="alert">{c.preferenceError}</p>}
  </div>;
}

/** One feature's card: the name opens its options (closing any other), the switch turns it on or off for every site. */
function FeatureCard({ c, feature, open }: { c: PalsideController; feature: SiteFeature; open: boolean }) {
  const t = useTranslations();
  const all = allSites(c.siteInteraction);
  const on = all.on && all[feature];
  const name = t(feature === 'danmaku' ? 'extension.room.name' : `extension.web.${feature}`);
  const panel = `interaction-${feature}`;
  const icon: ReactNode = feature === 'danmaku' ? <DanmakuIcon size={16} /> : featureIcons[feature]();
  return <section className={w.card} data-open={open || undefined} aria-label={name}>
    <div className={w.head}>
      <button type="button" className={w.toggle} aria-expanded={open} aria-controls={panel} disabled={!all.on} onClick={() => setSocialUi({ settingsTab: open ? undefined : feature })}>
        <span className={w.icon} aria-hidden="true">{icon}</span><span className={w.name}>{name}</span><ChevronRight size={15} className={w.chevron} aria-hidden="true" />
      </button>
      <Switch hideLabel label={name} checked={on} disabled={!all.on} onChange={event => void c.setSite(ALL_SITES, { [feature]: event.currentTarget.checked })} />
    </div>
    <div id={panel} className={w.body} inert={!open || !all.on}>
      <div className={w.inner}>
        {feature === 'danmaku' ? <DanmakuOptions c={c} on={on} />
          : <div className={s.options} data-dim={!on || undefined}>{feature === 'signal' ? <SignalOptions c={c} /> : <ChartOptions c={c} />}</div>}
      </div>
    </div>
  </section>;
}

/**
 * 弹幕's options: 在网页上显示 — how they cross the page, greyed while 弹幕 is off on pages or not joined at all — then 参与弹幕 (the rooms
 * themselves: reading and sending in the panel) and the strangers it brings: who is blocked and whether they may invite you into a squad.
 */
function DanmakuOptions({ c, on }: { c: PalsideController; on: boolean }) {
  const t = useTranslations();
  const rooms = c.live?.state.rooms;
  const off = Boolean(c.live?.state.preferences.rooms?.off);
  const joined = useSavingSwitch(!off);
  const invites = useSavingSwitch(rooms?.acceptInvites ?? true);
  const blocked = rooms?.blocked.length ?? 0;
  return <>
    <div className={w.section} data-dim={!on || off || undefined} inert={!on || off}>
      <span className={w.label}>{t('extension.settings.onPages')}</span>
      <DanmakuStyle c={c} />
    </div>
    <div className={w.rows}>
      <SettingControl icon={<DanmakuIcon size={16} />}>
        <Switch className={settingRows.switch} label={t('extension.settings.joinRooms')} checked={joined.checked} pending={joined.pending} refused={joined.refused} onChange={event => { const join = event.currentTarget.checked; void joined.save(join, async () => await c.run('room-settings', { off: !join }) !== undefined); }} />
      </SettingControl>
      <div className={w.strangers} data-dim={off || undefined} inert={off}>
        <SettingItem icon={<Ban size={16} />} title={t('extension.room.blocked')} value={blocked ? <CountText text={t('extension.dynamic.peopleCount', { count: blocked })} value={blocked} /> : t('extension.room.blockedNone')} onClick={() => c.go('blocked')} />
        <SettingControl icon={<UserPlus size={16} />}>
          <Switch className={settingRows.switch} label={t('extension.settings.acceptInvites')} checked={invites.checked} pending={invites.pending} refused={invites.refused} onChange={event => { const accept = event.currentTarget.checked; void invites.save(accept, async () => await c.run('invite-settings', { accept }) !== undefined); }} />
        </SettingControl>
      </div>
    </div>
  </>;
}

// The page's 20/24/28px, scaled to the preview's width.
const previewSize = { sm: 14, md: 16, lg: 19 } as const;
/** The preview draws as many lines as the density allows, in the lanes of the chosen area. */
const previewLines = ['sampleA', 'sampleB', 'sampleC', 'sampleD'] as const;
const previewCount = { low: 2, mid: 3, high: 4 } as const;
// Lane tops within the 132px preview, so each area shows lines only in its share of the height.
const previewLanes = { 25: [4, 4, 18, 18], 50: [6, 6, 36, 36], 75: [8, 40, 72, 8], 100: [8, 40, 72, 100] } as const;
const previewLeft = [20, 150, 80, 210] as const;

/** How 弹幕 look on pages: a still preview, then 数量, 字号, 位置, 速度 and 透明度. */
function DanmakuStyle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const live = c.live;
  const danmaku = live?.danmaku ?? defaultDanmakuSettings;
  const set = (settings: Partial<DanmakuSettings>) => live?.command('danmaku-settings', { settings }).catch(error => { c.setNotice(errorMessage(error)); return false; });
  return <div className={s.options}>
    <div className={d.preview} aria-hidden="true" style={{ '--dm-size': `${previewSize[danmaku.size]}px`, '--dm-alpha': danmaku.opacity / 100 } as CSSProperties}>
      <svg viewBox="0 0 300 120" preserveAspectRatio="none">{Array.from({ length: 20 }, (_, i) => { const y = 90 - i * 2.6 - Math.sin(i / 2) * 9; return <rect key={i} x={6 + i * 14.5} y={y - 14} width="7" height={14 + (i % 3) * 5} fill={i % 4 ? '#3FB27F' : '#E5566B'} />; })}</svg>
      {previewLines.slice(0, previewCount[danmaku.density]).map((line, index) => <span key={line} style={{ top: previewLanes[danmaku.area][index], left: previewLeft[index] }}>{t(`extension.style.${line}`)}</span>)}
    </div>
      <Sub label={t('extension.style.density')}><Seg label={t('extension.style.density')} value={danmaku.density} options={[['low', t('extension.style.low')], ['mid', t('extension.style.mid')], ['high', t('extension.style.high')]]} onChange={density => set({ density })} /></Sub>
      <Sub label={t('extension.center.fontSize')}><Seg label={t('extension.center.fontSize')} value={danmaku.size} options={[['sm', t('extension.center.small')], ['md', t('extension.center.medium')], ['lg', t('extension.center.large')]]} onChange={size => set({ size })} /></Sub>
      <Sub label={t('extension.style.area')}><Seg label={t('extension.style.area')} value={danmaku.area} options={[[25, t('extension.style.quarter')], [50, t('extension.style.half')], [75, t('extension.style.threeQuarters')], [100, t('extension.style.full')]]} onChange={area => set({ area })} /></Sub>
      <Sub label={t('extension.overlay.speed')}><Seg label={t('extension.overlay.speed')} value={danmaku.speed} options={[[110, t('extension.overlay.slow')], [144, t('extension.overlay.medium')], [190, t('extension.overlay.fast')]]} onChange={speed => set({ speed })} /></Sub>
      <Sub label={t('extension.overlay.opacity')}><Range label={t('extension.overlay.opacity')} min={30} max={100} value={danmaku.opacity} onChange={opacity => set({ opacity })} /></Sub>
  </div>;
}
