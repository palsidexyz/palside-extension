"use client";

import { useContext, type ComponentProps } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { MotionConfigContext } from "motion/react";
import { clsx } from "clsx";
import hidden from "../../styles/visually-hidden.module.css";
import styles from "./counter.module.css";

/** `compact`: 1.2K past a thousand, for counts that may grow large in a narrow slot. */
export type CounterProps = Omit<ComponentProps<"span">, "children"> & { value: number; separator?: string; compact?: boolean };

/** Rolling digits from NumberFlow (MIT); its runtime <style> takes the CSP nonce that MotionConfig already carries.
    The digits live in a shadow root, so the plain value stays in the text for screen readers, find and copy. */
export function Counter({ value, separator = ",", compact = false, className, ...props }: CounterProps) {
  const { nonce } = useContext(MotionConfigContext);
  const amount = Number.isFinite(value) ? Math.round(value) : 0;
  const grouping = separator !== "";
  const format: Format = compact ? { notation: "compact", maximumFractionDigits: 1 } : { useGrouping: grouping };
  return <span {...props} data-slot="counter" className={clsx(styles.counter, className)}>
    <span className={hidden.visuallyHidden}>{amount.toLocaleString("en-US", format)}</span>
    <NumberFlow value={amount} locales="en-US" format={format} nonce={nonce} aria-hidden="true" />
  </span>;
}
