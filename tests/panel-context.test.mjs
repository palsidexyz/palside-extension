import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPanelForWindow } from '../apps/extension/src/runtime/browser/panel-context.ts';

const context = { contextType: 'SIDE_PANEL', documentId: 'panel-a', windowId: -1, incognito: false };
const panelUrl = 'chrome-extension://palside/sidepanel.html';
test('native panel ports without optional sender.documentId use their verified URL and live window', () => {
  const nativeContext = { ...context, documentUrl: panelUrl };
  const connection = [{ documentUrl: panelUrl, windowId: 12 }];
  assert.equal(hasPanelForWindow([nativeContext], connection, 12), true);
  assert.equal(hasPanelForWindow([nativeContext], connection, 13), false);
  assert.equal(hasPanelForWindow([], connection, 12), false);
  assert.equal(hasPanelForWindow([nativeContext], [], 12), false);
  assert.equal(hasPanelForWindow([nativeContext], [{ documentUrl: panelUrl + '?other', windowId: 12 }], 12), false);
  assert.equal(hasPanelForWindow([{ ...nativeContext, windowId: 13 }], connection, 12), false);
  assert.equal(hasPanelForWindow([{ ...nativeContext, incognito: true }], connection, 12), false);
  assert.equal(hasPanelForWindow([nativeContext], [{ ...connection[0], documentId: 'stale-panel' }], 12), false);
});
test('a native side panel with context windowId -1 uses its connected document and actual window', () => {
  assert.equal(hasPanelForWindow([context], [{ documentId: 'panel-a', windowId: 12 }], 12), true);
  assert.equal(hasPanelForWindow([context], [{ documentId: 'panel-a', windowId: 12 }], 13), false);
});
test('closed or reloaded panels and a disconnected worker cannot authorize viewing', () => {
  assert.equal(hasPanelForWindow([], [{ documentId: 'panel-a', windowId: 12 }], 12), false);
  assert.equal(hasPanelForWindow([context], [], 12), false);
  assert.equal(hasPanelForWindow([context], [{ documentId: 'panel-old', windowId: 12 }], 12), false);
  assert.equal(hasPanelForWindow([context], [{ documentId: 'panel-a' }], 12), false);
});
test('incognito, missing identity and non-panel contexts never authorize viewing', () => {
  const connection = [{ documentId: 'panel-a', windowId: 12 }];
  assert.equal(hasPanelForWindow([{ ...context, incognito: true }], connection, 12), false);
  assert.equal(hasPanelForWindow([{ ...context, contextType: 'TAB' }], connection, 12), false);
  assert.equal(hasPanelForWindow([{ ...context, documentId: undefined }], [{ windowId: 12 }], 12), false);
});
