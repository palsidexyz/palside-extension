import type { CaptureLabels,PageUp } from '../runtime/browser/page-protocol';
import { type CaptureSelection,type CaptureHandle,type CaptureTool,type CaptureColor,type CaptureOp,MIN_SELECTION,COLORS,clamp,normalizeSelection,resizeSelection,moveSelection,toolbarPlacement,cropRectAtDpr,undoAnnotations,drawOps,captureDimensions } from '../domain/images/drawing.ts';
import { encodeCapture } from '../runtime/media/encode-capture.ts';

function icon(path: string) {
  const element = document.createElement('span');
  element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><${path}/></svg>`;
  return element.firstElementChild as SVGElement;
}
function makeButton(title: string, path: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(path));
  return button;
}
function pointerPoint(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function exportCapture(image: HTMLImageElement, selection: CaptureSelection, ops: CaptureOp[], dpr: number) {
  const crop = cropRectAtDpr(selection, dpr, { width: image.naturalWidth, height: image.naturalHeight });
  const canvas = document.createElement('canvas');
  const dimensions = captureDimensions(crop.width, crop.height);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  drawOps(context, ops, canvas.width / Math.max(1, selection.width));
  return canvas;
}
/**
 * 截图并标注, on the page. Two phases:
 * - select: the frozen page under a scrim; drag out a region (a plain click takes the whole view).
 * - edit: the region keeps its handles and the toolbar sits under it. With no tool, dragging inside moves the region;
 *   with a tool, dragging inside draws. Once something is drawn the region is fixed, so marks never drift off what they point at.
 * Enter or a double click finishes, Esc steps back (text → tool → cancel).
 */
export function createCaptureEditor(stage: HTMLElement, send: (message: PageUp) => void, src: string, inputLabels: CaptureLabels, onClose?: () => void, options?: { timeoutMs?: number | null }) {
  const labels = { ...inputLabels };
  const editor = document.createElement('div');
  editor.className = 'capture-editor';
  editor.dataset.phase = 'select';
  editor.innerHTML = `<img class="capture-image" alt=""><div class="capture-scrim"></div><div class="capture-selection" hidden><canvas class="capture-canvas"></canvas><span class="capture-size"></span></div><div class="capture-toolbar" role="toolbar" hidden></div><div class="capture-toast" hidden></div>`;
  const image = editor.querySelector<HTMLImageElement>('.capture-image')!;
  const selectionElement = editor.querySelector<HTMLElement>('.capture-selection')!;
  const canvas = editor.querySelector<HTMLCanvasElement>('.capture-canvas')!;
  const sizeLabel = editor.querySelector<HTMLElement>('.capture-size')!;
  const toolbar = editor.querySelector<HTMLElement>('.capture-toolbar')!;
  const toast = editor.querySelector<HTMLElement>('.capture-toast')!;
  toolbar.setAttribute('aria-label', labels.done);
  image.src = src;
  stage.append(editor);
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  const imageScale = () => image.naturalWidth / Math.max(1, viewport().width);
  const dpr = window.devicePixelRatio || 1;
  let selection: CaptureSelection | undefined;
  let tool: CaptureTool | undefined;
  let color: CaptureColor = COLORS[0]!;
  let ops: CaptureOp[] = [];
  let draft: CaptureOp | undefined;
  let text: HTMLElement | undefined;
  let active: { kind: 'select' | 'move' | 'resize' | 'draw'; start: { x: number; y: number }; selection?: CaptureSelection; handle?: CaptureHandle } | undefined;
  let closed = false;

  const finish = (message: PageUp) => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('pagehide', cancelCapture);
    editor.remove();
    onClose?.();
    send(message);
  };
  const cancelCapture = () => finish({ type: 'capture-cancel' });
  const timeout = options?.timeoutMs === null ? undefined : setTimeout(cancelCapture, options?.timeoutMs ?? 120_000);
  window.addEventListener('pagehide', cancelCapture, { once: true });
  const layout = () => {
    if (!selection) return;
    editor.dataset.phase = 'edit';
    editor.dataset.locked = String(ops.length > 0);
    selectionElement.hidden = false;
    toolbar.hidden = false;
    Object.assign(selectionElement.style, { left: `${selection.x}px`, top: `${selection.y}px`, width: `${selection.width}px`, height: `${selection.height}px` });
    sizeLabel.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)}`;
    sizeLabel.dataset.inside = String(selection.y < 24);
    const placement = toolbarPlacement(selection, viewport(), { width: toolbar.offsetWidth || 420, height: toolbar.offsetHeight || 38 });
    toolbar.style.left = `${placement.left}px`; toolbar.style.top = `${placement.top}px`;
    render();
  };
  const render = () => {
    if (!selection || !image.naturalWidth) return;
    const crop = cropRectAtDpr(selection, imageScale(), { width: image.naturalWidth, height: image.naturalHeight });
    canvas.width = Math.max(1, Math.round(selection.width * dpr));
    canvas.height = Math.max(1, Math.round(selection.height * dpr));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    // The canvas sits exactly over the same pixels, so drawing the crop under the marks changes nothing on screen
    // and gives mosaic the screenshot to sample: what is shown is what gets exported.
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    drawOps(context, draft ? [...ops, draft] : ops, dpr);
  };
  const local = (point: { x: number; y: number }) => selection ? { x: clamp(point.x - selection.x, 0, selection.width), y: clamp(point.y - selection.y, 0, selection.height) } : point;
  const shape = (kind: CaptureTool, from: { x: number; y: number }, to: { x: number; y: number }): CaptureOp | undefined => {
    if (kind === 'arrow') return { kind, x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y, color };
    if (kind === 'rectangle' || kind === 'mosaic') return { kind, x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y), color };
    return undefined;
  };
  const exportImage = () => exportCapture(image, selection!, ops, imageScale());
  const complete = () => {
    if (!image.naturalWidth || !selection) return;
    commitText();
    finish({ type: 'captured', src: encodeCapture(exportImage()) });
  };
  const flash = (value: string) => {
    toast.textContent = value;
    toast.hidden = false;
    Object.assign(toast.style, { left: toolbar.style.left, top: `${parseFloat(toolbar.style.top) + (toolbar.offsetHeight + 8) * (parseFloat(toolbar.style.top) > (selection?.y ?? 0) ? 1 : -1)}px` });
    window.setTimeout(() => { toast.hidden = true; }, 1200);
  };
  const copy = async () => {
    if (!image.naturalWidth || !selection || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
    commitText();
    const blob = await new Promise<Blob | null>(resolve => exportImage().toBlob(resolve, 'image/png'));
    if (!blob) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); flash(labels.copied); } catch { /* the page refused clipboard access */ }
  };
  const selectTool = (next: CaptureTool | undefined) => {
    tool = next;
    editor.dataset.tool = next ?? '';
    toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === next)));
  };
  const commitText = () => {
    if (!text) return;
    const input = text; text = undefined;
    const value = input.textContent?.trim();
    if (value && selection) ops = [...ops, { kind: 'text', x: parseFloat(input.style.left) - selection.x + 2, y: parseFloat(input.style.top) - selection.y + 18, value, color: input.dataset.color as CaptureColor }];
    input.remove();
    layout();
  };
  const addText = (point: { x: number; y: number }) => {
    commitText();
    const input = document.createElement('div');
    input.contentEditable = 'true';
    input.className = 'capture-text-input';
    input.dataset.color = color;
    Object.assign(input.style, { left: `${point.x}px`, top: `${point.y - 12}px`, color });
    editor.append(input);
    text = input;
    requestAnimationFrame(() => input.focus());
    input.addEventListener('keydown', event => {
      if (event.isTrusted === false) return;
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitText(); }
      if (event.key === 'Escape') { event.preventDefault(); text = undefined; input.remove(); }
    });
    input.addEventListener('blur', event => { if (event.isTrusted === false) return; if (text === input) commitText(); });
  };
  const inside = (point: { x: number; y: number }) => Boolean(selection && point.x >= selection.x && point.x <= selection.x + selection.width && point.y >= selection.y && point.y <= selection.y + selection.height);
  const begin = (event: PointerEvent) => {
    if (event.isTrusted === false) return;
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest('.capture-toolbar, .capture-text-input')) return;
    const point = pointerPoint(event, editor);
    if (!selection) { active = { kind: 'select', start: point }; editor.setPointerCapture(event.pointerId); return; }
    const handle = target.dataset.handle as CaptureHandle | undefined;
    if (handle && !ops.length) active = { kind: 'resize', start: point, selection, handle };
    else if (tool === 'text' && inside(point)) { addText(point); return; }
    else if (tool && inside(point)) { commitText(); active = { kind: 'draw', start: point }; if (tool === 'pen') draft = { kind: 'pen', points: [local(point)], color }; }
    else if (!tool && !ops.length && inside(point)) active = { kind: 'move', start: point, selection };
    else return;
    event.preventDefault();
    editor.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (event.isTrusted === false) return;
    if (!active) return;
    const point = pointerPoint(event, editor);
    const dx = point.x - active.start.x, dy = point.y - active.start.y;
    if (active.kind === 'select') {
      const next = normalizeSelection(active.start, point, viewport());
      if (next.width < MIN_SELECTION && next.height < MIN_SELECTION) return;
      selection = next; layout(); toolbar.hidden = true;
      return;
    }
    if (active.kind === 'move') selection = moveSelection(active.selection!, dx, dy, viewport());
    if (active.kind === 'resize') selection = resizeSelection(active.selection!, active.handle!, dx, dy, viewport());
    if (active.kind === 'draw' && tool) {
      if (tool === 'pen' && draft?.kind === 'pen') draft = { ...draft, points: [...draft.points, local(point)] };
      else draft = shape(tool, local(active.start), local(point));
      render();
      return;
    }
    layout();
  };
  const end = (event: PointerEvent) => {
    if (event.isTrusted === false) return;
    if (!active) return;
    if (active.kind === 'select' && !selection) selection = { x: 0, y: 0, ...viewport() };
    if (active.kind === 'draw' && draft) {
      const big = draft.kind === 'pen' ? draft.points.length > 1 : Math.abs((draft as { width: number }).width) > 3 || Math.abs((draft as { height: number }).height) > 3;
      if (big) ops = [...ops, draft];
    }
    draft = undefined;
    active = undefined;
    if (editor.hasPointerCapture(event.pointerId)) editor.releasePointerCapture(event.pointerId);
    layout();
  };

  const toolPaths: Record<CaptureTool, string> = {
    rectangle: 'rect x="3" y="3" width="18" height="18" rx="2"',
    arrow: 'path d="M7 17 17 7M7 7h10v10"',
    pen: 'path d="M13 21h8M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"',
    text: 'path d="M4 7V4h16v3M9 20h6M12 4v16"',
    mosaic: 'path d="M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z"',
  };
  (Object.keys(toolPaths) as CaptureTool[]).forEach(name => {
    const button = makeButton(labels[name], toolPaths[name]!);
    button.dataset.tool = name;
    button.dataset.label = name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', event => { if (event.isTrusted === false) return; selectTool(tool === name ? undefined : name); });
    toolbar.append(button);
  });
  const separator = () => { const element = document.createElement('i'); element.className = 'capture-separator'; return element; };
  toolbar.append(separator());
  COLORS.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'capture-color';
    button.style.setProperty('--swatch', value);
    button.setAttribute('aria-label', value);
    button.setAttribute('aria-pressed', String(value === color));
    button.addEventListener('click', event => {
      if (event.isTrusted === false) return;
      color = value;
      toolbar.querySelectorAll('.capture-color').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      if (text) { text.style.color = value; text.dataset.color = value; }
    });
    toolbar.append(button);
  });
  toolbar.append(separator());
  const undo = makeButton(labels.undo, 'path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"');
  undo.dataset.label = 'undo';
  undo.addEventListener('click', event => { if (event.isTrusted === false) return; ops = undoAnnotations(ops); layout(); });
  const copyButton = makeButton(labels.copy, 'path d="M8 8h12v12H8zM4 16V4h12"');
  copyButton.dataset.label = 'copy';
  copyButton.addEventListener('click', event => { if (event.isTrusted === false) return; void copy(); });
  const cancel = makeButton(labels.cancel, 'path d="M18 6 6 18M6 6l12 12"');
  cancel.dataset.label = 'cancel';
  cancel.addEventListener('click', event => { if (event.isTrusted === false) return; finish({ type: 'capture-cancel' }); });
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'capture-done';
  done.append(icon('path d="M20 6 9 17l-5-5"'));
  const doneText = document.createTextNode(labels.done);
  done.append(doneText);
  done.addEventListener('click', event => { if (event.isTrusted === false) return; complete(); });
  toolbar.append(undo, copyButton, cancel, done);
  (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as CaptureHandle[]).forEach(handle => { const element = document.createElement('i'); element.className = 'capture-handle'; element.dataset.handle = handle; selectionElement.append(element); });
  editor.addEventListener('pointerdown', begin);
  editor.addEventListener('pointermove', move);
  editor.addEventListener('pointerup', end);
  editor.addEventListener('dblclick', event => { if (event.isTrusted === false) return; if (!tool && selection && inside(pointerPoint(event as PointerEvent, editor))) complete(); });
  function keydown(event: KeyboardEvent) {
    if (event.isTrusted === false) return;
    if (text) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (tool) selectTool(undefined); else finish({ type: 'capture-cancel' }); }
    if (event.key === 'Enter' && selection) { event.preventDefault(); event.stopPropagation(); complete(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); ops = undoAnnotations(ops); layout(); }
  }
  window.addEventListener('keydown', keydown, true);
  image.addEventListener('load', layout, { once: true });
  image.addEventListener('error', cancelCapture, { once: true });

  return {
    stop() { cancelCapture(); },
  };
}