'use client';

import { useTranslations } from 'use-intl';
import { MessagesSquare, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { shortAddress } from '@palside/shared/navigation';
import { Token } from '../ui/primitives';
import type { Viewing } from '../../../domain/assets/model';
import s from '../app/palside.module.css';
import a from './asset-card.module.css';

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * One card for every shared page: the site's icon, the page name, the domain. The title opens the page; a token
 * shows its chain and short contract instead of the domain, and a 详情 button opens its discussion. Shared by messages, drafts and person cards.
 */
export function AssetCard({ view, onOpen, onRemove }: { view: Viewing; onOpen: () => void; onRemove?: () => void }) {
  const t = useTranslations();
  const asset = view.kind === 'asset';
  return <div className={s.assetCard} data-asset-card data-kind={view.kind}>
    <div className={a.layout}>
      <Token view={view} size="card" />
      <div className={a.identity}>
        <span className={a.heading}>
          <a data-palside-source className={a.title} href={view.url} target="_blank" rel="noreferrer noopener" title={[view.name, asset ? view.chain : undefined, hostOf(view.url)].filter(Boolean).join(' · ')}>{view.name}</a>
          {asset && view.chain && <span className={a.chain}>{view.chain}</span>}
        </span>
        <span className={a.meta}>{asset && view.address ? <span className={a.address} title={view.address}>{shortAddress(view.address)}</span> : <span className={a.host}>{hostOf(view.url)}</span>}</span>
      </div>
      {asset && <Button size="sm" variant="surface" className={a.details} onClick={onOpen} aria-label={t('extension.dynamic.viewToken', { name: view.name })}><MessagesSquare size={13} aria-hidden="true" />{t('extension.copy.details')}</Button>}
    </div>
    {onRemove && <IconButton label={t('extension.copy.removeCard')} size="sm" variant="surface" className={a.remove} onClick={onRemove}><X size={13} /></IconButton>}
  </div>;
}
