"use client";

import { useEffect, useId, useRef, type DialogHTMLAttributes, type ReactNode, type RefObject } from "react";
import { clsx } from "clsx";
import { useBackdropDismiss } from "../../internal/backdrop-dismiss";
import styles from "./dialog.module.css";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  pending?: boolean;
  kind?: "confirmation" | "view";
  placement?: "center" | "bottom";
  boundarySelector?: string;
  /** Width of a confirmation dialog: `sm` 360px for decisions, `md` 520px for reading. */
  size?: "sm" | "md";
};

const WIDTH = { sm: 360, md: 520 };

export type DialogBehaviorOptions = Pick<DialogProps, "open" | "onOpenChange" | "initialFocusRef" | "pending"> & {
  /** Focus target when no initial target or tabbable content is available. */
  focusFallbackRef?: RefObject<HTMLElement | null>;
  /** Focus target when the element that opened the dialog is removed or hidden. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/** Native modal lifetime and dismissal without presentation or positioning. */
export function useDialogBehavior({ open, onOpenChange, initialFocusRef, focusFallbackRef, returnFocusRef, pending = false }: DialogBehaviorOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useBackdropDismiss((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }, () => { if (!pending) onOpenChange(false); });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocus = returnFocusRef?.current;
    const scrollParents: { element: HTMLElement; overflow: string; priority: string; top: number; left: number }[] = [];
    for (let parent = dialog.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        scrollParents.push({ element: parent, overflow: parent.style.getPropertyValue("overflow"), priority: parent.style.getPropertyPriority("overflow"), top: parent.scrollTop, left: parent.scrollLeft });
        parent.style.setProperty("overflow", "hidden");
      }
    }
    dialog.showModal();
    (initialFocusRef?.current ?? focusFallbackRef?.current)?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      for (const { element, overflow, priority, top, left } of scrollParents) {
        if (overflow) element.style.setProperty("overflow", overflow, priority);
        else element.style.removeProperty("overflow");
        element.scrollTop = top;
        element.scrollLeft = left;
      }
      const target = previous?.isConnected && previous.checkVisibility() ? previous : returnFocus;
      if (target?.isConnected && target.checkVisibility()) target.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef, focusFallbackRef, returnFocusRef]);
  const dialogProps: DialogHTMLAttributes<HTMLDialogElement> = {
    onKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) onOpenChange(false);
        return;
      }
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"))
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.checkVisibility());
      const first = targets[0];
      const last = targets.at(-1);
      if (!first) { event.preventDefault(); focusFallbackRef?.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    },
    onCancel(event) { event.stopPropagation(); event.preventDefault(); if (!pending) onOpenChange(false); },
    onClose(event) { if (open && !event.currentTarget.open) onOpenChange(false); },
    ...backdropDismiss,
  };
  return { dialogRef, dialogProps };
}

/** Native modal focus containment and inert background; lifetime is controlled by the caller. */
export function Dialog({ open, onOpenChange, title, description, children, headerAction, footer, initialFocusRef, pending = false, kind = "confirmation", placement = "center", boundarySelector, size = "sm" }: DialogProps) {
  const id = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { dialogRef, dialogProps } = useDialogBehavior({ open, onOpenChange, initialFocusRef, focusFallbackRef: titleRef, pending });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const boundary = boundarySelector ? dialog.closest(boundarySelector) : null;
    function position() {
      if (!dialog) return;
      if (!boundary && placement === "center") return;
      const r = boundary?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft ?? 0, viewTop = viewport?.offsetTop ?? 0;
      const left = Math.max(viewLeft, (r?.left ?? viewLeft)), right = Math.min(viewLeft + (viewport?.width ?? innerWidth), (r?.right ?? viewLeft + (viewport?.width ?? innerWidth)));
      const top = Math.max(viewTop, (r?.top ?? viewTop)), bottom = Math.min(viewTop + (viewport?.height ?? innerHeight), (r?.bottom ?? viewTop + (viewport?.height ?? innerHeight)));
      const width = Math.min(WIDTH[size], Math.max(0, right - left - 24));
      Object.assign(dialog.style, { position: 'fixed', width: `${width}px`, maxWidth: `${width}px`, maxHeight: `${Math.max(0, bottom - top - 24)}px`, margin: '0', left: `${left + (right - left - width) / 2}px`, top: placement === 'bottom' ? 'auto' : `${top + Math.max(12, (bottom - top - dialog.offsetHeight) / 2)}px`, bottom: placement === 'bottom' ? `${innerHeight - bottom + 12}px` : 'auto' });
    }
    position();
    const observer = new ResizeObserver(position);
    if (boundary) observer.observe(boundary);
    observer.observe(dialog);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    document.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      document.removeEventListener('scroll', position, true);
      for (const property of ["position", "width", "max-width", "max-height", "margin", "left", "top", "bottom"]) dialog.style.removeProperty(property);
    };
  }, [open, placement, boundarySelector, size, dialogRef]);
  return <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    className={clsx(styles.dialog, kind === "view" && styles.view)} data-slot="dialog" data-placement={placement} data-size={size}
    {...dialogProps}>
    <div className={styles.dialogLayout}>
      <header className={styles.dialogHeader}>{headerAction}<h2 ref={titleRef} id={`${id}-title`} tabIndex={-1}>{title}</h2></header>
      <div className={styles.dialogBody}>{description && <p id={`${id}-description`} className={styles.dialogDescription}>{description}</p>}{children}</div>
      {footer && <footer className={styles.dialogFooter}>{footer}</footer>}
    </div>
  </dialog>;
}
