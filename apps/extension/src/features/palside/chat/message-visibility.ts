type Bounds = { top: number; bottom: number; left: number; right: number };

/** Tall messages can fill the viewport without exposing most of their own area. */
export function isMessageVisible(message: Bounds, viewport: Bounds): boolean {
  const width = Math.min(message.right - message.left, viewport.right - viewport.left);
  const height = Math.min(message.bottom - message.top, viewport.bottom - viewport.top);
  if (width <= 0 || height <= 0) return false;
  const visibleWidth = Math.max(0, Math.min(message.right, viewport.right) - Math.max(message.left, viewport.left));
  const visibleHeight = Math.max(0, Math.min(message.bottom, viewport.bottom) - Math.max(message.top, viewport.top));
  return visibleWidth * visibleHeight >= width * height * 0.6;
}
