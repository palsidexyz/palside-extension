'use client';
import { useTranslations } from 'use-intl';
import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import type { Attachment } from '../../../domain/chat/model';
import type { PalsideController } from '../app/use-palside';
import s from '../feedback/edge-states.module.css';

export function MessageImage({ c, id, image, compact = false }: { c: PalsideController; id: string; image: Extract<Attachment, { kind: 'image' }>; compact?: boolean }) {
  return <ImageContent key={image.src} c={c} id={id} image={image} compact={compact} />;
}
function ImageContent({ c, id, image, compact }: { c: PalsideController; id: string; image: Extract<Attachment, { kind: 'image' }>; compact: boolean }) {
  const t = useTranslations();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(image.src ? 'loading' : 'failed');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const view = <button type="button" className={s.image} data-state={state} data-compact={compact} disabled={busy || state === 'loading'} aria-label={state === 'ready' ? t('extension.dynamic.viewImage', { name: (image.name) ?? '' }) : t('extension.dynamic.reloadImage', { name: (image.name) ?? '' })} aria-busy={busy || state === 'loading'} onClick={async () => {
    if (state === 'ready') { c.setImage(image); return; }
    if (busy) return; setBusy(true);
    try {
      if (c.live) await c.live.command('reload-image', { id });
      if (image.src) { setAttempt(n => n + 1); setState('loading'); }
    } catch { setState('failed'); }
    finally { setBusy(false); }
  }}>
    {image.src && state !== 'failed' && <motion.img key={attempt} src={image.src} alt="" onLoad={() => setState('ready')} onError={() => setState('failed')} />}
    {state === 'failed' && <><RotateCcw size={15} /><span>{busy ? t('extension.copy.loading') : t('extension.copy.reloadImage')}</span></>}
    {state === 'loading' && <span>{t('extension.copy.loadingImage')}</span>}
    {compact && state === 'ready' && <span>{image.name}</span>}
  </button>;
  return view;
}
