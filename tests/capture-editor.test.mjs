import { MIB, MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { CAPTURE_IDLE_MS, CAPTURE_MAX_MS, IMAGE_TEXT_MAX, IMAGE_PEN_POINTS_MAX, MIN_SELECTION, clamp, moveSelection, captureDimensions, cropRectAtDpr, mosaicBlockSize, normalizeSelection, resizeSelection, toolbarPlacement, undoAnnotations } from '../apps/extension/src/domain/images/drawing.ts';
import { createCaptureEditor } from '../apps/extension/src/page-layer/capture.ts';
import { encodeCapture } from '../apps/extension/src/runtime/media/encode-capture.ts';
import { IMAGE_LIMIT } from '../apps/extension/src/domain/images/image-policy.ts';

test('capture selection math clamps and normalizes a drag', () => {
  assert.deepEqual(normalizeSelection({ x: 80, y: 70 }, { x: -10, y: 20 }, { width: 100, height: 90 }), { x: 0, y: 20, width: 80, height: 50 });
  assert.deepEqual(resizeSelection({ x: 20, y: 20, width: 40, height: 30 }, 'se', 100, 100, { width: 100, height: 90 }), { x: 20, y: 20, width: 80, height: 70 });
});

test('capture toolbar flips above when below space is unavailable', () => {
  assert.deepEqual(toolbarPlacement({ x: 100, y: 170, width: 100, height: 20 }, { width: 320, height: 200 }, { width: 120, height: 36 }), { left: 80, top: 126, flipped: true });
  assert.deepEqual(toolbarPlacement({ x: 100, y: 20, width: 100, height: 20 }, { width: 320, height: 200 }, { width: 120, height: 36 }), { left: 80, top: 48, flipped: false });
});

test('capture export crop uses device pixel ratio and mosaic blocks stay twelve CSS pixels', () => {
  assert.deepEqual(cropRectAtDpr({ x: 10, y: 5, width: 40, height: 20 }, 2, { width: 200, height: 100 }), { x: 20, y: 10, width: 80, height: 40 });
  assert.equal(mosaicBlockSize(2), 24);
});

test('capture undo removes only the newest vector operation', () => {
  const ops = [{ kind: 'rectangle', x: 0, y: 0, width: 1, height: 1 }, { kind: 'arrow', x: 1, y: 1, width: 2, height: 2, color: '#FF4D4F' }];
  assert.equal(undoAnnotations(ops).length, 1);
  assert.equal(undoAnnotations([]).length, 0);
});

test('capture exports use the same 1600 pixel and 5 MiB policy as pasted images', () => {
  assert.deepEqual(captureDimensions(3840, 2160), { width: 1600, height: 900 });
  assert.deepEqual(captureDimensions(800, 4000), { width: 320, height: 1600 });
  assert.deepEqual(captureDimensions(100, 80), { width: 100, height: 80 });
  let format, quality;
  assert.equal(encodeCapture({ toDataURL(type, value) { format = type; quality = value; return 'data:image/webp;base64,AA=='; } }), 'data:image/webp;base64,AA==');
  assert.equal(format, 'image/webp');
  assert.equal(quality, 0.9);
  assert.equal(IMAGE_LIMIT.maxBytes, 5 * MIB);
});

test('oversize encodings are resized again before attaching, including a PNG fallback', () => {
  const dimensions = [];
  const oversized = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((IMAGE_LIMIT.maxBytes + 1) / 3) * 4);
  const create = () => ({ width: 0, height: 0, getContext: () => ({ drawImage(_canvas, _x, _y, width, height) { dimensions.push([width, height]); } }), toDataURL: () => 'data:image/png;base64,AA==' });
  const result = vm.runInNewContext(`(${encodeCapture.toString()})(canvas)`, { IMAGE_LIMIT, canvas: { width: 1600, height: 900, toDataURL: () => oversized }, document: { createElement: create } });
  assert.equal(result, 'data:image/png;base64,AA==');
  assert.deepEqual(dimensions, [[1280, 720]]);
});

function editorFixture(options) {
  const labels = Object.fromEntries(['rectangle', 'arrow', 'pen', 'text', 'mosaic', 'undo', 'copy', 'cancel', 'done', 'copied'].map(key => [key, key]));
  const { document } = parseHTML('<html><body></body></html>');
  const stage = document.createElement('div');
  const listeners = new Map(), timers = new Map(), messages = [];
  const window = { devicePixelRatio: 2, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  let closes = 0, now = 0, exported;
  const rendered = [];
  const schedule = (fn, delay) => { const id = { at: now + delay, delay }; timers.set(id, fn); return id; };
  const editor = vm.runInNewContext(`(${createCaptureEditor.toString()})(stage, send, 'data:image/png;base64,AA==', labels, close, options)`, {
    CAPTURE_IDLE_MS, CAPTURE_MAX_MS, IMAGE_TEXT_MAX, IMAGE_PEN_POINTS_MAX, MIN_SELECTION, clamp, moveSelection, normalizeSelection, resizeSelection, toolbarPlacement, cropRectAtDpr, undoAnnotations,
    Date: { now: () => now }, requestAnimationFrame: fn => fn(),
    pointerPoint: event => ({ x: event.clientX, y: event.clientY }),
    drawOps: (_context, ops) => { rendered.splice(0, rendered.length, ...ops); },
    exportCapture: (_image, selection, ops) => { exported = structuredClone({ selection, ops }); return {}; }, encodeCapture: () => 'data:image/png;base64,OK',
    options, window, document, stage, send: message => messages.push(message), close: () => closes++, innerWidth: 100, innerHeight: 100,
    labels, COLORS: ['#FF4D4F'], makeButton: () => document.createElement('button'), icon: () => document.createElement('span'),
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
  });
  const root = stage.firstElementChild;
  root.setPointerCapture = () => {}; root.hasPointerCapture = () => false;
  root.querySelector('canvas').getContext = () => ({ drawImage() {} });
  Object.defineProperty(root.querySelector('img'), 'naturalWidth', { value: 100 });
  Object.defineProperty(root.querySelector('img'), 'naturalHeight', { value: 100 });
  const fire = (type, properties = {}, target = root) => {
    const event = new document.defaultView.Event(type, { bubbles: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: 10, clientY: 10 }, properties);
    target.dispatchEvent(event);
  };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort(([a], [b]) => a.at - b.at).find(([id]) => id.at <= end);
      if (!next) break;
      now = next[0].at; timers.delete(next[0]); next[1]();
    }
    now = end;
  };
  return { editor, listeners, timers, messages, stage, root, fire, advance, rendered, exported: () => exported, closes: () => closes };

}

