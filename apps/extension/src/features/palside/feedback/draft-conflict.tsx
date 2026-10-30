'use client';
import { Button } from '@palside/ui/button';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

export function DraftConflict({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [resolving, setResolving] = useState(false);
  async function resolve(keepLocal: boolean) {
    if (resolving) return;
    setResolving(true);
    try { await c.resolveDraftConflict(keepLocal); } finally { setResolving(false); }
  }
  if (!c.draftConflict) return null;
  return <div className={s.draftConflict} aria-busy={resolving}>
    <span role="status">{t('extension.copy.draftConflict')}</span>
    <div><Button size="sm" variant="quiet" disabled={resolving} onClick={() => void resolve(true)}>{t('extension.copy.keepDraft')}</Button>
    <Button size="sm" variant="quiet" disabled={resolving} onClick={() => void resolve(false)}>{t('extension.copy.useSharedDraft')}</Button></div>
  </div>;
}
