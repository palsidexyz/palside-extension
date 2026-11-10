'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/interaction';
import { tokenNamed } from '../../../runtime/viewing/token-profiles';
import type { PalsideController } from '../app/use-palside';
import s from './token-name.module.css';
import { liveView } from './token-data';

/**
 * A view's name for labels and tooltips: never the address placeholder. With the controller, a token still loading reads
 * 加载中; 未识别代币 is only for one the directory answered is not a token, or could not read.
 */
export function tokenLabel(view: Viewing, t: ReturnType<typeof useTranslations>, c?: Pick<PalsideController, 'live'>) {
  if (c) view = liveView(c, view);
  if (tokenNamed(view)) return view.name;
  return c && tokenWaiting(c, view) === 'name' ? t('extension.copy.loading') : t('extension.copy.unknownToken');
}

/**
 * What a token is still waiting for: its name (no directory answer yet), or only its icon (the directory is fetching it).
 * A token without a name is loading until the directory answers it is not a token or the ask fails; only then 未识别代币.
 */
export function tokenWaiting(c: Pick<PalsideController, 'live'>, view: Viewing): 'name' | 'logo' | undefined {
  if (view.kind !== 'asset') return;
  view = liveView(c, view);
  const asset = viewAsset(view);
  if (!tokenNamed(view)) return asset && c.live && !c.live.state.tokenUnknown?.includes(asset) ? 'name' : undefined;
  return !view.logo && asset && c.live?.state.tokens?.[asset]?.logoPending ? 'logo' : undefined;
}

/** The placeholder a name's line keeps while the name is on its way. */
export function NamePending() {
  const t = useTranslations();
  return <span className={s.pending} role="status" aria-label={t('extension.copy.loading')} />;
}

/** Pending until the directory answers; the real name fades in once known; 未识别代币 only when it cannot be loaded. */
export function TokenName({ c, view }: { c: Pick<PalsideController, 'live'>; view: Viewing }) {
  const t = useTranslations();
  const pending = tokenWaiting(c, view) === 'name';
  view = liveView(c, view);
  const named = tokenNamed(view);
  // Only a name that replaces a placeholder animates; lists that render named never do.
  const [waited, setWaited] = useState(!named);
  if (!named && !waited) setWaited(true);
  if (pending) return <NamePending />;
  if (!named) return <>{t('extension.copy.unknownToken')}</>;
  return <span key={view.name} className={waited ? s.arrived : undefined}>{view.name}</span>;
}
