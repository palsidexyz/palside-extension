"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { Spinner } from "../spinner";
import { clsx } from "clsx";
import styles from "./button.module.css";

type NativeButtonProps = ComponentPropsWithRef<"button">;
export type ButtonProps = NativeButtonProps & {
  variant?: "surface" | "primary" | "danger" | "quiet";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
};

/** Request state belongs to the caller. Loading retains focus and blocks activation. */
export function Button({ children, className, variant = "surface", size = "md", loading = false,
  loadingLabel, leadingIcon, disabled, onClick, type = "button", ...props }: ButtonProps) {
  const unavailable = disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button data-slot="button" {...props} type={type} disabled={disabled} tabIndex={props.tabIndex ?? (disabled ? -1 : 0)}
      aria-disabled={unavailable || undefined} aria-busy={loading || props["aria-busy"] || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : props["aria-label"]}
      className={clsx(styles.button, className)} data-variant={variant} data-size={size}
      data-loading={loading || undefined}
      onClick={(event) => { if (unavailable) { event.preventDefault(); return; } onClick?.(event); }}>
      <span className={styles.buttonContent}>
        {leadingIcon && <span className={styles.icon} aria-hidden="true">{leadingIcon}</span>}{children}
      </span>
      {loading && <span className={styles.busy} aria-hidden="true"><Spinner /></span>}
    </button>
  );
}
