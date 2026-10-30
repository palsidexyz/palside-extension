import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { captureDimensions, cropRectAtDpr, mosaicBlockSize, normalizeSelection, resizeSelection, toolbarPlacement, undoAnnotations } from '../apps/extension/src/domain/images/drawing.ts';
import { createCaptureEditor } from '../apps/extension/src/page-layer/capture.ts';
import { encodeCapture } from '../apps/extension/src/runtime/media/encode-capture.ts';
import { translator } from '../packages/i18n/src/core.ts';
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
  assert.equal(IMAGE_LIMIT.maxBytes, 5 * 1024 * 1024);
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
  const t = translator('zh-CN');
  const labels = Object.fromEntries(['rectangle', 'arrow', 'pen', 'text', 'mosaic', 'undo', 'copy', 'cancel', 'done', 'copied'].map(key => [key, t(`extension.capture.${key}`)]));
  const { document } = parseHTML('<html><body></body></html>');
  const stage = document.createElement('div');
  const listeners = new Map(), timers = new Map(), messages = [];
  const window = { devicePixelRatio: 2, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  let closes = 0;
  const editor = vm.runInNewContext(`(${createCaptureEditor.toString()})(stage, send, 'data:image/png;base64,AA==', labels, close, options)`, {
    options, window, document, stage, send: message => messages.push(message), close: () => closes++, innerWidth: 100, innerHeight: 100,
    labels, COLORS: ['#FF4D4F'], makeButton: () => document.createElement('button'), icon: () => document.createElement('span'),
    setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  return { editor, listeners, timers, messages, stage, closes: () => closes };
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
