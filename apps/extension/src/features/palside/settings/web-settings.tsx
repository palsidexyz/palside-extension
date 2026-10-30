'use client';
import { Button } from '@palside/ui/button';
import { errorMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import { Ban, EyeOff, UserPlus } from 'lucide-react';
import { Switch } from '@palside/ui/switch';
import { defaultDanmakuSettings, type DanmakuSettings } from '../../../runtime/browser/page-protocol';
import type { InteractionFeature } from '../../../domain/annotations/interaction';
import { CountText } from '../ui/motion-details';
import { DanmakuIcon, featureIcons } from '../ui/icons';
import { SignalOptions } from './signal-settings';
import { SettingControl, SettingGroup, SettingItem, settingRows } from './setting-rows';
import { Range, Seg, Sub, Tabs } from '../ui/sub-rows';
import { setSocialUi, useSocialUi, type SettingsTab } from '../annotations/social-state';
import d from '../rooms/danmaku.module.css';
import type { PalsideController } from '../app/use-palside';
import s from '../app/pages.module.css';

/** 互动选项: one tab per feature. Each opens on its own switch; what draws on web pages under it greys out, saying why, while 网页互动 is off. */
export function InteractionSettings({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const chosen = useSocialUi().settingsTab ?? 'danmaku';
  const tab = chosen === 'danmaku' && !c.live ? 'signal' : chosen;
  const tabs: [SettingsTab, ReactNode][] = [
    ['danmaku', <><DanmakuIcon size={15} />{t('extension.room.name')}</>],
    ['signal', <>{featureIcons.signal()}{t('extension.web.signal')}</>],
    ['sticky', <>{featureIcons.sticky()}{t('extension.web.sticky')}</>],
  ];
  return <div className={s.page}>
    <div className={d.settingsTabs}><Tabs id="interaction" label={t('extension.settings.interactionOptions')} value={tab} tabs={c.live ? tabs : tabs.slice(1)} onChange={settingsTab => setSocialUi({ settingsTab })} /></div>
    <div role="tabpanel" id="interaction-panel" aria-labelledby={`interaction-tab-${tab}`} className={s.page}>
      {tab === 'danmaku' && c.live && <DanmakuTab c={c} />}
      {tab === 'signal' && <FeatureTab c={c} feature="signal"><div className={s.options}><SignalOptions c={c} /></div></FeatureTab>}
      {tab === 'sticky' && <FeatureTab c={c} feature="sticky"><HiddenNotes c={c} /></FeatureTab>}
    </div>
    {c.preferenceError && <p className={s.error} role="alert">{c.preferenceError}</p>}
  </div>;
}

/** 信号 or 便利贴: its switch, then its options — greyed while it is off, or while 网页互动 is. */
function FeatureTab({ c, feature, children }: { c: PalsideController; feature: InteractionFeature; children: ReactNode }) {
  const t = useTranslations();
  const on = c.interaction[feature];
  const set = (event: ChangeEvent<HTMLInputElement>) => { void c.setInteraction({ [feature]: event.currentTarget.checked }).catch(() => {}); };
  return <>
    <SettingGroup>
      <SettingControl icon={featureIcons[feature]()}><Switch className={settingRows.switch} label={t(`extension.web.${feature}`)} checked={on} onChange={set} /></SettingControl>
    </SettingGroup>
    <SettingGroup title={!c.web.interact ? t('extension.settings.interactOff') : undefined} dim={!c.web.interact || !on}>{children}</SettingGroup>
  </>;
}

function HiddenNotes({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const hidden = c.live?.state.preferences.hiddenStickies?.length ?? 0;
  return <SettingItem icon={<EyeOff size={16} />} title={t('extension.web.hiddenNotes')} value={hidden}
    end={hidden > 0 ? <Button size="sm" variant="quiet" onClick={() => void c.run('preferences', { accountId: c.data.self, hiddenStickies: [] })}>{t('extension.web.showAll')}</Button> : undefined} />;
}

/**
 * 弹幕: its switch (the rooms themselves — reading and sending in the panel), then 在网页上显示 — the same 弹幕 crossing the page, with
 * its look — which needs 网页互动, and the strangers 弹幕 brings: who is blocked and whether they may invite you into a squad.
 */
function DanmakuTab({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const rooms = c.live?.state.rooms;
  const off = Boolean(c.live?.state.preferences.rooms?.off);
  const blocked = rooms?.blocked.length ?? 0;
  const why = off ? t('extension.settings.roomsOff') : !c.web.interact ? t('extension.settings.interactOff') : undefined;
  return <>
    <SettingGroup>
      <SettingControl icon={<DanmakuIcon size={16} />}>
        <Switch className={settingRows.switch} label={t('extension.room.name')} checked={!off} onChange={event => void c.run('room-settings', { off: !event.currentTarget.checked })} />
      </SettingControl>
    </SettingGroup>
    <SettingGroup title={t('extension.settings.onPages')} aside={why} dim={Boolean(why)}><DanmakuStyle c={c} /></SettingGroup>
    <SettingGroup title={t('extension.settings.groupStrangers')} dim={off}>
      <SettingItem icon={<Ban size={16} />} title={t('extension.room.blocked')} value={blocked ? <CountText text={t('extension.dynamic.peopleCount', { count: blocked })} value={blocked} /> : t('extension.room.blockedNone')} onClick={() => c.go('blocked')} />
      <SettingControl icon={<UserPlus size={16} />}>
        <Switch className={settingRows.switch} label={t('extension.settings.acceptInvites')} checked={rooms?.acceptInvites ?? true} onChange={event => void c.run('invite-settings', { accept: event.currentTarget.checked })} />
      </SettingControl>
    </SettingGroup>
  </>;
}

// The page's 20/24/28px, scaled to the preview's width.
const previewSize = { sm: 14, md: 16, lg: 19 } as const;
/** The preview draws as many lines as the density allows, in the lanes of the chosen area. */
const previewLines = ['sampleA', 'sampleB', 'sampleC', 'sampleD'] as const;
const previewCount = { low: 2, mid: 3, high: 4 } as const;
const previewLanes = { top: [6, 30, 54, 6], chart: [40, 66, 92, 40], full: [8, 40, 72, 100] } as const;
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
      <Sub label={t('extension.style.area')}><Seg label={t('extension.style.area')} value={danmaku.area} options={[['chart', t('extension.style.chart')], ['top', t('extension.style.top')], ['full', t('extension.style.full')]]} onChange={area => set({ area })} /></Sub>
      <Sub label={t('extension.overlay.speed')}><Seg label={t('extension.overlay.speed')} value={danmaku.speed} options={[[110, t('extension.overlay.slow')], [144, t('extension.overlay.medium')], [190, t('extension.overlay.fast')]]} onChange={speed => set({ speed })} /></Sub>
      <Sub label={t('extension.overlay.opacity')}><Range label={t('extension.overlay.opacity')} min={30} max={100} value={danmaku.opacity} onChange={opacity => set({ opacity })} /></Sub>
  </div>;
}
