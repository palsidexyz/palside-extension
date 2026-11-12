"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { clsx } from "clsx";
import { motionPresets } from "@palside/design/motion";
import { Tooltip } from "../tooltip";
import { useMotionPolicy } from "../../hooks/use-motion-policy";
import styles from "./address-copy.module.css";

export type AddressCopyProps = {
  /** Full address; this exact text is copied. */
  address: string;
  /** Shortened address the caller formats (shortAddress). */
  display: string;
  /** Translated tooltip, e.g. 复制完整合约地址. */
  label: string;
  /** Translated accessible name including the full address. */
  ariaLabel: string;
  /** Leading mark such as the chain logo. */
  icon?: ReactNode;
  /** Called after the clipboard write settles. */
  onCopy?: (copied: boolean) => void;
  className?: string;
};
const CONFIRM_MS = 1400;

/** One way to show and copy a contract address: mark, shortened mono text, copy glyph that draws a check in place. */
export function AddressCopy({ address, display, label, ariaLabel, icon, onCopy, className }: AddressCopyProps) {
  const { reduced } = useMotionPolicy();
  const [copied, setCopied] = useState(false), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    let ok = true;
    try { await navigator.clipboard.writeText(address); } catch { ok = false; }
    onCopy?.(ok);
    if (!ok) return;
    setCopied(true); clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  }
  const transition = reduced ? motionPresets.reduced : motionPresets.feedback;
  return <Tooltip content={label}>
    <button type="button" className={clsx(styles.address, className)} data-slot="address-copy" data-copied={copied || undefined} aria-label={ariaLabel} onClick={() => void copy()}>
      {icon}<code>{display}</code>
      <span className={styles.glyph} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout">
        {copied
          ? <motion.svg key="check" viewBox="0 0 24 24" width={12} height={12} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={transition}>
              <motion.path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={reduced ? motionPresets.reduced : { duration: .28, ease: "easeOut" }} />
            </motion.svg>
          : <motion.span key="copy" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }} transition={transition}><Copy size={12} /></motion.span>}
      </AnimatePresence></span>
    </button>
  </Tooltip>;
}
