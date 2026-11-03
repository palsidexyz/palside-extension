"use client";

import { useId, type ReactNode } from "react";
import { clsx } from "clsx";
import { describedBy } from "../../internal/form-values";
import hidden from "../../styles/visually-hidden.module.css";
import styles from "./field.module.css";

export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};
export type FieldProps = {
  id?: string;
  label: string;
  /** Keeps the label for assistive technology when a surrounding title already names the control. */
  hideLabel?: boolean;
  /** Muted marker beside the label, e.g. a translated "Optional". */
  optional?: string;
  hint?: string;
  error?: string;
  counter?: ReactNode;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
};

/** Explicit render props link one control to its label, hint, error and count. */
export function Field({ id, label, hideLabel = false, optional, hint, error, counter, className, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const countId = `${controlId}-count`;
  return <div className={clsx(styles.field, className)} data-slot="field">
    <label className={clsx(styles.fieldLabel, hideLabel && hidden.visuallyHidden)} htmlFor={controlId}>{label}{optional && <span className={styles.optional}>{optional}</span>}</label>
    {children({ id: controlId, "aria-invalid": Boolean(error),
      "aria-describedby": describedBy(hint ? hintId : undefined, error ? errorId : undefined, counter != null ? countId : undefined) })}
    <div className={styles.fieldFooter}>
      <div className={styles.fieldNotes}>
        {hint && <p id={hintId} className={styles.hint}>{hint}</p>}
        <p id={errorId} className={styles.error} aria-live="polite" aria-atomic="true">{error}</p>
      </div>
      {counter != null && <span id={countId} className={styles.fieldCounter}>{counter}</span>}
    </div>
  </div>;
}
