"use client";

import { useId, type ComponentPropsWithRef } from "react";
import { clsx } from "clsx";
import styles from "./checkbox.module.css";

export type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type" | "role" | "size" | "children"> & { label: string };

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return <label className={clsx(styles.choice, className)} htmlFor={controlId} data-slot="checkbox">
    <input {...props} id={controlId} type="checkbox" className={styles.nativeChoice} aria-label={props["aria-label"] ?? label} />
    <span className={styles.checkboxBox} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path className={styles.checkPath} d="M7.4 12.4 10.6 15.5 16.6 8.9" pathLength="1" />
      </svg>
    </span>
    <span className={styles.choiceText}><span>{label}</span></span>
  </label>;
}
