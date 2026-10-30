'use client';
import type { ReactNode } from 'react';
import k from './chip.module.css';

export type ChipTone = 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray';

/** One geometry for every tag (level, role); only the colour changes. `solid` fills it with the colour. */
export function Chip({ tone = 'neutral', size, solid, icon, children, className }: { tone?: ChipTone; size?: 'md'; solid?: boolean; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={className ? `${k.chip} ${className}` : k.chip} data-tone={tone} data-size={size} data-solid={solid || undefined}>{icon}{children}</span>;
}
