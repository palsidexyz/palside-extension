"use client";

import { Info } from "lucide-react";
import { clsx } from "clsx";
import { IconButton } from "../button";
import { Tooltip } from "./tooltip";
import styles from "./tooltip.module.css";

export type HelpTipProps = { label: string; content: string; className?: string };

/** A small focusable "i" next to a name: the explanation lives in its tooltip, never as resident text. */
export function HelpTip({ label, content, className }: HelpTipProps) {
  return <Tooltip content={content}><IconButton label={label} size="sm" variant="quiet" className={clsx(styles.helpTip, className)}><Info size={14} /></IconButton></Tooltip>;
}
