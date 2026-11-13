'use client';
import { Button, IconButton } from '@palside/ui/button';
import { Tooltip } from '@palside/ui/tooltip';
import { Token } from '../ui/primitives';
import { useTranslations } from 'use-intl';
import { assetView } from '../../../domain/assets/model';
import { useId, useState, type ReactNode } from 'react';
import { MessageImage } from '../media/message-image';
import { ArrowUpRight, Coins, Image as ImageIcon, Link2 } from 'lucide-react';
import { sharedTokens } from '../../../domain/assets/shared-tokens';
import { searchableMessages, searchNeedle } from '../../../domain/chat/search';
import { HistoryMore } from '../chat/history-scope';
import { EmptyState } from '../ui/empty-state';
import { Tabs } from '../ui/sub-rows';
import type { PalsideController } from '../app/use-palside';

import { publicShareUrl } from '@palside/shared/navigation';
import s from '../app/palside.module.css';
import { tokenLabel } from './token-name';
import { liveView } from './token-data';
/** 搜索消息's four tabs: 消息 is the search result list the panel passes in; 图片、链接、代币 collect what the chat shared, narrowed by the same query. */
export function SharedContent({ c, onJump, messages: results }: { c: PalsideController; onJump: (id: string) => void; messages?: ReactNode }) {
  const t = useTranslations();
  const tabId = useId();
  const categories = ['messages', 'images', 'links', 'assets'] as const;
  const category = c.sharedCategory; const setCategory = c.setSharedCategory;
  const query = searchNeedle(c.query);
  const hit = (...values: (string | undefined)[]) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));
  const messages = searchableMessages(c.currentMessages);
  const [order, setOrder] = useState<'recent' | 'discussed'>('recent');
  const assets = category === 'assets' ? sharedTokens({ messages, now: c.now, order }).map(item => ({ ...item, view: liveView(c, item.view) })).filter(item => hit(tokenLabel(item.view, t, c), item.view.name, item.view.address)) : [];
  const images = category === 'images' ? messages.filter(m => m.attachment?.kind === 'image' && hit(m.text)) : [];
  const links = new Map<string, (typeof messages)[number]>();
  if (category === 'links') {
    for (const message of messages) for (const match of message.text.matchAll(/https?:\/\/[^\s<>]+/g)) { const url = publicShareUrl(match[0]); if (url && !links.has(url) && hit(url, message.text)) links.set(url, message); }
    for (const message of messages) { const view = assetView(message.attachment); const url = view?.kind === 'website' ? publicShareUrl(view.url) : undefined; if (url && !links.has(url) && hit(url, view?.name, message.text)) links.set(url, message); }
  }
  const authorOf = (message: (typeof messages)[number]) => c.people.find(p => p.id === message.author)?.name ?? t('extension.copy.teamMembers');
  const attribution = (message: (typeof messages)[number]) => <div className={s.sharedAttribution}><small>{[authorOf(message), message.time].filter(Boolean).join(' · ')}</small><Button size="sm" variant="quiet" onClick={() => onJump(message.id)}>{t('extension.copy.viewMessage')}<ArrowUpRight size={13} aria-hidden="true" /></Button></div>;
  return <><Tabs id={tabId} className={s.sharedTabs} label={t('extension.copy.contentCategories')} value={category} tabs={categories.map(id => [id, ({ messages: t('extension.copy.messagesGroup'), assets: t('extension.copy.tokens'), images: t('extension.copy.images'), links: t('extension.copy.links') })[id]])} onChange={setCategory} />
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${category}`} tabIndex={0} className={s.sharedPanel}>
    {category === 'messages' && results}
    {category === 'assets' && assets.length > 0 && <div className={s.sharedSort} role="group" aria-label={t('extension.sharedTokens.sort')}>
      {(['recent', 'discussed'] as const).map(value => <button type="button" key={value} aria-pressed={order === value} onClick={() => setOrder(value)}>{t(`extension.sharedTokens.${value}`)}</button>)}
    </div>}
    {category === 'assets' && assets.length > 0 && <div className={s.sharedTokens}>{assets.map(item => <div key={item.asset} className={s.sharedToken}>
      <Tooltip content={item.view.address ?? tokenLabel(item.view, t, c)}><button type="button" className={s.sharedTokenOpen} aria-label={t('extension.dynamic.viewToken', { name: tokenLabel(item.view, t, c) })} onClick={() => c.selectAsset(item.view.id)} /></Tooltip>
      <Token view={item.view} size="card" />
      <span className={s.sharedTokenName}><strong>{tokenLabel(item.view, t, c)}</strong><small>{[authorOf(item.lastMessage), item.lastMessage.time, item.messages > 1 ? t('extension.dynamic.messageCount', { count: item.messages }) : undefined].filter(Boolean).join(' · ')}</small></span>
      <Tooltip content={t('extension.copy.viewMessage')}><IconButton label={t('extension.copy.viewMessage')} size="sm" variant="quiet" onClick={() => onJump(item.lastMessage.id)}><ArrowUpRight size={15} /></IconButton></Tooltip>
    </div>)}</div>}
    {category === 'images' && images.map(message => message.attachment?.kind === 'image' && <div className={s.sharedItem} key={message.id}><MessageImage c={c} id={message.id} sentAt={message.timestamp} image={message.attachment} compact />{attribution(message)}</div>)}
    {category === 'links' && [...links].map(([url, message]) => <div className={s.sharedItem} key={url}><a href={url} target="_blank" rel="noreferrer noopener" className={s.sharedLink}><Link2 size={16} /><span className={s.sharedUrl}>{url}</span><ArrowUpRight size={16} /></a>{attribution(message)}</div>)}
    {category !== 'messages' && ((category === 'assets' ? assets.length : category === 'images' ? images.length : links.size)
      ? <HistoryMore c={c} />
      : <EmptyState icon={{ assets: <Coins />, images: <ImageIcon />, links: <Link2 /> }[category]} title={query ? t('extension.copy.noSearchResults') : t(({ assets: 'extension.dynamic.noTokens', images: 'extension.dynamic.noImages', links: 'extension.dynamic.noLinks' })[category])}><HistoryMore c={c} /></EmptyState>)}
    </div>
  </>;
}
