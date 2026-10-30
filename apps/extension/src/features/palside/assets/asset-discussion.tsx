'use client';
import { errorMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { CountText } from '../ui/motion-details';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Copy, Highlighter, Info, MessageSquarePlus, Star } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Tooltip } from '@palside/ui/tooltip';
import { personFor } from '../../../domain/account/model';
import { relatedMessages, viewingKey, type Viewing } from '../../../domain/assets/model';
import { firstSharer, viewAsset } from '../../../domain/annotations/social';
import { Writer, visibleStickies } from '../annotations/sticky-list';
import { openWithReturn, setSocialUi } from '../annotations/social-state';
import { isFavoritePage, toggleFavoritePage } from '../favorites/favorites';
import { DanmakuIcon } from '../ui/icons';
import { PersonAvatar, Token } from '../ui/primitives';
import { SiteLogo } from './site-logo';
import { siteForUrl } from '../settings/site-catalog';
import { Faces } from '../rooms/danmaku-view';
import { StancePoll } from '../rooms/stance-poll';
import { openRoom, roomKeyFor, roomView, roomsOn, useRoomRead } from '../rooms/rooms';
import { pageScopeUrl } from '../../../domain/annotations/interaction';
import type { PalsideController } from '../app/use-palside';
import s from './asset-discussion.module.css';

/** "3 天前" style distance used by the discussion and the reminder cards. */
export function relativeTime(at: number, locale: string, now = Date.now()) {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return format.format(Math.min(0, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? format.format(hours, 'hour') : format.format(Math.round(hours / 24), 'day');
}

/** Rows of 小队里 shown before 全部 N. */
const TEAM_ROWS = 3;

/**
 * 详情, centred: who the page is (and, for a token, how many people watch it), the things to do with it — 弹幕 / 发到聊天 / 收藏 —,
 * where else it opens, the token's 看法, then what the current team said about it.
 */
export function AssetDiscussion({ c, asset, onJump }: { c: PalsideController; asset: Viewing; onJump: (id: string) => void }) {
  const t = useTranslations();
  const key = viewAsset(asset);
  const live = c.live, page = live?.page;
  const roomKey = roomsOn(c) ? roomKeyFor(asset) : undefined;
  const rooms = live?.state.rooms;
  const summary = roomKey ? rooms?.current?.key === roomKey ? rooms.current : rooms?.summaries[roomKey] : undefined;
  const read = useRoomRead(c, 'summary', roomKey);
  const current = Boolean(page?.url && (pageScopeUrl(page.url) === pageScopeUrl(asset.url) || key && page.asset === key));
  const known = asset.kind === 'asset' ? [...new Map(c.data.views.filter(v => viewingKey(v) === viewingKey(asset) && v.url).map(v => [v.url, v])).values()] : asset.url ? [asset] : [];
  // A token known only from the service opens on the site most people use for it.
  const profiled = roomKey && !known.length ? roomView(c, roomKey, summary?.profile) : undefined;
  const sources = profiled?.url ? [profiled] : known;
  const view = profiled ?? asset;
  const site = siteForUrl(view.url, c.sites);
  const sourceName = site?.name ?? view.source;
  const [sharing, setSharing] = useState(false);
  const latest = useRef(c);
  useEffect(() => { latest.current = c; }, [c]);
  const open = (target: Viewing) => { if (live) void openWithReturn(live, target.url).catch(error => c.setNotice(errorMessage(error))); else window.open(target.url, '_blank', 'noopener'); };
  const favorite = isFavoritePage(c, view.url);
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
  const others = sources.filter(source => !(current && pageScopeUrl(source.url) === pageScopeUrl(page?.url)));
  return <div className={s.detail}>
    <header className={s.hero}>
      {view.kind === 'asset' ? <Token view={view} size="lg" /> : <span className={s.heroLogo}><SiteLogo site={site} /></span>}
      <h2>{view.name}</h2>
      <p>{site && <SiteLogo site={site} size="xs" />}<span>{[sourceName, view.chain].filter(Boolean).join(' · ')}</span>
        {view.kind === 'asset' && <Tooltip content={t('extension.copy.assetDisclaimer')}><button type="button" className={s.info} aria-label={t('extension.copy.assetDisclaimerLabel')}><Info size={12} /></button></Tooltip>}</p>
      {short && <Tooltip content={t('extension.copy.copyContractAddress')}><button type="button" className={s.address} aria-label={t('extension.copy.copyContractAddress')} onClick={() => void c.copy(view.address!)}>{short}<Copy size={12} aria-hidden="true" /></button></Tooltip>}
      {roomKey && summary && <button type="button" className={s.watch} onClick={() => { setSocialUi({ people: roomKey }); c.go('room-people'); }}><Faces c={c} people={summary.faces} /><span><CountText text={t('extension.room.watching', { count: summary.count })} value={summary.count} /></span></button>}
    </header>
    <div className={s.tiles}>
      {roomKey && <button type="button" className={s.tile} onClick={() => openRoom(c, roomKey)}><DanmakuIcon size={18} /><span>{t('extension.room.name')}</span></button>}
      {c.canWrite && <button type="button" className={s.tile} disabled={sharing} onClick={() => void share()}><MessageSquarePlus size={18} /><span>{t('extension.current.share')}</span></button>}
      <button type="button" className={s.tile} aria-pressed={favorite} onClick={() => toggleFavoritePage(c, view)}><Star size={18} className={favorite ? s.starOn : undefined} /><span>{favorite ? t('extension.web.saved') : t('extension.web.save')}</span></button>
    </div>
    {others.length > 0 && <div className={s.sources}>{others.map(source => <button key={source.url} type="button" onClick={() => open(source)}><SiteLogo site={siteForUrl(source.url)} size="xs" />{t('extension.dynamic.openSource', { name: siteForUrl(source.url)?.name ?? source.source })}<ArrowUpRight size={12} aria-hidden="true" /></button>)}</div>}
    {roomKey && read.status === 'error' && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: read.retry }}>{t('common.error')}</InlineFeedback>}
    {roomKey && summary && <section className={s.block} aria-label={t('extension.stance.title')}><h3 className={s.blockHead}>{t('extension.stance.title')}</h3><StancePoll c={c} roomKey={roomKey} stance={summary.stance} /></section>}
    {live && c.team.joined && <TeamRecords c={c} asset={view} onJump={onJump} />}
  </div>;
}

