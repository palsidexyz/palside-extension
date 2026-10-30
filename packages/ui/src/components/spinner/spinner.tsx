import { LoaderCircle } from "lucide-react";
import { clsx } from "clsx";
import styles from "./spinner.module.css";

export type SpinnerProps = {
  size?: number;
  /** Announced as a status; without it the spinner is decorative and the surrounding control carries the state. */
  label?: string;
  className?: string;
};

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  const icon = <LoaderCircle className={clsx(styles.spinner, className)} size={size} aria-hidden="true" data-slot="spinner" />;
  return label ? <span role="status" aria-label={label} className={styles.status}>{icon}</span> : icon;
}
