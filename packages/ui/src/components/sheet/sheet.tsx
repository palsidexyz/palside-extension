"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { clsx } from "clsx";
import { useBackdropDismiss } from "../../internal/backdrop-dismiss";
import { motionPresets } from "@palside/design/motion";
import styles from "./sheet.module.css";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id of the visible title inside the sheet. */
  "aria-labelledby": string;
  /** The sheet covers the intersection of this ancestor and the viewport; the whole viewport without it. */
  boundarySelector?: string;
  className?: string;
  children: ReactNode;
};

type SheetContentProps = Omit<SheetProps, "open">;

/** Native modal containment; the dialog stays mounted until its exit animation finishes. */
function SheetContent({ onOpenChange, "aria-labelledby": labelledBy, boundarySelector, className, children }: SheetContentProps) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropDismiss = useBackdropDismiss((event) => event.target === event.currentTarget, () => { if (present) onOpenChange(false); });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const boundary = boundarySelector ? dialog.closest(boundarySelector) : null;
    function position() {
      if (!dialog) return;
      const view = window.visualViewport;
      const x = view?.offsetLeft ?? 0, y = view?.offsetTop ?? 0;
      const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
      const rect = boundary?.getBoundingClientRect();
      const left = Math.max(x, rect?.left ?? x), top = Math.max(y, rect?.top ?? y);
      const right = Math.min(x + width, rect?.right ?? x + width), bottom = Math.min(y + height, rect?.bottom ?? y + height);
      Object.assign(dialog.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
    }
    dialog.showModal();
    position();
    // A sheet that exists to be typed into marks its field; others take focus on the sheet itself.
    (panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current)?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    if (boundary) observer.observe(boundary);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      dialog.close();
      if (previous?.isConnected && previous.checkVisibility()) previous.focus({ preventScroll: true });
    };
  }, [boundarySelector]);
  return <motion.dialog ref={dialogRef} className={styles.scrim} aria-labelledby={labelledBy} data-slot="sheet"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? motionPresets.reduced : motionPresets.feedback}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        if (present) onOpenChange(false);
      }
    }}
    onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (present) onOpenChange(false); }}
    {...backdropDismiss}>
    <motion.div ref={panelRef} tabIndex={-1} inert={!present} className={clsx(styles.sheet, className)} data-slot="sheet-content"
      initial={{ y: reduced ? 0 : 40, opacity: reduced ? 0 : 1 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduced ? 0 : 40, opacity: 0 }}
      transition={reduced ? motionPresets.reduced : { type: "spring", stiffness: 420, damping: 36 }}>
      {children}
    </motion.div>
  </motion.dialog>;
}

/** A bottom sheet: native dialog focus, Escape and background inertness, with an enter and exit slide. */
export function Sheet({ open, ...props }: SheetProps) {
  return <AnimatePresence>{open && <SheetContent key="sheet" {...props} />}</AnimatePresence>;
}
