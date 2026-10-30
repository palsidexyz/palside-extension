import type { CaptureLabels,PageUp } from '../browser/page-protocol';
import { ImageDocument,readImageDocument,fitImageViewport,imagePoint,imageCrop,imageCropHandle,resizeImageViewport,zoomImageViewport,type ImageDocumentSnapshot,type ImagePoint,type ImageViewport } from '../../domain/images/image-document.ts';
import { captureDimensions,drawOps,type CaptureColor,type CaptureHandle,type CaptureOp,type CaptureSelection,type CaptureTool } from '../../domain/images/drawing.ts';
import { encodeCapture } from './encode-capture.ts';

export type ImageWorkspaceTool = 'pan' | 'crop' | CaptureTool;
export type ImageWorkspaceState = { ready: boolean; dirty: boolean; tool: ImageWorkspaceTool; zoom: number; undoReady: boolean; redoReady: boolean; error?: string };
export type ImageWorkspaceOptions = { toolbarMount?: HTMLElement; snapshot?: ImageDocumentSnapshot; onStateChange?: (state: ImageWorkspaceState) => void; onDocumentChange?: (snapshot: ImageDocumentSnapshot) => void };
const colors: CaptureColor[] = ['#FF4D4F', '#FFB020', '#22C55E', '#3B82F6'];
const paths: Record<ImageWorkspaceTool | 'undo' | 'redo', string> = {
  pan: 'M8 13V5a2 2 0 0 1 4 0v7M12 11V3a2 2 0 0 1 4 0v10M16 11V7a2 2 0 0 1 4 0v9a6 6 0 0 1-6 6h-1a7 7 0 0 1-5-2L3 14a2 2 0 0 1 3-3l2 2',
  crop: 'M6 3v15h15M3 6h15v15', rectangle: 'M4 4h16v16H4z', arrow: 'M5 19 19 5M7 5h12v12',
  pen: 'm4 16-1 5 5-1L21 7l-4-4zM14 6l4 4', text: 'M4 7V4h16v3M9 20h6M12 4v16',
  mosaic: 'M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', redo: 'm15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13',
};
export type ImageWorkspaceLabels = CaptureLabels & { pan: string; crop: string; redo: string };

