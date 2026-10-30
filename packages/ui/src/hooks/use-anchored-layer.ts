"use client";

import { useCallback, useLayoutEffect, useRef, type ToggleEvent } from "react";
import { overlayPosition } from "../internal/overlay-position";

/** Native top-layer rendering avoids clipping by the side panel's scroll container. */
export function useAnchoredLayer({ align = "start", side = "bottom", boundarySelector }: { align?: "start" | "end"; side?: "top" | "bottom"; boundarySelector?: string } = {}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const position = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer?.matches(":popover-open")) return;
    const rect = anchor.getBoundingClientRect();
    const view = window.visualViewport;
    let viewport = { left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0, width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight };
    const boundary = boundarySelector ? anchor.closest(boundarySelector)?.getBoundingClientRect() : undefined;
    if (boundary) {
      const left = Math.max(viewport.left, boundary.left);
      const top = Math.max(viewport.top, boundary.top);
      const right = Math.min(viewport.left + viewport.width, boundary.right);
      const bottom = Math.min(viewport.top + viewport.height, boundary.bottom);
      viewport = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }
    if (!anchor.checkVisibility() || viewport.width <= 0 || viewport.height <= 0 || rect.right <= viewport.left || rect.left >= viewport.left + viewport.width || rect.bottom <= viewport.top || rect.top >= viewport.top + viewport.height) {
      layer.hidePopover();
      return;
    }
    layer.style.maxWidth = `${Math.max(0, viewport.width - 16)}px`;
    layer.style.setProperty("--anchored-layer-width", layer.style.maxWidth);
    const measured = layer.getBoundingClientRect();
    const result = overlayPosition(rect, { width: measured.width, height: layer.scrollHeight }, viewport, align, side);
    layer.style.left = `${result.left}px`;
    layer.style.top = `${result.top}px`;
    layer.style.maxHeight = `${result.maxHeight}px`;
    layer.dataset.side = result.side;
    layer.style.visibility = "visible";
  }, [align, side, boundarySelector]);
  const close = useCallback((restoreFocus = true) => {
    const layer = layerRef.current;
    if (layer?.matches(":popover-open")) layer.hidePopover();
    if (restoreFocus && anchorRef.current?.checkVisibility()) anchorRef.current.focus({ preventScroll: true });
  }, []);
  const onBeforeToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    if (event.newState === "open") event.currentTarget.style.visibility = "hidden";
  }, []);
  const onToggle = useCallback(() => {
    disposeRef.current?.();
    disposeRef.current = null;
    if (!layerRef.current?.matches(":popover-open")) return;
    position();
    if (!layerRef.current?.matches(":popover-open")) return;
    const observer = new ResizeObserver(position);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (layerRef.current) observer.observe(layerRef.current);
    const boundary = boundarySelector ? anchorRef.current?.closest(boundarySelector) : null;
    if (boundary) observer.observe(boundary);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    disposeRef.current = () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [position, boundarySelector]);
  useLayoutEffect(() => {
    onToggle();
    return () => { disposeRef.current?.(); disposeRef.current = null; };
  }, [onToggle]);
  return { anchorRef, layerRef, close, onBeforeToggle, onToggle };
}
