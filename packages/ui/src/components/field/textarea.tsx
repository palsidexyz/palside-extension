"use client";

import type { ComponentPropsWithRef } from "react";
import { clsx } from "clsx";
import styles from "./field.module.css";

export type TextareaProps = ComponentPropsWithRef<"textarea">;

export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return <textarea data-slot="textarea" {...props} rows={rows} className={clsx(styles.textarea, className)} />;
}
