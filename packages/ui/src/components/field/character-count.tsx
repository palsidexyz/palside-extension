import { clsx } from "clsx";
import { Counter } from "../counter";
import { lengthState } from "../../internal/form-values";
import hidden from "../../styles/visually-hidden.module.css";
import styles from "./field.module.css";

export type CharacterCountProps = { value: string; limit: number; className?: string; label?: string };

/** Quiet descriptive text, not a live region that announces every keystroke. */
export function CharacterCount({ value, limit, className, label }: CharacterCountProps) {
  const { count, maximum, exceeded } = lengthState(value, limit);
  return <span className={clsx(styles.count, className)} data-slot="character-count" data-exceeded={exceeded || undefined}>
    <span aria-hidden="true"><Counter value={count} separator="" /> / {maximum}</span>
    <span className={hidden.visuallyHidden}>{label ?? `${count} characters, maximum ${maximum}${exceeded ? `, ${count - maximum} over` : ""}`}</span>
  </span>;
}
