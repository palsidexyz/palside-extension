"use client";

import { createContext, use, useId, useMemo, useRef, useState, type ComponentPropsWithRef, type ReactNode, type RefCallback, type RefObject } from "react";
import { Slot } from "@radix-ui/react-slot";
import { clsx } from "clsx";
import { useAnchoredLayer } from "../../hooks/use-anchored-layer";
import styles from "./popover.module.css";

type PopoverContextValue = ReturnType<typeof useAnchoredLayer> & {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  /** True while a pointer press opened the layer: focus then lands on the layer, not on its first item. */
  pointerOpenRef: RefObject<boolean>;
  kind: "dialog" | "menu";
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

/** Open state and `close(restoreFocus?)` for content rendered inside a Popover or Menu. */
export function usePopoverContext() {
  const context = use(PopoverContext);
  if (!context) throw new Error("Popover parts must be rendered inside <Popover> or <Menu>.");
  return context;
}

export type PopoverProps = {
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "end";
  /** The layer stays inside the intersection of this ancestor and the viewport. */
  boundarySelector?: string;
  children: ReactNode;
};

export function PopoverRoot({ kind, onOpenChange, side, align, boundarySelector, children }: PopoverProps & { kind: PopoverContextValue["kind"] }) {
  const id = useId();
  const layer = useAnchoredLayer({ side, align, boundarySelector });
  const [open, setOpen] = useState(false);
  const pointerOpenRef = useRef(false);
  return <PopoverContext value={{ ...layer, id, open, setOpen, onOpenChange, pointerOpenRef, kind }}>{children}</PopoverContext>;
}

/** An anchored, light-dismiss layer in the browser top layer. */
export function Popover(props: PopoverProps) {
  return <PopoverRoot kind="dialog" {...props} />;
}

function mergeRefs<T>(...refs: (RefObject<T | null> | RefCallback<T> | null | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        return typeof cleanup === "function" ? cleanup : () => { ref(null); };
      }
      if (ref) {
        ref.current = node;
        return () => { ref.current = null; };
      }
    });
    return () => { for (const cleanup of cleanups) cleanup?.(); };
  };
}

export type PopoverTriggerProps = ComponentPropsWithRef<"button"> & { asChild?: boolean };

export function PopoverTrigger({ asChild = false, ref, onPointerDown, onKeyDown, ...props }: PopoverTriggerProps) {
  const { id, open, anchorRef, pointerOpenRef, kind } = usePopoverContext();
  const mergedRef = useMemo(() => mergeRefs(anchorRef, ref), [anchorRef, ref]);
  const Component = asChild ? Slot : "button";
  return <Component type={asChild ? undefined : "button"} data-slot={`${kind === "menu" ? "menu" : "popover"}-trigger`} data-state={open ? "open" : "closed"}
    {...props} ref={mergedRef} popoverTarget={id} aria-haspopup={kind} aria-expanded={open}
    onPointerDown={(event) => { pointerOpenRef.current = true; onPointerDown?.(event); }}
    onKeyDown={(event) => { pointerOpenRef.current = false; onKeyDown?.(event); }} />;
}

export type PopoverContentProps = ComponentPropsWithRef<"div">;

/** Shared layer behavior: positioning, focus on open, close when focus leaves, Escape returns focus to the trigger. */
export function PopoverLayer({ className, ref, onToggle, onBlur, onKeyDown, firstFocus, ...props }: PopoverContentProps & { firstFocus: string }) {
  const { id, open, setOpen, onOpenChange, layerRef, anchorRef, close, onBeforeToggle, onToggle: position, pointerOpenRef, kind } = usePopoverContext();
  const mergedRef = useMemo(() => mergeRefs(layerRef, ref), [layerRef, ref]);
  return <div role={kind} tabIndex={-1} {...props} ref={mergedRef} id={id} popover="auto"
    className={clsx(styles.content, className)} data-slot={`${kind === "menu" ? "menu" : "popover"}-content`} data-state={open ? "open" : "closed"}
    onBeforeToggle={onBeforeToggle}
    onToggle={(event) => {
      position();
      const next = event.newState === "open";
      setOpen(next);
      onOpenChange?.(next);
      if (next) {
        const layer = layerRef.current;
        (pointerOpenRef.current ? layer : layer?.querySelector<HTMLElement>(firstFocus) ?? layer)?.focus({ preventScroll: true });
        pointerOpenRef.current = false;
      }
      onToggle?.(event);
    }}
    onBlur={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next) && !anchorRef.current?.contains(next)) close(false);
      onBlur?.(event);
    }}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
    }} />;
}

export function PopoverContent(props: PopoverContentProps) {
  return <PopoverLayer {...props} firstFocus="button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])" />;
}
