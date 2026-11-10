'use client';
import { MINUTE_MS } from '@palside/shared/units';
import { errorMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { CountText } from '../ui/motion-details';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Copy, Info, MessageSquarePlus, Star } from 'lucide-react';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { Tooltip } from '@palside/ui/tooltip';
import { personFor } from '../../../domain/account/model';
import { relatedMessages, viewingKey, type Viewing } from '../../../domain/assets/model';
import { firstSharer, viewAsset } from '../../../domain/annotations/social';
import { setSocialUi } from '../annotations/social-state';
import { isFavoritePage, toggleFavoritePage } from '../favorites/favorites';
import { DanmakuIcon } from '../ui/icons';
import { Action, PersonAvatar, Token } from '../ui/primitives';
import { SiteLogo } from './site-logo';
import { siteAt, type Site } from '../settings/site-catalog';
import { Faces } from '../rooms/danmaku-view';
import { pageIssue } from '../feedback/session-notice';
import { openRoom, openTokenSite, roomKeyFor, roomView, roomsOn, tokenSiteChoice, useRoomRead } from '../rooms/rooms';
import { samePage } from '../../../domain/annotations/interaction';
import type { PalsideController } from '../app/use-palside';
import s from './asset-discussion.module.css';
import { TokenName } from './token-name';
import { liveView,tokenStats } from './token-data';

