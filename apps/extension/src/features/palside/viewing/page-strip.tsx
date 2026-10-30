'use client';
import { errorMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Highlighter, MapPin, MousePointer2, Pencil, TextSelect } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import { Tooltip } from '@palside/ui/tooltip';
import { type Viewing } from '../../../domain/assets/model';
import { pageScopeUrl, viewAsset } from '../../../domain/annotations/social';
import { captureSocialUi, returnToOrigin, setSocialUi, useSocialUi } from '../annotations/social-state';
import { shownStickyCount } from '../annotations/sticky-list';
import { DanmakuIcon } from '../ui/icons';
import { Keys, signalKeyName, WheelArt } from '../settings/signal-settings';
import { defaultSignalSettings, type WheelEntry } from '../../../runtime/annotations/signals';
import { CountText } from '../ui/motion-details';
import { PersonAvatar, Token } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import { openRoom, roomCount, roomKeyFor, roomsOn, tabView } from '../rooms/rooms';
import s from './page-strip.module.css';

/** The active tab owns page identity; shared views supply asset metadata only. */
export function currentPage(c: PalsideController): Viewing | undefined {
  const page = c.live?.page;
  const url = pageScopeUrl(page?.url);
  if (!url) return;
  const view = tabView(page);
  if (!view) return;
  const known = page?.asset ? c.data.views.find(item => viewAsset(item) === page.asset && pageScopeUrl(item.url) === url)
    ?? c.data.views.find(item => viewAsset(item) === page.asset) : undefined;
  return { ...view, url, ...(known ? { name: known.name, logo: known.logo, color: known.color, glyph: known.glyph } : {}) };
}

export function samePageViewers(c: PalsideController) {
  const url = pageScopeUrl(c.live?.page?.url);
  if (!c.live?.page?.interactive || !url) return [];
  return c.people.filter(person => person.id !== c.data.self && c.team.memberIds.includes(person.id) && c.data.views.some(view =>
    view.id === person.viewing && (view.kind === 'asset' || view.disclosure === 'page') && pageScopeUrl(view.url) === url));
}

/** 本页条: shown above the message box where 互动 runs, the token has 弹幕, or there is a page to return to. Page identity and who is here on the left; on the right
 *  the token's 弹幕, then 信号 / 便利贴 where 网页互动 runs. Those happen on the web page; the panel only holds what has to be typed or read. */
export function PageStrip({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const page = c.live?.page;
  const view = currentPage(c);
  // The page tools show only where 网页互动 actually runs: its rule, the switch and the site's access all hold.
  const on = Boolean(page?.interactive);
  const room = roomsOn(c) ? roomKeyFor(view) : undefined;
  const signal = c.interaction.signal, sticky = c.interaction.sticky;
  const back = useReturn(c);
  if (!on && !room && !back || !page?.url || !view) return null;
  const viewers = samePageViewers(c);
  const notes = shownStickyCount(c, { url: page.url });
  return <div className={s.strip}>
    {back && <ReturnChip c={c} view={back} />}
    <Tooltip content={t('extension.current.detail', { name: view.name })}><button type="button" className={s.identity} aria-label={t('extension.current.detail', { name: view.name })} onClick={() => c.selectAsset(view.id, view)}><Token view={view} size="sm" /><span className={s.name}>{view.name}</span></button></Tooltip>
    {viewers.length > 0 && <Tooltip content={t('extension.current.viewers', { names: viewers.map(person => person.name).join('、') })}><span className={s.faces} tabIndex={0} role="img" aria-label={t('extension.current.viewers', { names: viewers.map(person => person.name).join('、') })}>{viewers.slice(0, 3).map(person => <PersonAvatar key={person.id} person={person} size="xs" />)}</span></Tooltip>}
    <span className={s.tools}>
      {room && <RoomChip c={c} roomKey={room} name={view.name} />}
      {on && signal && <SignalGuide c={c} />}
      {on && sticky && <StickyGuide c={c} notes={notes} />}
    </span>
  </div>;
}

/** 弹幕 on 本页条: the token's public messages and how many people are watching it. */
function RoomChip({ c, roomKey, name }: { c: PalsideController; roomKey: string; name: string }) {
  const t = useTranslations();
  const count = roomCount(c, roomKey);
  const label = t('extension.room.chip', { name, count });
  return <Tooltip content={label}><button type="button" className={s.roomChip} aria-label={label} onClick={() => openRoom(c, roomKey)}><DanmakuIcon size={15} /><span>{count ? <CountText text={t('extension.room.chipCount', { count })} value={count} /> : t('extension.room.name')}</span></button></Tooltip>;
}

/** The token page left by opening another one from the panel, while the tab is still on the page opened. */
function useReturn(c: PalsideController) {
  const { returnTo } = useSocialUi();
  if (!returnTo || pageScopeUrl(c.live?.page?.url) !== returnTo.target) return;
  return currentPage({ ...c, live: c.live && { ...c.live, page: returnTo.origin } });
}

/** 回到上一个币: one level back, always here in the 本页条 — it belongs to the page, not to the chat top. */
function ReturnChip({ c, view }: { c: PalsideController; view: Viewing }) {
  const t = useTranslations();
  const { returnTo } = useSocialUi();
  if (!returnTo) return null;
  const label = t('extension.top.back', { name: view.name });
  return <Tooltip content={label}><button type="button" className={s.returnChip} aria-label={label} onClick={() => { const session = captureSocialUi(); if (c.live) void returnToOrigin(c.live).catch(error => { if (session.current()) c.setNotice(errorMessage(error)); }); }}><ArrowLeft size={14} /><Token view={view} size="sm" /></button></Tooltip>;
}

/** 信号 and 便利贴 happen on the web page: their buttons show the gesture and lead to what can be changed — they never send from the panel. */
export function Guide({ icon, title, action, steps }: { icon: ReactNode; title: string; action: ReactNode; steps: [ReactNode, string][] }) {
  return <div className={s.guide}>
    <header className={s.guideHead}><span className={s.guideIcon} aria-hidden="true">{icon}</span><strong>{title}</strong>{action}</header>
    <ol className={s.steps}>{steps.map(([art, text], index) => <li key={index}><span className={s.art} aria-hidden="true">{art}</span><span>{text}</span></li>)}</ol>
  </div>;
}

/** A small still of the wheel: the user's own first slots, as on the page. */
function Wheel({ entries }: { entries: readonly WheelEntry[] }) {
  return <span className={s.wheel}>{entries.map((entry, index) => <WheelArt key={entry} entry={entry} style={{ ['--a' as string]: `${index * 45}deg` }} />)}</span>;
}

function GuideAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const { close } = usePopoverContext();
  return <Button size="sm" variant="surface" className={s.guideAction} onClick={() => { close(); onClick(); }}>{children}</Button>;
}

