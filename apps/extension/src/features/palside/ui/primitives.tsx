'use client';

import { useTranslations } from 'use-intl';
import { use, useState, type ReactNode, type ComponentProps, type CSSProperties } from 'react';
import { Globe2, ChevronRight } from 'lucide-react';
import { ChainBadge } from '../assets/chain-identity';
import { tokenImageFailures } from '../assets/token-image-failures';
import { siteForUrl } from '../settings/site-catalog';
import { motion } from 'motion/react';
import { StateGlyph } from './motion-details';
import { Avatar } from '@palside/ui/avatar';
import { IconButton } from '@palside/ui/button';
import { defaultAvatar, TeamPortraits } from '../account/default-avatar';
import type { Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import s from '../app/palside.module.css';

function TokenFace({ logo, fallback }: { logo?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ready = loaded && !failed;
  const blocked = Boolean(logo && !ready && (failed || tokenImageFailures.has(logo)));
  return <span className={s.tokenFace} data-fallback={!ready}>
    <span className={s.tokenFallback} style={{ opacity: ready ? 0 : 1 }}>{fallback}</span>
    {logo && !blocked && <motion.img src={logo} style={{ opacity: ready ? 1 : 0 }} referrerPolicy="no-referrer" alt="" draggable={false} onLoad={() => { tokenImageFailures.forget(logo); setLoaded(true); }} onError={() => { tokenImageFailures.remember(logo); setFailed(true); }} />}
  </span>;
}
export function Token({ view, size = 'md' }: { view: Viewing; size?: 'xs' | 'sm' | 'md' | 'card' | 'lg' }) {
  const fallbackName = view.name.trim();
  const initial = fallbackName === view.address || /^0x[\da-f.\u2026]+$/i.test(fallbackName) ? '?' : (fallbackName.match(/\p{L}/u)?.[0] ?? '?').toLocaleUpperCase();
  const logo = view.logo ?? (view.kind === 'website' ? siteForUrl(view.url)?.logo : undefined);
  return <span className={s.token} data-token-size={size} data-kind={view.kind} style={{ '--token-color': view.color } as CSSProperties} aria-hidden="true">
    <TokenFace key={logo ?? ''} logo={logo} fallback={view.kind === 'website' ? <Globe2 size={18} strokeWidth={1.6} /> : <span className={s.tokenInitial}>{initial}</span>} />
    {view.kind === 'asset' && view.chain && size !== 'xs' && <ChainBadge chain={view.chain} />}
  </span>;
}
export function PersonAvatar({ person, size = 'md', onClick }: { person: Person; size?: 'xs' | 'sm' | 'room' | 'md' | 'lg' | 'xl' | 'xxl'; onClick?: () => void }) {
  const t = useTranslations();
  const name = person.name || t('common.member');
  const Tag = onClick ? 'button' : 'span';
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const portraits = use(TeamPortraits);
  const customAvatar = person.avatar && person.avatar !== failedAvatar ? person.avatar : undefined;
  const presence = person.presence === 'active' ? t('extension.copy.presenceActive') : person.presence === 'away' ? t('extension.copy.presenceAway') : undefined;
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-label={onClick ? t('extension.dynamic.viewProfile', { name }) : undefined} title={[name, presence].filter(Boolean).join(' · ')} className={s.personAvatar} data-person-avatar data-default-avatar={!customAvatar} onErrorCapture={event => { if (customAvatar && event.target instanceof HTMLImageElement) setFailedAvatar(customAvatar); }} data-avatar-size={size} style={{ '--avatar-color': person.color } as CSSProperties}>
    <Avatar fallbackLabel={t('common.member')} name={name} src={customAvatar || portraits?.get(person.id) || defaultAvatar(person.id)} fit={customAvatar ? 'cover' : 'contain'} className={s.avatar} />
    {presence && <span className={s.presenceDot} data-presence={person.presence} role="img" aria-label={presence} />}
  </Tag>;
}
export function Action({ label, children, onClick, disabled = false, danger = false, size = 'sm', className = '', ...props }: Omit<ComponentProps<'button'>, 'size'> & { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; size?: 'xs' | 'sm' }) {
  return <IconButton {...props} label={label} size={size} variant="quiet" disabled={disabled} className={`${s.actionButton} ${danger ? s.danger : ''} ${className}`} onClick={onClick}><StateGlyph state={label}>{children}</StateGlyph></IconButton>;
}
export function Row({ children, detail, onClick, icon, danger }: { children: ReactNode; detail?: ReactNode; onClick: () => void; icon?: ReactNode; danger?: boolean }) {
  return <button type="button" className={`${s.row} ${danger ? s.danger : ''}`} onClick={onClick}>{icon}<span>{children}</span>{detail && <small>{detail}</small>}<span className={s.rowArrow}><ChevronRight size={15} /></span></button>;
}

/** Keeps a control where the user put it until the real state catches up: no snap back while Chrome or the background answers, and no greying out. A refused or failed change returns it to the real state. */
export function useHeld<T>(actual: T): [T, (next: T, change: () => Promise<unknown> | unknown) => void, boolean] {
  const [held, setHeld] = useState<{ value: T }>();
  const [busy, setBusy] = useState(false);
  if (held && Object.is(held.value, actual) && !busy) setHeld(undefined);
  function change(next: T, run: () => Promise<unknown> | unknown) {
    if (busy) return;
    setHeld({ value: next });
    setBusy(true);
    void Promise.resolve().then(run).then(done => { if (done === false) setHeld(undefined); }, () => setHeld(undefined)).finally(() => {
      setBusy(false);
      // State that never arrives (a closed port, an ignored change) must not pin the control forever.
      setTimeout(() => setHeld(current => current?.value === next ? undefined : current), 2000);
    });
  }
  return [held ? held.value : actual, change, busy];
}
