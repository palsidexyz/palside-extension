'use client';
import { Button } from '@palside/ui/button';
import { useTranslations } from 'use-intl';
import { assetView } from '../../../domain/assets/model';
import { useId, useState } from 'react';
import { MessageImage } from '../media/message-image';
import { ArrowUpRight, Coins, Image as ImageIcon, Link2 } from 'lucide-react';
import { AssetCard } from './asset-card';
import { sharedTokens } from '../../../domain/assets/shared-tokens';
import { EmptyState, HistoryMore } from '../chat/history-scope';
import { Tabs } from '../ui/sub-rows';
import type { PalsideController } from '../app/use-palside';

import { publicShareUrl } from '@palside/shared/navigation';
import s from '../app/palside.module.css';
export function SharedContent({ c, onJump }: { c: PalsideController; onJump: (id: string) => void }) {
  const t = useTranslations();
  const tabId = useId();
  // Same order as the menu name 图片/链接/代币.
  const categories = ['images', 'links', 'assets'] as const;
  const category = c.sharedCategory; const setCategory = c.setSharedCategory;
  const messages = c.currentMessages.filter(m => m.status === 'sent' && !m.recalled).toReversed();
  const [order, setOrder] = useState<'recent' | 'discussed'>('recent');
  const assets = category === 'assets' ? sharedTokens({ messages, now: c.now, order }) : [];
  const images = category === 'images' ? messages.filter(m => m.attachment?.kind === 'image') : [];
  const links = new Map<string, (typeof messages)[number]>();
  if (category === 'links') {
    for (const message of messages) for (const match of message.text.matchAll(/https?:\/\/[^\s<>]+/g)) { const url = publicShareUrl(match[0]); if (url && !links.has(url)) links.set(url, message); }
    for (const message of messages) { const view = assetView(message.attachment); const url = view?.kind === 'website' ? publicShareUrl(view.url) : undefined; if (url && !links.has(url)) links.set(url, message); }
  }
  const attribution = (message: (typeof messages)[number]) => <div className={s.sharedAttribution}><small>{[c.people.find(p => p.id === message.author)?.name ?? t('extension.copy.teamMembers'), message.time].filter(Boolean).join(' · ')}</small><Button size="sm" variant="quiet" onClick={() => onJump(message.id)}>{t('extension.copy.viewMessage')}<ArrowUpRight size={13} aria-hidden="true" /></Button></div>;
  return <><Tabs id={tabId} className={s.sharedTabs} label={t('extension.copy.contentCategories')} value={category} tabs={categories.map(id => [id, ({ assets: t('extension.copy.tokens'), images: t('extension.copy.images'), links: t('extension.copy.links') })[id]])} onChange={setCategory} />
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${category}`} tabIndex={0} className={s.sharedPanel}>
    {category === 'assets' && assets.length > 0 && <div className={s.sharedSort} role="group" aria-label={t('extension.sharedTokens.sort')}>
      {(['recent', 'discussed'] as const).map(value => <button type="button" key={value} aria-pressed={order === value} onClick={() => setOrder(value)}>{t(`extension.sharedTokens.${value}`)}</button>)}
    </div>}
    {category === 'assets' && assets.map(item => <div key={item.asset} className={s.sharedItem}><AssetCard view={item.view} onOpen={() => c.selectAsset(item.view.id)} />{attribution(item.lastMessage)}</div>)}
    {category === 'images' && images.map(message => message.attachment?.kind === 'image' && <div className={s.sharedItem} key={message.id}><MessageImage c={c} id={message.id} image={message.attachment} compact />{attribution(message)}</div>)}
    {category === 'links' && [...links].map(([url, message]) => <div className={s.sharedItem} key={url}><a href={url} target="_blank" rel="noreferrer noopener" className={s.sharedLink}><Link2 size={16} /><span className={s.sharedUrl}>{url}</span><ArrowUpRight size={16} /></a>{attribution(message)}</div>)}
    {(category === 'assets' ? assets.length : category === 'images' ? images.length : links.size)
      ? <HistoryMore c={c} />
      : <EmptyState icon={{ assets: <Coins />, images: <ImageIcon />, links: <Link2 /> }[category]} title={t(({ assets: 'extension.dynamic.noTokens', images: 'extension.dynamic.noImages', links: 'extension.dynamic.noLinks' })[category])}><HistoryMore c={c} /></EmptyState>}
    </div>
  </>;
}