function SignalGuide({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const settings = c.live?.page?.signalSettings ?? defaultSignalSettings;
  return <Popover boundarySelector="[data-palside-app]" align="end">
    <PopoverTrigger asChild><IconButton size="sm" variant="quiet" className={s.guideTrigger} label={t('extension.web.signal')}><MapPin size={17} strokeWidth={1.7} /></IconButton></PopoverTrigger>
    <PopoverContent aria-label={t('extension.web.signal')} className={s.guidePopover}><Guide icon={<MapPin size={16} />} title={t('extension.web.signal')}
    action={<GuideAction onClick={() => { setSocialUi({ settingsTab: 'signal' }); c.go('interaction'); }}><Pencil size={13} />{t('extension.copy.edit')}</GuideAction>}
    steps={[
      [<><Keys value={settings.key} /><MousePointer2 size={15} /></>, t('extension.web.signalStep1', { key: signalKeyName(settings.key) })],
      [<Wheel key="w" entries={settings.wheel} />, t('extension.web.signalStep2')],
      [<MapPin key="p" size={18} />, t('extension.web.signalStep3')],
    ]} /></PopoverContent></Popover>;
}

function StickyGuide({ c, notes }: { c: PalsideController; notes: number }) {
  const t = useTranslations();
  const page = c.live?.page;
  const label = notes ? t('extension.sticky.openList', { count: notes }) : t('extension.web.sticky');
  return <span className={s.badged}><Popover boundarySelector="[data-palside-app]" align="end">
    <PopoverTrigger asChild><IconButton size="sm" variant="quiet" className={s.guideTrigger} label={label}><Highlighter size={17} strokeWidth={1.7} /></IconButton></PopoverTrigger>
    <PopoverContent aria-label={label} className={s.guidePopover}><Guide icon={<Highlighter size={16} />} title={t('extension.web.sticky')}
    action={<GuideAction onClick={() => { setSocialUi({ stickies: { asset: page?.asset, url: page?.url } }); }}>{notes ? <CountText text={t('extension.web.notesHere', { count: notes })} value={notes} /> : t('extension.web.notesNone')}<ChevronRight size={13} /></GuideAction>}
    steps={[
      [<TextSelect key="t" size={18} />, t('extension.web.stickyStep1')],
      [<span key="b" className={s.bubble}>{t('extension.sticky.add')}</span>, t('extension.web.stickyStep2')],
      [<mark key="m" className={s.mark}>Aa</mark>, t('extension.web.stickyStep3')],
    ]} /></PopoverContent></Popover>{notes > 0 && <small className={s.badge} aria-hidden="true">{notes}</small>}</span>;
}
