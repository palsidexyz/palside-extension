import type { CaptureColor,CaptureHandle,CaptureOp,CaptureSelection } from './drawing';

export type ImageDocumentSnapshot = { version: 1; width: number; height: number; crop: CaptureSelection; ops: CaptureOp[] };
export type ImageViewport = { width: number; height: number; scale: number; x: number; y: number };
export type ImagePoint = { x: number; y: number };
const colors = new Set<CaptureColor>(['#FF4D4F', '#FFB020', '#22C55E', '#3B82F6']);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const clone = (value: ImageDocumentSnapshot): ImageDocumentSnapshot => structuredClone(value);

export function imageCrop(start: ImagePoint, end: ImagePoint, width: number, height: number): CaptureSelection {
  const left = clamp(Math.min(start.x, end.x), 0, Math.max(0, width - 1));
  const top = clamp(Math.min(start.y, end.y), 0, Math.max(0, height - 1));
  return { x: left, y: top, width: clamp(Math.max(start.x, end.x), left + 1, width) - left, height: clamp(Math.max(start.y, end.y), top + 1, height) - top };
}
export function imageCropHandle(crop: CaptureSelection, handle: CaptureHandle, point: ImagePoint, width: number, height: number) {
  let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height;
  if (handle.includes('w')) left = clamp(point.x, 0, right - 1);
  if (handle.includes('e')) right = clamp(point.x, left + 1, width);
  if (handle.includes('n')) top = clamp(point.y, 0, bottom - 1);
  if (handle.includes('s')) bottom = clamp(point.y, top + 1, height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function fitImageViewport(width: number, height: number, imageWidth: number, imageHeight: number): ImageViewport {
  const scale = Math.max(.001, Math.min(1, Math.max(1, width - 32) / imageWidth, Math.max(1, height - 32) / imageHeight));
  return { width, height, scale, x: (width - imageWidth * scale) / 2, y: (height - imageHeight * scale) / 2 };
}
export function imagePoint(view: ImageViewport, point: ImagePoint): ImagePoint { return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }; }
export function zoomImageViewport(view: ImageViewport, scale: number, anchor: ImagePoint = { x: view.width / 2, y: view.height / 2 }): ImageViewport {
  const at = imagePoint(view, anchor);
  return { ...view, scale, x: anchor.x - at.x * scale, y: anchor.y - at.y * scale };
}
export function resizeImageViewport(view: ImageViewport, width: number, height: number): ImageViewport {
  return { ...view, width, height, x: view.x + (width - view.width) / 2, y: view.y + (height - view.height) / 2 };
}

/** Snapshots cross extension windows; reject malformed coordinates instead of accepting an opaque canvas state. */
export function readImageDocument(value: unknown, width: number, height: number): ImageDocumentSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as ImageDocumentSnapshot;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || input.version !== 1 || input.width !== width || input.height !== height || !Array.isArray(input.ops) || input.ops.length > 500) return;
  if (Object.keys(input).some(key => !['version', 'width', 'height', 'crop', 'ops'].includes(key))) return;
  const crop = input.crop;
  if (!crop || ![crop.x, crop.y, crop.width, crop.height].every(finite) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width + .001 || crop.y + crop.height > height + .001) return;
  const point = (p: ImagePoint) => p && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
  let points = 0;
  for (const op of input.ops) {
    if (!op || typeof op !== 'object' || !colors.has(op.color as CaptureColor)) return;
    if (op.kind === 'pen') { if (!Array.isArray(op.points) || !op.points.length || op.points.some(p => !point(p)) || (points += op.points.length) > 10000) return; }
    else if (op.kind === 'text') { if (!point(op) || typeof op.value !== 'string' || !op.value.trim() || op.value.length > 500) return; }
    else if (['arrow', 'rectangle', 'mosaic'].includes(op.kind)) {
      if (!point(op) || !finite(op.width) || !finite(op.height) || !point({ x: op.x + op.width, y: op.y + op.height }) || op.kind !== 'arrow' && (op.width < 0 || op.height < 0)) return;
    } else return;
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 256 * 1024) return;
    return clone(input);
  } catch { return; }
}

/** Pixel-space document and history are independent from every host window's viewport. */
export class ImageDocument {
  private value: ImageDocumentSnapshot;
  private past: ImageDocumentSnapshot[] = [];
  private future: ImageDocumentSnapshot[] = [];
  constructor(width: number, height: number, snapshot?: ImageDocumentSnapshot) {
    const value = readImageDocument(snapshot ?? { version: 1, width, height, crop: { x: 0, y: 0, width, height }, ops: [] }, width, height);
    if (!value) throw new Error('IMAGE_DOCUMENT_INVALID');
    this.value = value;
  }
  snapshot() { return clone(this.value); }
  get undoReady() { return this.past.length > 0; }
  get redoReady() { return this.future.length > 0; }
  get dirty() { const { crop, width, height, ops } = this.value; return Boolean(ops.length || crop.x || crop.y || crop.width !== width || crop.height !== height); }
  private commit(value: ImageDocumentSnapshot) {
    if (JSON.stringify(value) === JSON.stringify(this.value)) return false;
    this.past.push(this.value); if (this.past.length > 100) this.past.shift();
    this.future = []; this.value = value; return true;
  }
  add(op: CaptureOp) { const next = readImageDocument({ ...this.value, ops: [...this.value.ops, op] }, this.value.width, this.value.height); return Boolean(next && this.commit(next)); }
  setCrop(crop: CaptureSelection) { const next = readImageDocument({ ...this.value, crop }, this.value.width, this.value.height); return Boolean(next && this.commit(next)); }
  restore(snapshot: ImageDocumentSnapshot) { const next = readImageDocument(snapshot, this.value.width, this.value.height); if (!next) return false; this.commit(next); return true; }
  undo() { const previous = this.past.pop(); if (!previous) return false; this.future.push(this.value); this.value = previous; return true; }
  redo() { const next = this.future.pop(); if (!next) return false; this.past.push(this.value); this.value = next; return true; }
}
