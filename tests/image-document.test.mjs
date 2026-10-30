import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageDocument, readImageDocument, fitImageViewport, imagePoint, zoomImageViewport, resizeImageViewport, imageCrop, imageCropHandle } from '../apps/extension/src/domain/images/image-document.ts';

const arrow = { kind: 'arrow', x: 240, y: 300, width: -120, height: 80, color: '#FF4D4F' };

test('document coordinates survive viewport zoom, pan, resize and restoration into another window', () => {
  const doc = new ImageDocument(1200, 800);
  doc.add(arrow); doc.setCrop({ x: 80, y: 100, width: 800, height: 600 });
  const saved = doc.snapshot();
  let view = fitImageViewport(360, 600, 1200, 800);
  const anchor = { x: 180, y: 300 }, before = imagePoint(view, anchor);
  view = zoomImageViewport(view, view.scale * 2, anchor);
  assert.deepEqual(imagePoint(view, anchor), before);
  view = resizeImageViewport(view, 1000, 700);
  assert.deepEqual(imagePoint(view, { x: 500, y: 350 }), before);
  assert.deepEqual(doc.snapshot(), saved);
  assert.deepEqual(new ImageDocument(1200, 800, saved).snapshot(), saved);
  assert.equal('src' in saved, false);
});

test('crop and annotation history support undo, redo and branching', () => {
  const doc = new ImageDocument(1200, 800), original = doc.snapshot();
  assert.equal(doc.dirty, false);
  assert.equal(doc.add(arrow), true);
  const annotated = doc.snapshot();
  doc.setCrop({ x: 10, y: 20, width: 300, height: 400 });
  assert.equal(doc.undo(), true); assert.deepEqual(doc.snapshot(), annotated);
  assert.equal(doc.undo(), true); assert.deepEqual(doc.snapshot(), original);
  assert.equal(doc.dirty, false);
  assert.equal(doc.redo(), true); assert.deepEqual(doc.snapshot(), annotated);
  doc.setCrop({ x: 0, y: 0, width: 500, height: 500 });
  assert.equal(doc.redoReady, false);
});

test('snapshot restoration is isolated and rejects wrong source dimensions or invalid data', () => {
  const doc = new ImageDocument(1200, 800); doc.add(arrow);
  const saved = doc.snapshot();
  saved.ops[0].x = 500;
  assert.equal(doc.snapshot().ops[0].x, 240);
  assert.equal(doc.restore(doc.snapshot()), true);
  assert.equal(doc.restore({ ...saved, width: 600 }), false);
  assert.equal(readImageDocument({ ...saved, src: 'data:image/png;base64,xx' }, 1200, 800), undefined);
  assert.equal(readImageDocument({ ...saved, crop: { x: 0, y: 0, width: NaN, height: 2 } }, 1200, 800), undefined);
  assert.throws(() => new ImageDocument(1200, 800, { ...saved, ops: [{ ...arrow, width: 2000 }] }), /IMAGE_DOCUMENT_INVALID/);
  assert.throws(() => new ImageDocument(0, 800), /IMAGE_DOCUMENT_INVALID/);
});

test('transfer budget uses encoded bytes, including multibyte text', () => {
  const saved = new ImageDocument(1200, 800).snapshot();
  const text = { kind: 'text', x: 2, y: 20, color: '#3B82F6', value: '画'.repeat(500) };
  assert.ok(readImageDocument({ ...saved, ops: Array(100).fill(text) }, 1200, 800));
  assert.equal(readImageDocument({ ...saved, ops: Array(200).fill(text) }, 1200, 800), undefined);
  assert.equal(readImageDocument({ ...saved, ops: [{ kind: 'pen', color: '#3B82F6', points: Array(10001).fill({ x: 1, y: 1 }) }] }, 1200, 800), undefined);
});

test('crop and handles clamp to original image boundaries without crossing', () => {
  assert.deepEqual(imageCrop({ x: 500, y: 400 }, { x: -10, y: -20 }, 300, 200), { x: 0, y: 0, width: 300, height: 200 });
  const crop = { x: 10, y: 20, width: 100, height: 80 };
  assert.deepEqual(imageCropHandle(crop, 'nw', { x: 400, y: 400 }, 300, 200), { x: 109, y: 99, width: 1, height: 1 });
  assert.deepEqual(imageCropHandle(crop, 'se', { x: 500, y: 400 }, 300, 200), { x: 10, y: 20, width: 290, height: 180 });
});
