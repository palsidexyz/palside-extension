'use client';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import s from './context-bar.module.css';

type BarAction = { label: string; onClick: () => void; primary?: boolean };

type Props = {
  lead: ReactNode;
  /** A small mark on the lead's corner, e.g. the token a teammate is on. */
  badge?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: BarAction[];
  onClose?: () => void;
  closeLabel?: string;
  tone?: 'plain' | 'accent' | 'warning';
  /** Full text on hover when the card shortens it. */
  hint?: string;
};

/** The top slot's card: 52px, the same height as the 在看 chips it replaces — who or what, one line of state, text actions. */
export function ContextBar({ lead, badge, title, meta, actions = [], onClose, closeLabel, tone = 'plain', hint }: Props) {
  return <div className={s.bar} data-tone={tone} role="status" title={hint}>
    <span className={s.lead}>{lead}{badge && <span className={s.badge}>{badge}</span>}</span>
    <span className={s.body}>
      <span className={s.title}>{title}</span>
      {meta && <span className={s.meta}>{meta}</span>}
    </span>
    {actions.map(action => <Button key={action.label} size="sm" variant={action.primary ? 'surface' : 'quiet'} className={s.action} data-primary={action.primary || undefined} onClick={action.onClick}>{action.label}</Button>)}
    {onClose && closeLabel && <IconButton size="sm" variant="quiet" className={s.close} label={closeLabel} onClick={onClose}><X style={{ width: 14, height: 14 }} /></IconButton>}
  </div>;
}
