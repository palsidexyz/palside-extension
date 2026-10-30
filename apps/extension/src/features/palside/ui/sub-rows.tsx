'use client';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Switch } from '@palside/ui/switch';
import { Count } from './motion-details';
import { useHeld } from './primitives';
import s from '../app/pages.module.css';

/** Tabs with arrow keys, Home and End; the panel below names itself after the chosen tab. */
export function Tabs<T extends string>({ id, label, value, tabs, onChange, as: List = 'div', className }: { id: string; label: string; value: T; tabs: [T, ReactNode][]; onChange: (value: T) => void; as?: 'div' | 'span'; className?: string }) {
  function keys(event: KeyboardEvent<HTMLElement>) {
    const index = tabs.findIndex(([tab]) => tab === value);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const position = (next + tabs.length) % tabs.length;
    const tab = tabs[position]![0];
    onChange(tab);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[position]?.focus();
  }
  return <List className={className} role="tablist" aria-label={label} onKeyDown={keys}>
    {tabs.map(([tab, text]) => <button key={tab} id={`${id}-tab-${tab}`} type="button" role="tab" aria-selected={value === tab} aria-controls={`${id}-panel`} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)}>{text}</button>)}
  </List>;
}

/** A secondary row: label on the left, its one control on the right. */
export function Sub({ label, lead, children }: { label: string; lead?: ReactNode; children: ReactNode }) {
  return <div className={s.subRow}>{lead ? <span className={s.lead}>{lead}<span>{label}</span></span> : <span>{label}</span>}{children}</div>;
}

/** A segmented choice that moves at once and keeps its place until the saved value arrives. */
export function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => unknown }) {
  const [shown, change, busy] = useHeld(value);
  const pick = (next: T) => { if (next !== shown) change(next, () => onChange(next)); };
  return <span className={s.seg} role="radiogroup" aria-label={label} aria-busy={busy || undefined} onKeyDown={event => {
    const index = options.findIndex(([option]) => option === shown);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1 : undefined;
    if (next === undefined || busy) return;
    event.preventDefault();
    const position = (next + options.length) % options.length;
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[position]?.focus();
    pick(options[position]![0]);
  }}>
    {options.map(([option, text]) => <button key={option} type="button" role="radio" tabIndex={shown === option ? 0 : -1} aria-checked={shown === option} onClick={() => pick(option)}>{text}</button>)}
  </span>;
}

/** The slider follows the hand; the saved value takes over once the hand lets go. */
export function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => unknown }) {
  const [draft, setDraft] = useState<number>();
  const shown = draft ?? value;
  return <span className={s.range}>
    <input type="range" min={min} max={max} step={5} aria-label={label} value={shown} onChange={event => { const next = Number(event.currentTarget.value); setDraft(next); onChange(next); }} onPointerUp={() => setTimeout(() => setDraft(undefined), 600)} onBlur={() => setDraft(undefined)} />
    <output><Count value={shown} />%</output>
  </span>;
}

/** A secondary switch: the row carries the name, the Switch only its state. */
export function SubSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => unknown }) {
  return <Sub label={label}><Switch hideLabel label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} /></Sub>;
}

