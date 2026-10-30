"use client";

import type { ComponentPropsWithRef } from "react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import styles from "./field.module.css";

export type PinInputProps = Omit<ComponentPropsWithRef<"input">, "type" | "value" | "onChange" | "maxLength"> & {
  value: string;
  length?: number;
  onValueChange: (value: string) => void;
  /** Shows the digits instead of masking them, for a PIN the person is choosing. */
  reveal?: boolean;
  /** Draws each cell with a hairline border and a caret in the active cell, for the local password. */
  outlined?: boolean;
  /**
   * Accepts more than digits: maps typed or pasted text to the allowed characters (e.g. uppercase a short code).
   * Without it the field keeps ASCII digits only and opens the numeric keyboard.
   */
  normalize?: (value: string) => string;
};

/**
 * One native input drawn as digit cells: paste, autofill, IME and screen readers see a single field.
 * Digits are masked unless `reveal` is set; the active cell follows the caret.
 */
export function PinInput({ value, length = 6, onValueChange, reveal = false, outlined = false, normalize, className, onSelect, onFocus, ...props }: PinInputProps) {
  const [caret, setCaret] = useState(value.length);
  const active = Math.min(caret, value.length, length - 1);
  const normalizeValue = (text: string) => (normalize ? normalize(text) : text.replace(/[^0-9]/g, "")).slice(0, length);
  const trackSelection = (input: HTMLInputElement) => setCaret((input.selectionDirection === "backward" ? input.selectionStart : input.selectionEnd) ?? input.value.length);
  const root = useRef<HTMLSpanElement>(null);
  // React's onSelect misses programmatic and some keyboard caret moves; the document event sees every change.
  useEffect(() => {
    const update = () => { const input = document.activeElement; if (input instanceof HTMLInputElement && root.current?.contains(input)) trackSelection(input); };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);
  return <span ref={root} className={clsx(styles.pin, className)} data-slot="pin-input" data-outlined={outlined || undefined} style={{ ["--pin-length" as string]: length }}>
    {Array.from({ length }, (_, index) => <span key={index} className={styles.pinCell} data-filled={index < value.length || undefined} data-active={index === active || undefined} data-reveal={reveal || undefined} aria-hidden="true">{reveal ? value[index] : null}</span>)}
    <input
      {...props}
      type={reveal ? "text" : "password"}
      {...normalize ? { inputMode: "text" as const, autoCapitalize: "characters", spellCheck: false } : { inputMode: "numeric" as const, pattern: "[0-9]*" }}
      value={value}
      className={styles.pinInput}
      onFocus={event => { trackSelection(event.currentTarget); onFocus?.(event); }}
      onSelect={event => { trackSelection(event.currentTarget); onSelect?.(event); }}
      onChange={event => {
        if (props.disabled) return;
        const input = event.currentTarget;
        const text = input.value;
        const next = normalizeValue(text);
        const start = normalizeValue(text.slice(0, input.selectionStart ?? text.length)).length;
        const end = normalizeValue(text.slice(0, input.selectionEnd ?? text.length)).length;
        const direction = input.selectionDirection;
        input.value = next;
        input.setSelectionRange(start, end, direction ?? undefined);
        trackSelection(input);
        onValueChange(next);
      }}
    />
  </span>;
}
