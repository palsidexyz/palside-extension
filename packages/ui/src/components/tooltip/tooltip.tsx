"use client";

import { useEffect, useId, useRef, type ReactElement } from "react";
import { Slot } from "@radix-ui/react-slot";
import { describedBy } from "../../internal/form-values";
import { useAnchoredLayer } from "../../hooks/use-anchored-layer";
import styles from "./tooltip.module.css";

export type TooltipProps = {
  content: string;
  /** One focusable button that forwards its ref and DOM event props. */
  children: ReactElement<{ "aria-describedby"?: string }>;
};

export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const { anchorRef, layerRef, close: closeLayer, onBeforeToggle, onToggle } = useAnchoredLayer({ side: "top" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearTimer() { if (timer.current) clearTimeout(timer.current); timer.current = null; }
  function show(delay: number) {
    clearTimer();
    timer.current = setTimeout(() => {
      if (anchorRef.current?.checkVisibility() && !layerRef.current?.matches(":popover-open")) layerRef.current?.showPopover();
    }, delay);
  }
  function hide() { clearTimer(); closeLayer(false); }
  function leave() { clearTimer(); timer.current = setTimeout(() => closeLayer(false), 120); }
  useEffect(() => {
    const close = () => { if (timer.current) clearTimeout(timer.current); closeLayer(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (layerRef.current?.matches(":popover-open")) { event.preventDefault(); event.stopPropagation(); }
      close();
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", close);
    return () => { close(); document.removeEventListener("keydown", escape, true); document.removeEventListener("pointerdown", close); };
  }, [closeLayer, layerRef]);
  return <>
    <Slot ref={anchorRef} title="" aria-describedby={describedBy(children.props["aria-describedby"], id)}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") show(350); }} onPointerLeave={leave}
      onFocus={() => show(0)} onBlur={hide}>{children}</Slot>
    <div ref={layerRef} id={id} popover="manual" role="tooltip" className={styles.tooltip} data-slot="tooltip"
      onBeforeToggle={onBeforeToggle} onToggle={onToggle} onPointerEnter={clearTimer} onPointerLeave={leave}>{content}</div>
  </>;
}
