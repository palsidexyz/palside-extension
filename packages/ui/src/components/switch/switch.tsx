"use client";

import { useId, type ComponentPropsWithRef } from "react";
import { clsx } from "clsx";
import { describedBy } from "../../internal/form-values";
import { HelpTip } from "../tooltip";
import hidden from "../../styles/visually-hidden.module.css";
import styles from "./switch.module.css";

export type SwitchProps = Omit<ComponentPropsWithRef<"input">, "type" | "role" | "size" | "children"> & {
  label: string;
  /** A short current state under the label (e.g. an end date), never an explanation. */
  status?: string;
  /** What the switch covers, shown on demand in a tooltip next to the label and read with the switch. */
  help?: { label: string; content: string };
  /** Keeps the label for assistive technology only; the switch stands alone (e.g. at the end of a row that already names it). */
  hideLabel?: boolean;
};

export function Switch({ label, status, help, hideLabel = false, className, id, ...props }: SwitchProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const statusId = `${controlId}-status`;
  const helpId = `${controlId}-help`;
  return <label className={clsx(styles.choice, styles.switchRow, className)} htmlFor={controlId} data-slot="switch" data-label={hideLabel ? "hidden" : undefined}>
    <input {...props} id={controlId} type="checkbox" role="switch" className={styles.nativeChoice} aria-label={props["aria-label"] ?? label}
      aria-describedby={describedBy(props["aria-describedby"], status ? statusId : undefined, help ? helpId : undefined)} />
    <span className={clsx(styles.choiceText, hideLabel && hidden.visuallyHidden)}>
      <span className={styles.choiceLabel}><span>{label}</span>{help && <HelpTip label={help.label} content={help.content} />}</span>
      {status && <span id={statusId} className={styles.status}>{status}</span>}
      {help && <span id={helpId} className={hidden.visuallyHidden}>{help.content}</span>}
    </span>
    <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
  </label>;
}
