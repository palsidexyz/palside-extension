import { IMAGE_LIMIT } from './image-policy.ts';

export type CaptureSelection = { x: number; y: number; width: number; height: number };
export type CaptureViewport = { width: number; height: number };
export type CaptureHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CaptureTool = 'rectangle' | 'arrow' | 'pen' | 'text' | 'mosaic';
export type CaptureColor = '#FF4D4F' | '#FFB020' | '#22C55E' | '#3B82F6';
export type CaptureOp =
  | { kind: 'rectangle' | 'mosaic'; x: number; y: number; width: number; height: number; color?: CaptureColor }
  | { kind: 'arrow'; x: number; y: number; width: number; height: number; color: CaptureColor }
  | { kind: 'pen'; points: Array<{ x: number; y: number }>; color: CaptureColor }
  | { kind: 'text'; x: number; y: number; value: string; color: CaptureColor };
export const MIN_SELECTION = 8;
export const COLORS: CaptureColor[] = ['#FF4D4F', '#FFB020', '#22C55E', '#3B82F6'];
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
export function normalizeSelection(start: { x: number; y: number }, end: { x: number; y: number }, viewport: CaptureViewport): CaptureSelection {
  const left = clamp(Math.min(start.x, end.x), 0, viewport.width);
  const top = clamp(Math.min(start.y, end.y), 0, viewport.height);
  const right = clamp(Math.max(start.x, end.x), 0, viewport.width);
  const bottom = clamp(Math.max(start.y, end.y), 0, viewport.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function resizeSelection(selection: CaptureSelection, handle: CaptureHandle, dx: number, dy: number, viewport: CaptureViewport): CaptureSelection {
  let left = selection.x;
  let top = selection.y;
  let right = selection.x + selection.width;
  let bottom = selection.y + selection.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SELECTION);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_SELECTION, viewport.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SELECTION);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SELECTION, viewport.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function moveSelection(selection: CaptureSelection, dx: number, dy: number, viewport: CaptureViewport): CaptureSelection {
  return {
    ...selection,
    x: clamp(selection.x + dx, 0, viewport.width - selection.width),
    y: clamp(selection.y + dy, 0, viewport.height - selection.height),
  };
}
export function toolbarPlacement(selection: CaptureSelection, viewport: CaptureViewport, toolbar: { width: number; height: number; gap?: number }) {
  const gap = toolbar.gap ?? 8;
  const left = clamp(selection.x + selection.width - toolbar.width, 8, Math.max(8, viewport.width - toolbar.width - 8));
  const below = selection.y + selection.height + gap;
  const above = selection.y - toolbar.height - gap;
  const flipped = below + toolbar.height > viewport.height - 8 && above >= 8;
  return { left, top: flipped ? above : Math.min(below, viewport.height - toolbar.height - 8), flipped };
}
export function cropRectAtDpr(selection: CaptureSelection, dpr: number, image: { width: number; height: number }) {
  const x = clamp(Math.round(selection.x * dpr), 0, image.width);
  const y = clamp(Math.round(selection.y * dpr), 0, image.height);
  const right = clamp(Math.round((selection.x + selection.width) * dpr), x, image.width);
  const bottom = clamp(Math.round((selection.y + selection.height) * dpr), y, image.height);
  return { x, y, width: right - x, height: bottom - y };
}
export function mosaicBlockSize(dpr: number) {
  return Math.max(1, Math.round(12 * dpr));
}
export function undoAnnotations(ops: CaptureOp[]) {
  return ops.slice(0, -1);
}
function drawArrow(context: CanvasRenderingContext2D, op: Extract<CaptureOp, { kind: 'arrow' }>, scale: number) {
  const x1 = op.x * scale;
  const y1 = op.y * scale;
  const x2 = (op.x + op.width) * scale;
  const y2 = (op.y + op.height) * scale;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 10 * scale;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  context.stroke();
}
export function drawOps(context: CanvasRenderingContext2D, ops: CaptureOp[], scale: number) {
  for (const op of ops) {
    if (op.kind === 'mosaic') {
      const block = mosaicBlockSize(scale);
      const x = Math.max(0, Math.floor(op.x * scale));
      const y = Math.max(0, Math.floor(op.y * scale));
      const width = Math.max(0, Math.ceil(op.width * scale));
      const height = Math.max(0, Math.ceil(op.height * scale));
      for (let row = y; row < y + height; row += block) {
        for (let column = x; column < x + width; column += block) {
          const sample = context.getImageData(Math.min(column, context.canvas.width - 1), Math.min(row, context.canvas.height - 1), 1, 1).data;
          context.fillStyle = `rgb(${sample[0]} ${sample[1]} ${sample[2]})`;
          context.fillRect(column, row, block, block);
        }
      }
      continue;
    }
    context.strokeStyle = 'color' in op && op.color ? op.color : '#FF4D4F';
    context.fillStyle = context.strokeStyle;
    context.lineWidth = 3 * scale;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (op.kind === 'rectangle') {
      context.strokeRect(op.x * scale, op.y * scale, op.width * scale, op.height * scale);
    } else if (op.kind === 'arrow') {
      drawArrow(context, op, scale);
    } else if (op.kind === 'pen') {
      if (!op.points.length) continue;
      context.beginPath();
      context.moveTo(op.points[0]!.x * scale, op.points[0]!.y * scale);
      for (const point of op.points.slice(1)) context.lineTo(point.x * scale, point.y * scale);
      context.stroke();
    } else if (op.kind === 'text') {
      context.font = `700 ${18 * scale}px Geist, ui-sans-serif, system-ui, sans-serif`;
      context.lineWidth = 3 * scale;
      context.lineJoin = 'round';
      context.strokeStyle = 'rgb(0 0 0 / .45)';
      context.strokeText(op.value, op.x * scale, op.y * scale);
      context.fillStyle = op.color;
      context.fillText(op.value, op.x * scale, op.y * scale);
    }
  }
}
export function captureDimensions(width: number, height: number) {
  const scale = Math.min(1, IMAGE_LIMIT.maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