/** An original-pixel image document viewed through a disposable viewport; no chat render owns its lifetime. */
export function createImageWorkspace(stage: HTMLElement, send: (message: PageUp) => void, src: string, inputLabels: ImageWorkspaceLabels, options: ImageWorkspaceOptions = {}) {
  const labels: ImageWorkspaceLabels = { ...inputLabels };
  const root = document.createElement('div'); root.className = 'image-workspace'; root.tabIndex = 0;
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none', outline: 'none' });
  const canvas = document.createElement('canvas'); canvas.className = 'image-workspace-canvas';
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' }); root.append(canvas); stage.append(root);
  const toolbar = document.createElement('div'); toolbar.className = 'image-workspace-tools'; toolbar.setAttribute('role', 'toolbar');
  if (options.toolbarMount) options.toolbarMount.append(toolbar);
  const image = new Image();
  let documentState: ImageDocument | undefined, full: HTMLCanvasElement | undefined;
  let view: ImageViewport = { width: 1, height: 1, scale: 1, x: 0, y: 0 };
  let tool: ImageWorkspaceTool = 'pan', color: CaptureColor = colors[0]!, closed = false, error: string | undefined, fitted = true;
  let draft: CaptureOp | undefined, draftCrop: CaptureSelection | undefined;
  let text: HTMLTextAreaElement | undefined;
  let gesture: { id: number; kind: 'pan' | 'crop' | 'draw'; start: ImagePoint; imageStart: ImagePoint; origin: ImageViewport; crop?: CaptureSelection; handle?: CaptureHandle } | undefined;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const point = (event: PointerEvent | WheelEvent) => { const rect = root.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const originalPoint = (at: ImagePoint) => { const value = imagePoint(view, at); return { x: clamp(value.x, 0, image.naturalWidth), y: clamp(value.y, 0, image.naturalHeight) }; };
  const state = (): ImageWorkspaceState => ({ ready: Boolean(documentState), dirty: documentState?.dirty ?? false, tool, zoom: view.scale, undoReady: documentState?.undoReady ?? false, redoReady: documentState?.redoReady ?? false, ...(error ? { error } : {}) });
  function label(name: keyof typeof paths) { return labels[name]; }
  function sync() {
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    const undo = toolbar.querySelector<HTMLButtonElement>('[data-action=undo]'); if (undo) undo.disabled = !documentState?.undoReady;
    const redo = toolbar.querySelector<HTMLButtonElement>('[data-action=redo]'); if (redo) redo.disabled = !documentState?.redoReady;
    root.style.cursor = tool === 'pan' ? gesture ? 'grabbing' : 'grab' : tool === 'text' ? 'text' : 'crosshair';
    options.onStateChange?.(state());
  }
  function rebuild() {
    if (!documentState) return;
    full ??= document.createElement('canvas'); full.width = image.naturalWidth; full.height = image.naturalHeight;
    const context = full.getContext('2d', { willReadFrequently: true }); if (!context) return;
    context.drawImage(image, 0, 0); drawOps(context, documentState.snapshot().ops, 1);
  }
  function display() {
    if (closed || !documentState || !full) return;
    const dpr = window.devicePixelRatio || 1, width = Math.max(1, Math.round(view.width * dpr)), height = Math.max(1, Math.round(view.height * dpr));
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    context.drawImage(full, 0, 0);
    if (draft) {
      if (draft.kind === 'mosaic') { context.fillStyle = 'rgba(120,120,120,.65)'; context.fillRect(draft.x, draft.y, draft.width, draft.height); }
      else drawOps(context, [draft], 1);
    }
    const crop = draftCrop ?? documentState.snapshot().crop;
    context.fillStyle = 'rgba(0,0,0,.38)';
    context.fillRect(0, 0, image.naturalWidth, crop.y);
    context.fillRect(0, crop.y, crop.x, crop.height);
    context.fillRect(crop.x + crop.width, crop.y, image.naturalWidth - crop.x - crop.width, crop.height);
    context.fillRect(0, crop.y + crop.height, image.naturalWidth, image.naturalHeight - crop.y - crop.height);
    if (tool === 'crop') {
      context.strokeStyle = '#ccff00'; context.lineWidth = 1 / view.scale; context.strokeRect(crop.x, crop.y, crop.width, crop.height);
      context.fillStyle = '#fff'; const side = 7 / view.scale;
      for (const at of handles(crop)) context.fillRect(at.x - side / 2, at.y - side / 2, side, side);
    }
    positionText();
  }
  function changed() { rebuild(); display(); sync(); if (documentState) options.onDocumentChange?.(documentState.snapshot()); }
  function handles(crop: CaptureSelection) {
    return (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as CaptureHandle[]).map(handle => ({ handle, x: handle.includes('w') ? crop.x : handle.includes('e') ? crop.x + crop.width : crop.x + crop.width / 2, y: handle.includes('n') ? crop.y : handle.includes('s') ? crop.y + crop.height : crop.y + crop.height / 2 }));
  }
  function positionText() {
    if (!text) return;
    const x = Number(text.dataset.x), y = Number(text.dataset.y);
    Object.assign(text.style, { left: `${view.x + x * view.scale}px`, top: `${view.y + y * view.scale}px`, fontSize: `${Math.max(12, 18 * view.scale)}px`, color });
  }
  function textOperation(input: HTMLTextAreaElement): CaptureOp { return { kind: 'text', x: Number(input.dataset.x), y: Math.min(image.naturalHeight, Number(input.dataset.y) + 18), value: input.value.trim(), color }; }
  function notifyText() {
    if (!documentState) return;
    const current = documentState.snapshot();
    const next = text?.value.trim() ? readImageDocument({ ...current, ops: [...current.ops, textOperation(text)] }, current.width, current.height) : current;
    if (next) options.onDocumentChange?.(next);
  }
  function commitText(event?: Event) {
    if (event?.isTrusted === false) return;
    if (!text) return;
    const input = text; text = undefined;
    const value = input.value.trim(); input.remove();
    if (value && documentState?.add(textOperation(input))) changed();
  }
  function begin(event: PointerEvent) {
    if (event.isTrusted === false) return;
    if (closed || !documentState || event.button !== 0 || event.target === text) return;
    event.preventDefault(); commitText(); root.focus({ preventScroll: true });
    const at = point(event), start = originalPoint(at);
    if (tool !== 'pan' && (at.x < view.x || at.y < view.y || at.x > view.x + image.naturalWidth * view.scale || at.y > view.y + image.naturalHeight * view.scale)) return;
    if (tool === 'text') {
      text = document.createElement('textarea'); text.className = 'image-workspace-text'; text.rows = 1; text.maxLength = 500; text.setAttribute('aria-label', labels.text);
      text.dataset.x = String(start.x); text.dataset.y = String(start.y);
      Object.assign(text.style, { position: 'absolute', width: 'min(240px, 80%)', minHeight: '32px', resize: 'none', background: 'var(--ui-canvas,#fff)', border: '1px solid currentColor', padding: '4px', zIndex: '1', fontFamily: 'inherit' });
      text.addEventListener('input', event => { if (event.isTrusted === false) return; notifyText(); });
      text.addEventListener('keydown', event => { if (event.isTrusted === false) return; event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); text?.remove(); text = undefined; notifyText(); root.focus(); } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); commitText(); root.focus(); } });
      root.append(text); positionText(); text.focus(); return;
    }
    const crop = documentState.snapshot().crop;
    const handle = tool === 'crop' ? handles(crop).find(p => Math.hypot(p.x - start.x, p.y - start.y) * view.scale < 10)?.handle : undefined;
    gesture = { id: event.pointerId, kind: tool === 'pan' ? 'pan' : tool === 'crop' ? 'crop' : 'draw', start: at, imageStart: start, origin: { ...view }, crop, handle };
    if (tool === 'pen') draft = { kind: 'pen', points: [start], color };
    root.setPointerCapture(event.pointerId); sync();
  }
  function move(event: PointerEvent) {
    if (event.isTrusted === false) return;
    if (!gesture || event.pointerId !== gesture.id || !documentState) return;
    const at = point(event), original = originalPoint(at);
    if (gesture.kind === 'pan') { fitted = false; view = { ...view, x: gesture.origin.x + at.x - gesture.start.x, y: gesture.origin.y + at.y - gesture.start.y }; }
    else if (gesture.kind === 'crop') draftCrop = gesture.handle ? imageCropHandle(gesture.crop!, gesture.handle, original, image.naturalWidth, image.naturalHeight) : imageCrop(gesture.imageStart, original, image.naturalWidth, image.naturalHeight);
    else if (tool === 'pen' && draft?.kind === 'pen') { if (draft.points.length < 10000 && Math.hypot(original.x - draft.points.at(-1)!.x, original.y - draft.points.at(-1)!.y) > .25 / view.scale) draft.points.push(original); }
    else if (tool === 'arrow') draft = { kind: 'arrow', ...gesture.imageStart, width: original.x - gesture.imageStart.x, height: original.y - gesture.imageStart.y, color };
    else if (tool === 'rectangle' || tool === 'mosaic') draft = { kind: tool, ...imageCrop(gesture.imageStart, original, image.naturalWidth, image.naturalHeight), color };
    display();
  }
  function end(event: PointerEvent) {
    if (event.isTrusted === false) return;
    if (!gesture || event.pointerId !== gesture.id) return;
    let modified = false;
    if (draftCrop) modified = documentState?.setCrop(draftCrop) ?? false;
    if (draft) modified = documentState?.add(draft) ?? false;
    draft = undefined; draftCrop = undefined; gesture = undefined;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (modified) changed(); else { display(); sync(); }
  }
  function abandon(event: PointerEvent) { if (event.isTrusted === false) return; if (gesture?.id !== event.pointerId) return; gesture = undefined; draft = undefined; draftCrop = undefined; display(); sync(); }
  function zoom(factor: number, anchor?: ImagePoint) {
    if (!documentState) return;
    const minimum = Math.min(.1, fitImageViewport(view.width, view.height, image.naturalWidth, image.naturalHeight).scale / 2);
    view = zoomImageViewport(view, clamp(view.scale * factor, minimum, 8), anchor); fitted = false; display(); sync();
  }
  function wheel(event: WheelEvent) { if (event.isTrusted === false) return; event.preventDefault(); if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * .002), point(event)); else { fitted = false; view = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }; display(); } }
  function updateViewport() {
    const rect = stage.getBoundingClientRect(); const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    view = documentState && fitted ? fitImageViewport(width, height, image.naturalWidth, image.naturalHeight) : resizeImageViewport(view, width, height);
    display(); sync();
  }
  function resetView() { fitted = true; updateViewport(); }
  function setTool(next: ImageWorkspaceTool) { commitText(); gesture = undefined; draft = undefined; draftCrop = undefined; tool = next; display(); sync(); }
  function undo() { commitText(); if (documentState?.undo()) changed(); }
  function redo() { commitText(); if (documentState?.redo()) changed(); }
  function stop() {
    if (closed) return;
    closed = true; observer.disconnect(); window.removeEventListener('blur', commitText); root.remove(); toolbar.remove();
    image.removeEventListener('load', loaded); image.removeEventListener('error', failed);
  }
  function cancel() { if (closed) return; stop(); send({ type: 'capture-cancel' }); }
  function complete() {
    if (!documentState || !full || closed) return;
    commitText(); const crop = documentState.snapshot().crop;
    const out = document.createElement('canvas'); const size = captureDimensions(crop.width, crop.height); out.width = size.width; out.height = size.height;
    const context = out.getContext('2d');
    if (!context) { error = 'IMAGE_PROCESSING'; sync(); return; }
    try { context.drawImage(full, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height); const result = encodeCapture(out); error = undefined; sync(); send({ type: 'captured', src: result }); }
    catch { error = 'IMAGE_PROCESSING'; sync(); }
  }
  function updateLabels(next: ImageWorkspaceLabels) {
    Object.assign(labels, next); toolbar.setAttribute('aria-label', labels.done);
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('button[data-label]')) { const value = label(button.dataset.label as keyof typeof paths); button.title = value; button.setAttribute('aria-label', value); }
    text?.setAttribute('aria-label', labels.text);
  }
  function button(name: keyof typeof paths, click: () => void, action = false) {
    const item = document.createElement('button'); item.type = 'button'; item.dataset.label = name; item.title = label(name); item.setAttribute('aria-label', label(name));
    if (action) item.dataset.action = name; else { item.dataset.tool = name; item.setAttribute('aria-pressed', String(tool === name)); }
    item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
    item.addEventListener('click', event => { if (event.isTrusted === false) return; click(); }); toolbar.append(item);
  }
  for (const name of ['pan', 'crop', 'rectangle', 'arrow', 'pen', 'text', 'mosaic'] as ImageWorkspaceTool[]) button(name, () => setTool(name));
  for (const value of colors) { const item = document.createElement('button'); item.type = 'button'; item.className = 'image-workspace-color'; item.style.setProperty('--swatch', value); item.setAttribute('aria-label', value); item.setAttribute('aria-pressed', String(value === color)); item.addEventListener('click', event => { if (event.isTrusted === false) return; setColor(value); }); toolbar.append(item); }
  button('undo', undo, true); button('redo', redo, true);
  function setColor(next: CaptureColor) { color = next; for (const item of toolbar.querySelectorAll<HTMLButtonElement>('.image-workspace-color')) item.setAttribute('aria-pressed', String(item.style.getPropertyValue('--swatch') === next)); positionText(); }
  function keydown(event: KeyboardEvent) {
    if (event.isTrusted === false) return;
    if (event.target === text || event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (event.key === 'Escape' && tool !== 'pan') { event.preventDefault(); event.stopPropagation(); setTool('pan'); }
  }
  function loaded() {
    if (closed) return;
    if (options.snapshot && (options.snapshot.width !== image.naturalWidth || options.snapshot.height !== image.naturalHeight)) { error = 'IMAGE_DOCUMENT_MISMATCH'; sync(); return; }
    try { documentState = new ImageDocument(image.naturalWidth, image.naturalHeight, options.snapshot); rebuild(); updateViewport(); }
    catch { error = 'IMAGE_DOCUMENT_INVALID'; }
    sync();
  }
  function failed() { if (!closed) { error = 'IMAGE_UNAVAILABLE'; sync(); } }
  const observer = new ResizeObserver(updateViewport); observer.observe(stage);
  root.addEventListener('pointerdown', begin); root.addEventListener('pointermove', move); root.addEventListener('pointerup', end); root.addEventListener('pointercancel', abandon);
  root.addEventListener('wheel', wheel, { passive: false }); root.addEventListener('keydown', keydown); toolbar.addEventListener('keydown', keydown);
  window.addEventListener('blur', commitText);
  image.addEventListener('load', loaded, { once: true }); image.addEventListener('error', failed, { once: true }); image.src = src;
  return {
    stop, cancel, complete, updateLabels, setTool, setColor, zoomIn: () => zoom(1.25), zoomOut: () => zoom(.8), resetView, updateViewport, getState: state, undo, redo,
    getSnapshot: () => { commitText(); return documentState?.snapshot(); },
    restoreState(snapshot: ImageDocumentSnapshot) {
      if (closed) return false;
      if (!documentState) { const next = readImageDocument(snapshot, snapshot.width, snapshot.height); if (!next) return false; options.snapshot = next; return true; }
      commitText(); const accepted = documentState.restore(snapshot); if (accepted) { error = undefined; changed(); } return accepted;
    },
  };
}