test('editor stop, navigation and timeout each send cancellation once and remove handlers', () => {
  for (const close of [f => f.editor.stop(), f => f.listeners.get('pagehide')(), f => [...f.timers.values()][0]()]) {
    const f = editorFixture();
    close(f);
    f.editor.stop();
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].type, 'capture-cancel');
    assert.equal(f.closes(), 1);
    assert.equal(f.stage.children.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test('synthetic capture keys and toolbar clicks cannot edit or cancel capture', () => {
  const f = editorFixture({ timeoutMs: null });
  const root = f.stage.firstElementChild;
  for (const key of ['z', 'Enter', 'Escape']) f.listeners.get('keydown')({ isTrusted: false, key, ctrlKey: true, preventDefault() { assert.fail('synthetic key consumed'); } });
  const button = f.stage.querySelector('button[data-tool=arrow]');
  const event = new button.ownerDocument.defaultView.Event('click');
  Object.defineProperty(event, 'isTrusted', { value: false });
  button.dispatchEvent(event);
  assert.notEqual(root.dataset.tool, 'arrow');
  assert.equal(f.messages.length, 0);
  f.listeners.get('keydown')({ isTrusted: true, key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(f.messages[0].type, 'capture-cancel');
});


test('capture actions renew the two-minute idle timer but never the ten-minute maximum', () => {
  for (const action of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'wheel', 'input', 'paste', 'change', 'keydown']) {
    const f = editorFixture();
    f.advance(CAPTURE_IDLE_MS - 1);
    if (action === 'keydown') f.listeners.get(action)({ key: 'a', isTrusted: true });
    else f.fire(action, { button: 1 });
    f.advance(CAPTURE_IDLE_MS - 1);
    assert.equal(f.messages.length, 0, action);
    f.advance(1);
    assert.equal(f.messages[0].type, 'capture-cancel', action);
  }
  const f = editorFixture();
  for (let i = 0; i < 9; i++) { f.advance(MINUTE_MS); f.fire('input'); }
  f.advance(59_999);
  assert.equal(f.messages.length, 0);
  f.fire('input'); f.advance(1);
  assert.equal(f.messages[0].type, 'capture-cancel');
});

test('synthetic activity cannot keep a capture alive', () => {
  const f = editorFixture();
  f.advance(CAPTURE_IDLE_MS - 1);
  f.fire('input', { isTrusted: false });
  f.advance(1);
  assert.equal(f.messages[0].type, 'capture-cancel');
});

test('new capture rectangles require both dimensions to reach eight pixels', () => {
  for (const [width, height] of [[8, 7], [7, 8], [8, 8]]) {
    const f = editorFixture({ timeoutMs: null });
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 10 + width, clientY: 10 + height });
    f.fire('pointerup', { clientX: 10 + width, clientY: 10 + height });
    assert.equal(f.root.querySelector('.capture-selection').hidden, width < 8 || height < 8);
    f.editor.stop();
  }
  const f = editorFixture({ timeoutMs: null });
  f.fire('pointerdown'); f.fire('pointermove', { clientX: 40, clientY: 40 });
  f.fire('pointermove', { clientX: 40, clientY: 15 }); f.fire('pointerup', { clientX: 40, clientY: 15 });
  assert.equal(f.root.querySelector('.capture-selection').hidden, true);
});

test('capture text and pen use the image document limits, including multiple strokes', () => {
  const f = editorFixture({ timeoutMs: null });
  f.fire('pointerdown'); f.fire('pointerup');
  const tool = name => f.fire('click', {}, f.root.querySelector(`[data-tool=${name}]`));
  tool('text'); f.fire('pointerdown');
  const input = f.root.querySelector('.capture-text-input'); input.textContent = 'x'.repeat(IMAGE_TEXT_MAX + 1);
  f.fire('blur', {}, input);
  assert.equal(f.rendered[0].value.length, IMAGE_TEXT_MAX);
  tool('pen');
  for (const count of [5000, 5010]) {
    f.fire('pointerdown');
    for (let i = 1; i < count; i++) f.fire('pointermove', { clientX: 20 + i % 10 });
    f.fire('pointerup');
  }
  assert.equal(f.rendered.filter(op => op.kind === 'pen').reduce((n, op) => n + op.points.length, 0), IMAGE_PEN_POINTS_MAX);
  f.fire('pointerdown'); f.fire('pointermove'); f.fire('pointerup');
  assert.equal(f.rendered.filter(op => op.kind === 'pen').length, 2);
  f.fire('click', {}, f.root.querySelector('.capture-done'));
  assert.equal(f.messages[0].type, 'captured');
  assert.equal(f.exported().ops[0].value.length, IMAGE_TEXT_MAX);
  assert.equal(f.exported().ops.filter(op => op.kind === 'pen').reduce((n, op) => n + op.points.length, 0), IMAGE_PEN_POINTS_MAX);
});
