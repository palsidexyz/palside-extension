type AnchorRect = { left: number; right: number; top: number; bottom: number; width: number };
type ViewportRect = { left: number; top: number; width: number; height: number };

/** Clamp horizontally and choose the side with enough room before constraining height. */
export function overlayPosition(anchor: AnchorRect, surface: { width: number; height: number }, viewport: ViewportRect, align: "start" | "end" = "start", preferred: "top" | "bottom" = "bottom") {
  const margin = 8;
  const gap = 8;
  const width = Math.min(surface.width, Math.max(0, viewport.width - margin * 2));
  const below = Math.max(0, viewport.top + viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - viewport.top - margin - gap);
  const preferredSpace = preferred === "bottom" ? below : above;
  const otherSpace = preferred === "bottom" ? above : below;
  const side = preferredSpace >= surface.height || preferredSpace >= otherSpace ? preferred : preferred === "bottom" ? "top" : "bottom";
  const maxHeight = side === "bottom" ? below : above;
  const height = Math.min(surface.height, maxHeight);
  const left = Math.max(viewport.left + margin, Math.min(align === "end" ? anchor.right - width : anchor.left, viewport.left + viewport.width - margin - width));
  const top = Math.max(viewport.top + margin, side === "bottom" ? anchor.bottom + gap : anchor.top - gap - height);
  return { left, top, width, maxHeight, side };
}
