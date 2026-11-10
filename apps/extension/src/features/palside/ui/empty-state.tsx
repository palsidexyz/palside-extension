import type { ReactNode } from 'react';
import s from '../app/palside.module.css';

/**
 * Empty, loading or failed list: icon tile, one line, optional next step. Alone on a page it is centred in the space the page leaves
 * (fill); under other content it follows that content directly. `role` announces a loading line (status) or a failure (alert).
 */
export function EmptyState({ icon, title, fill = true, role, children }: { icon?: ReactNode; title: ReactNode; fill?: boolean; role?: 'status' | 'alert'; children?: ReactNode }) {
  return <div className={s.empty} data-fill={fill || undefined}>{icon}<p role={role}>{title}</p>{children}</div>;
}
