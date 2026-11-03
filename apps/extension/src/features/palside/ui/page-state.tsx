'use client';
import type { ReactNode } from 'react';
import s from './page-state.module.css';

/**
 * A page with nothing else to show: one sentence of the actual state and at most one action, centred in the space the page leaves.
 * Startup failure, no cached squads and server-only pages that cannot load all use it; no icon, heading or explanation is stacked on top.
 */
export function PageState({ title, action, busy }: { title: ReactNode; action?: ReactNode; busy?: boolean }) {
  return <div className={s.state} role={busy ? 'status' : 'alert'} aria-busy={busy || undefined}>
    <p className={s.title}>{title}</p>
    {action}
  </div>;
}