/** "3 天前" style distance used by the discussion and the reminder cards. */
export function relativeTime(at: number, locale: string, now = Date.now()) {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round((at - now) / MINUTE_MS);
  if (Math.abs(minutes) < 60) return format.format(Math.min(0, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? format.format(hours, 'hour') : format.format(Math.round(hours / 24), 'day');
}

/** Rows of each 小队里 group shown before 全部 N. */
const GROUP_ROWS = 2;

/** The page a 详情 is about: a token known only from the service opens on the site most people use for it. */
function detailView(c: PalsideController, asset: Viewing) {
  const roomKey = roomsOn(c) ? roomKeyFor(asset) : undefined;
  const rooms = c.live?.state.rooms;
  const summary = roomKey ? tokenStats(c, roomKey) : undefined;
  // The site most participants use is the room's public vote, not part of the display record.
  const participantSite = roomKey ? (rooms?.current?.key === roomKey ? rooms.current : rooms?.summaries[roomKey])?.site : undefined;
  const known = asset.kind === 'asset' ? [...new Map(c.data.views.filter(v => viewingKey(v) === viewingKey(asset) && v.url).map(v => [v.url, v])).values()] : asset.url ? [asset] : [];
  const profiled = roomKey && !known.length ? roomView(c, roomKey) : undefined;
  return { roomKey, summary, participantSite, sources: profiled?.url ? [profiled] : known, view: liveView(c, profiled ?? asset) };
}

/** 详情's title bar: what the name and icon do not prove, and 收藏. */
export function AssetHeaderActions({ c, asset }: { c: PalsideController; asset: Viewing }) {
  const t = useTranslations();
  const { view } = detailView(c, asset);
  const favorite = isFavoritePage(c, view.url);
  return <span className={s.headerActions}>
    {view.kind === 'asset' && <Tooltip content={t('extension.copy.assetDisclaimer')}><Action label={t('extension.copy.assetDisclaimerLabel')}><Info /></Action></Tooltip>}
    <Action label={favorite ? t('extension.web.saved') : t('extension.web.save')} aria-pressed={favorite} className={favorite ? s.starOn : undefined} onClick={() => toggleFavoritePage(c, view)}><Star /></Action>
  </span>;
}

/**
 * 详情: identity on one line with who is watching, one row of equal actions, then a rule — above it what you can do, below it what
 * people say: the current team's 聊天.
 */
export function AssetDiscussion({ c, asset, onJump }: { c: PalsideController; asset: Viewing; onJump: (id: string) => void }) {
  const t = useTranslations();
  const key = viewAsset(asset);
  const live = c.live, page = live?.page;
  const { roomKey, summary, participantSite, sources, view } = detailView(c, asset);
  const read = useRoomRead(c, 'summary', roomKey);
  const current = Boolean(page?.url && (samePage(page.url, asset.url) || key && page.asset === key));
  const site = siteAt(c, view.url, view.kind === 'website' ? view.logo : undefined);
  const [sharing, setSharing] = useState(false);
  const latest = useRef(c);
  useEffect(() => { latest.current = c; }, [c]);
  const open = (target: Viewing) => { if (live) void live.openPage(target.url).catch(error => c.setNotice(errorMessage(error))); else window.open(target.url, '_blank', 'noopener'); };
  const short = view.address ? `${view.address.slice(0, 6)}…${view.address.slice(-4)}` : undefined;
  async function share() {
    if (!c.canWrite || sharing) return;
    if (view.kind === 'asset' || !live) { c.attach({ kind: 'asset', assetId: view.id, view }); return; }
    const account = c.data.self, team = c.current;
    setSharing(true);
    try {
      const result = await live.command('link-card', { url: view.url });
      if (latest.current.data.self === account && result.attachment) latest.current.attach(result.attachment, team);
    } catch (error) { c.setNotice(errorMessage(error)); }
    finally { setSharing(false); }
  }
  // Tokens list every site that can show them, default first; other pages keep the sources seen for them.
  const choice = tokenSiteChoice(c, view, participantSite);
  const here = (url: string) => Boolean(current && samePage(url, page?.url));
  const targets: OpenTarget[] = choice.site
    ? [choice.site, ...choice.sites.filter(site => site.id !== choice.site!.id)].filter(site => !here(site.url)).map(site => ({ key: site.id, name: site.name, site, go: () => openTokenSite(c, site) }))
    : choice.sites.length ? [] : sources.filter(source => !here(source.url)).map(source => { const site = siteAt(c, source.url, source.kind === 'website' ? source.logo : undefined); return { key: source.url, name: site?.name ?? source.source, site, go: () => open(source) }; });
  const acts = Boolean(roomKey || c.canWrite || targets.length);
  // Who is watching is live: without the service they are not shown at all rather than shown stale.
  const reachable = !pageIssue(c, 'service');
  return <div className={s.detail}>
    <header className={s.identity}>
      {view.kind === 'asset' ? <Token view={view} size="lg" /> : <span className={s.pageLogo}><SiteLogo site={site} /></span>}
      <div className={s.names}>
        <h2><TokenName c={c} view={view} /></h2>
        <p>{view.kind === 'asset'
          ? <>{view.chain && <span>{view.chain}</span>}{view.chain && short && <span aria-hidden="true">·</span>}{short && <Tooltip content={t('extension.copy.copyContractAddress')}><button type="button" className={s.address} aria-label={t('extension.copy.copyContractAddress')} onClick={() => void c.copy(view.address!)}>{short}<Copy size={12} aria-hidden="true" /></button></Tooltip>}</>
          : <span>{site?.name ?? view.source}</span>}</p>
      </div>
      {reachable && roomKey && summary && <button type="button" className={s.watch} onClick={() => { setSocialUi({ people: roomKey }); c.go('room-people'); }}><Faces c={c} people={summary.faces} /><span><CountText text={t('extension.room.watching', { count: summary.count })} value={summary.count} /></span></button>}
    </header>
    {acts && <div className={s.actions}>
      {roomKey && <button type="button" className={s.action} onClick={() => openRoom(c, roomKey)}><DanmakuIcon size={16} /><span>{t('extension.room.name')}</span></button>}
      {c.canWrite && <button type="button" className={s.action} disabled={sharing} onClick={() => void share()}><MessageSquarePlus size={16} /><span>{t('extension.current.share')}</span></button>}
      <OpenAction targets={targets} />
    </div>}
    {reachable && roomKey && read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    {live && c.team.joined && <TeamRecords c={c} asset={view} onJump={onJump} />}
  </div>;
}

type OpenTarget = { key: string; name: string; site?: Site; go: () => void };

/** 打开: one site opens at once; several share one menu, so the row never grows or wraps. */
function OpenAction({ targets }: { targets: OpenTarget[] }) {
  const t = useTranslations();
  const only = targets.length === 1 ? targets[0] : undefined;
  if (only) return <button type="button" className={s.action} aria-label={t('extension.dynamic.openSource', { name: only.name })} onClick={only.go}><SiteLogo site={only.site} size="xs" /><span>{t('extension.top.open')}</span></button>;
  if (!targets.length) return null;
  return <Menu boundarySelector="[data-palside-app]" align="end">
    <MenuTrigger asChild><button type="button" className={s.action}><span className={s.logos} aria-hidden="true">{targets.slice(0, 3).map(target => <SiteLogo key={target.key} site={target.site} size="xs" />)}</span><span>{t('extension.top.open')}</span><ChevronDown size={12} aria-hidden="true" /></button></MenuTrigger>
    <MenuContent aria-label={t('extension.top.open')}>
      {targets.map(target => <MenuItem key={target.key} icon={<SiteLogo site={target.site} size="xs" />} onClick={target.go}>{target.name}</MenuItem>)}
    </MenuContent>
  </Menu>;
}

/** 聊天 about this page, two rows until 全部 N; a group with nothing in it is not shown. */
function RecordGroup({ title, rows }: { title: string; rows: ReactNode[] }) {
  const t = useTranslations();
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  return <div className={s.group}>
    <h4>{title}{rows.length > GROUP_ROWS && <button type="button" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? t('extension.discussion.fewer') : <CountText text={t('extension.discussion.all', { count: rows.length })} value={rows.length} />}</button>}</h4>
    <div className={s.records}>{all ? rows : rows.slice(0, GROUP_ROWS)}</div>
  </div>;
}

/** The current team: its name beside who shared first, and what was said. */
function TeamRecords({ c, asset, onJump }: { c: PalsideController; asset: Viewing; onJump: (id: string) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const key = viewAsset(asset);
  const first = key ? firstSharer(c.currentMessages, key) : undefined;
  const said = key ? [...relatedMessages(c.currentMessages, asset.id, c.data.views)].reverse().filter(message => message.id !== first?.id) : [];
  const name = (id: string) => id === c.data.self ? t('extension.page.you') : personFor(c.people, id, t('common.member')).name;
  const row = (id: string, author: string, text: string, at: number, onClick: () => void) => <button key={id} type="button" className={s.recordRow} onClick={onClick}><PersonAvatar person={personFor(c.people, author, t('common.member'))} size="xs" /><span><b>{name(author)}</b>{text}</span><time>{relativeTime(at, locale, c.now)}</time></button>;
  return <section className={s.team} aria-label={t('extension.discussion.team')}>
    <h3 className={s.teamHead}><span>{c.team.name}</span>
      {first ? <span className={s.first}><PersonAvatar person={personFor(c.people, first.author, t('common.member'))} size="xs" /><span>{t.rich('extension.discussion.firstShared', { name: name(first.author), b: chunks => <b>{chunks}</b> })} · {relativeTime(first.timestamp ?? c.now, locale, c.now)}</span></span>
        : !said.length && <span className={s.first}><span>{t('extension.discussion.noDiscussion')}</span></span>}
    </h3>
    <RecordGroup title={t('extension.discussion.chat')} rows={said.map(message => row(message.id, message.author, message.text || t('extension.copy.tokenQuote'), message.timestamp ?? c.now, () => onJump(message.id)))} />
  </section>;
}
