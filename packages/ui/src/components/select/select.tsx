"use client";

import type { ComponentPropsWithRef, CSSProperties, ReactNode } from "react";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { clsx } from "clsx";
import styles from "./select.module.css";

export type SelectOption = { value: string; label: string; disabled?: boolean; iconSrc?: string };
export type SelectProps = Omit<ComponentPropsWithRef<"select">, "children" | "multiple" | "size"> & {
  options: readonly SelectOption[];
  leading?: ReactNode;
  compact?: boolean;
  /** `ghost` drops the field surface: a bare glyph when compact with `leading`, otherwise right-aligned value text. */
  variant?: "field" | "ghost";
};

/** Native selection, form reset and keyboard behavior. The custom picker is progressive CSS. */
export function Select({ options, leading, compact = false, variant = "field", className, disabled, ...props }: SelectProps) {
  return <span className={styles.selectSurface} data-slot="select" data-compact={compact} data-variant={variant}>
    <select {...props} data-leading={Boolean(leading)} data-icon-only={compact && Boolean(leading)} disabled={disabled || options.length === 0} className={clsx(styles.select, className)}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled} data-icon={Boolean(option.iconSrc)} style={option.iconSrc ? { '--select-option-icon': `url(${JSON.stringify(option.iconSrc)})` } as CSSProperties : undefined}>{option.label}</option>)}
    </select>
    {variant === "ghost" && !compact ? <ChevronsUpDown size={14} className={styles.selectChevron} aria-hidden="true" /> : <ChevronDown size={16} className={styles.selectChevron} aria-hidden="true" />}
    {leading && <span className={styles.selectLeading} aria-hidden="true">{leading}</span>}
  </span>;
}
