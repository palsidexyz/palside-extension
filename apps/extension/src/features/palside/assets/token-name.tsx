'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/interaction';
import { tokenNamed } from '../../../runtime/viewing/token-profiles';
import type { PalsideController } from '../app/use-palside';
import s from './token-name.module.css';
import { liveView } from './token-data';

/** A view's name for labels and tooltips: never the address placeholder. */
export function tokenLabel(view: Viewing, t: ReturnType<typeof useTranslations>) {
  return tokenNamed(view) ? view.name : t('extension.copy.unknownToken');
}

/** What a token is still waiting for: its name (the active page's token being read), or only its icon (the directory is fetching it). */
export function tokenWaiting(c: Pick<PalsideController, 'live'>, view: Viewing): 'name' | 'logo' | undefined {
  if (view.kind !== 'asset') return;
  view = liveView(c, view);
  const asset = viewAsset(view);
  if (!tokenNamed(view)) return asset && c.live?.state.tokenPending === asset ? 'name' : undefined;
  return !view.logo && asset && c.live?.state.tokens?.[asset]?.logoPending ? 'logo' : undefined;
}

/** Pending while the active page's token is being read; the real name fades in once known; otherwise 未识别代币. */
export function TokenName({ c, view }: { c: Pick<PalsideController, 'live'>; view: Viewing }) {
  const t = useTranslations();
  const pending = tokenWaiting(c, view) === 'name';
  view = liveView(c, view);
  const named = tokenNamed(view);
  // Only a name that replaces a placeholder animates; lists that render named never do.
  const [waited, setWaited] = useState(!named);
  if (!named && !waited) setWaited(true);
  if (pending) return <span className={s.pending} role="status" aria-label={t('extension.copy.loading')} />;
  if (!named) return <>{t('extension.copy.unknownToken')}</>;
  return <span key={view.name} className={waited ? s.arrived : undefined}>{view.name}</span>;
}
