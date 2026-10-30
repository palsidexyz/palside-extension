"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { clsx } from "clsx";
import { motionPresets } from "@palside/design/motion";
import { Button } from "../button";
import { useMotionPolicy } from "../../hooks/use-motion-policy";
import styles from "./inline-feedback.module.css";

export type InlineFeedbackProps = {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "error";
  action?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean };
  className?: string;
};
const icons = { neutral: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

/** Errors are announced assertively, other tones politely; the action sits outside the live region. */
export function InlineFeedback({ children, tone = "neutral", action, className }: InlineFeedbackProps) {
  const { reduced, entrance } = useMotionPolicy();
  const Icon = icons[tone];
  const assertive = tone === "error";
  return <motion.div initial={entrance ? { opacity: 0, y: 3 } : false} animate={{ opacity: 1, y: 0 }}
    transition={reduced ? motionPresets.reduced : motionPresets.feedback}
    className={clsx(styles.feedback, className)} data-slot="inline-feedback" data-tone={tone}>
    <Icon className={styles.feedbackIcon} size={18} aria-hidden="true" />
    <div className={styles.feedbackMessage} role={assertive ? "alert" : "status"} aria-live={assertive ? "assertive" : "polite"} aria-atomic="true">{children}</div>
    {action && <Button className={styles.feedbackAction} size="sm" loading={action.loading} disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>}
  </motion.div>;
}
