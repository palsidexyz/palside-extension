'use client';
import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Trash2 } from 'lucide-react';
import { Select, type SelectProps } from '@palside/ui/select';
import s from './setting-rows.module.css';

/** A titled card of rows; the title is the 12px group label every settings screen shares. `dim`: it depends on a switch that is off — shown, greyed and inert, never hidden. */
export function SettingGroup({ title, aside, label, dim, children }: { title?: ReactNode; aside?: ReactNode; label?: string; dim?: boolean; children: ReactNode }) {
  return <section className={s.group} aria-label={label} data-dim={dim || undefined} inert={dim}>
    {title && <div className={s.head}><span>{title}</span>{aside && <small>{aside}</small>}</div>}
    <div className={s.card}>{children}</div>
  </section>;
}

type ItemProps = { icon?: ReactNode; title: ReactNode; detail?: ReactNode; value?: ReactNode; end?: ReactNode; tone?: 'danger'; disabled?: boolean; label?: string };

/**
 * One settings row. With onClick it opens something (its current value, then a chevron), with href it leaves the panel (arrow);
 * otherwise `end` holds its one control. Without an icon it is a part of the row above, indented under its name.
 */
export function SettingItem({ icon, title, detail, value, end, tone, disabled, label, onClick, href }: ItemProps & { onClick?: () => void; href?: string }) {
  const body = <>
    {icon && <span className={s.icon} aria-hidden="true">{icon}</span>}
    <span className={s.text}><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    {(end || value !== undefined || onClick || href) && <span className={s.end}>{value !== undefined && <span className={s.value}>{value}</span>}{end}{end === undefined && (onClick || href) && <span className={s.arrow} aria-hidden="true">{href ? <ArrowUpRight size={15} /> : <ChevronRight size={15} />}</span>}</span>}
  </>;
  const nested = !icon || undefined;
  if (href) return <a className={s.row} data-tone={tone} data-nested={nested} href={href} target="_blank" rel="noreferrer noopener" aria-label={label}>{body}</a>;
  if (onClick) return <button type="button" className={s.row} data-tone={tone} data-nested={nested} disabled={disabled} aria-label={label} onClick={onClick}>{body}</button>;
  return <div className={s.row} data-tone={tone} data-nested={nested}>{body}</div>;
}

/** A row whose label is a form control (select, switch) so the whole row names it. */
export function SettingControl({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className={s.row}><span className={s.icon} aria-hidden="true">{icon}</span>{children}</div>;
}

/** A choice shown as its current value in quiet text with an up-down mark, like a system settings row. */
export function ValueSelect({ options, ...props }: Omit<SelectProps, 'options' | 'variant' | 'compact' | 'leading' | 'className'> & { options: readonly (readonly [string, string])[] }) {
  return <Select {...props} variant="ghost" options={options.map(([value, label]) => ({ value, label }))} />;
}

/** A page's one destructive action: last on the page, alone in its own card as a red row with its icon, so it never sits among everyday rows. */
export function SettingDanger({ icon = <Trash2 size={16} />, children, onClick }: { icon?: ReactNode; children: ReactNode; onClick: () => void }) {
  return <div className={s.card}><button type="button" className={s.row} data-tone="danger" data-danger onClick={onClick}><span className={s.icon} aria-hidden="true">{icon}</span><span className={s.text}><strong>{children}</strong></span></button></div>;
}

export function SettingCount({ children }: { children: ReactNode }) {
  return <span className={s.count}>{children}</span>;
}

export { s as settingRows };