/** 小队里: who shared it first, what was said about it and its 便利贴 in the current team, three at a time; and a note for the whole token. */
function TeamRecords({ c, asset, onJump }: { c: PalsideController; asset: Viewing; onJump: (id: string) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const key = viewAsset(asset);
  const [all, setAll] = useState(false);
  const first = key ? firstSharer(c.currentMessages, key) : undefined;
  const said = key ? [...relatedMessages(c.currentMessages, asset.id, c.data.views)].reverse().filter(message => message.id !== first?.id) : [];
  const notes = visibleStickies(c, key ?? { url: asset.url }).filter(item => !(c.live?.state.preferences.hiddenStickies ?? []).includes(item.id)).sort((a, b) => b.timestamp - a.timestamp);
  const name = (id: string) => id === c.data.self ? t('extension.page.you') : personFor(c.people, id, t('common.member')).name;
  const rows = [
    ...first ? [<div key="first" className={s.firstRow}><PersonAvatar person={personFor(c.people, first.author, t('common.member'))} size="xs" /><span>{t.rich('extension.discussion.firstShared', { name: name(first.author), b: chunks => <b>{chunks}</b> })}</span><time>{relativeTime(first.timestamp ?? c.now, locale, c.now)}</time></div>] : [],
    ...said.map(message => <button key={message.id} type="button" className={s.recordRow} onClick={() => onJump(message.id)}><PersonAvatar person={personFor(c.people, message.author, t('common.member'))} size="xs" /><span><b>{name(message.author)}</b>{message.text || t('extension.copy.tokenQuote')}</span><ChevronRight size={14} aria-hidden="true" /></button>),
    ...notes.map(note => <button key={note.id} type="button" className={s.recordRow} onClick={() => setSocialUi({ stickies: key ? { asset: key, focus: note.id } : { url: asset.url, focus: note.id } })}><span className={s.noteMark}><Highlighter size={12} aria-hidden="true" /></span><span><b>{t('extension.web.sticky')}</b>{note.text} · {name(note.author)}</span><ChevronRight size={14} aria-hidden="true" /></button>),
  ];
  return <section className={s.block} aria-label={t('extension.discussion.team')}>
    <h3 className={s.blockHead}>{t('extension.discussion.team')}<span>{c.team.name}</span></h3>
    {rows.length ? <div className={s.records}>{all ? rows : rows.slice(0, TEAM_ROWS)}</div> : <p className={s.none}>{t('extension.discussion.noDiscussion')}</p>}
    {rows.length > TEAM_ROWS && <Button size="sm" variant="quiet" className={s.all} aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? t('extension.discussion.fewer') : <CountText text={t('extension.discussion.all', { count: rows.length })} value={rows.length} />}</Button>}
    {key && c.canWrite && <Writer c={c} asset={key} className={s.writer} />}
  </section>;
}
