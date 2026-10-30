"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { clsx } from "clsx";
import styles from "./field.module.css";

export type InputProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  type?: "text" | "search" | "email" | "url" | "tel" | "password" | "number";
  leadingIcon?: ReactNode;
};

/** Native value, composition, validation and form behavior pass through unchanged. `ref` is the input. */
export function Input({ className, leadingIcon, type = "text", ...props }: InputProps) {
  return <span className={styles.inputSurface} data-slot="input">
    {leadingIcon && <span className={styles.leadingIcon} aria-hidden="true">{leadingIcon}</span>}
    <input {...props} type={type} className={clsx(styles.input, className)} />
  </span>;
}
