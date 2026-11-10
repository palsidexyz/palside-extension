'use client';

import { useTranslations } from 'use-intl';
import type { ReactNode } from 'react';
import { ArrowUpRight, MessagesSquare, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { shortAddress } from '@palside/shared/navigation';
import { Token } from '../ui/primitives';
import type { Viewing } from '../../../domain/assets/model';
import s from '../app/palside.module.css';
import a from './asset-card.module.css';
import { tokenLabel } from './token-name';
import { displayHost } from '../../../domain/assets/site-host';

const hostOf = (url: string) => displayHost(url) ?? url;

/**
 * One card for every shared page, one layout: the icon, a one-line name, then the domain, and an action on the right. A token shows its
 * chain and short contract instead of the domain and 详情 opens its discussion; a website's 打开 opens the page, like its title.
 * Shared by messages, drafts and person cards.
 */
export function AssetCard({ view, onOpen, onRemove, chain }: { view: Viewing; onOpen: () => void; onRemove?: () => void; chain?: ReactNode }) {
  const t = useTranslations();
  const asset = view.kind === 'asset';
  const name = tokenLabel(view, t);
  return <div className={s.assetCard} data-asset-card data-kind={view.kind}>
    <div className={a.layout}>
      <Token view={view} size="card" />
      <div className={a.identity}>
        <span className={a.heading}>
          <a className={a.title} href={view.url} target="_blank" rel="noreferrer noopener" title={[name, asset ? view.chain : undefined, hostOf(view.url)].filter(Boolean).join(' · ')}>{name}</a>
          {asset && (chain ?? (view.chain && <span className={a.chain}>{view.chain}</span>))}
        </span>
        <span className={a.meta}>{asset && view.address ? <span className={a.address} title={view.address}>{shortAddress(view.address)}</span> : <span className={a.host}>{hostOf(view.url)}</span>}</span>
      </div>
      {asset
        ? <Button size="sm" variant="surface" className={a.details} onClick={onOpen} aria-label={t('extension.dynamic.viewToken', { name })}><MessagesSquare size={13} aria-hidden="true" />{t('extension.copy.details')}</Button>
        : <Button size="sm" variant="surface" className={a.details} onClick={() => window.open(view.url, '_blank', 'noopener,noreferrer')} aria-label={`${t('extension.top.open')} · ${hostOf(view.url)}`}>{t('extension.top.open')}<ArrowUpRight size={13} aria-hidden="true" /></Button>}
    </div>
    {onRemove && <IconButton label={t('extension.copy.removeCard')} size="sm" variant="surface" className={a.remove} onClick={onRemove}><X size={13} /></IconButton>}
  </div>;
}
