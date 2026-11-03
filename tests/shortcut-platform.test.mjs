import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
const load = productionModules();
const { browserPlatform } = load('apps/extension/src/runtime/browser/platform.ts');
const { captureShortcut, suggestedCaptureShortcut } = load('apps/extension/src/runtime/browser/shortcuts.ts');
const { deviceLabel } = load('apps/extension/src/runtime/account/device-label.ts');
test('platform detection prefers client hints and falls back to the user agent', () => {
  for (const [value, platform, shortcut] of [['Macintosh', 'macOS', '⌥⇧S'], ['Windows NT 10.0', 'Windows', 'Alt+Shift+S'], ['X11; Linux x86_64', 'Linux', 'Alt+Shift+S'], ['CrOS x86_64', 'ChromeOS', 'Alt+Shift+S']]) {
    assert.equal(browserPlatform({ userAgent: value }), platform);
    assert.equal(deviceLabel({ userAgent: value }), `${platform} · Chrome`);
    assert.equal(suggestedCaptureShortcut(platform), shortcut);
  }
  assert.equal(browserPlatform({ userAgentData: { platform: 'macOS' }, userAgent: 'Windows' }), 'macOS');
  assert.equal(deviceLabel({}), 'Chrome');
});
test('shortcut reads the actual Chrome assignment, including explicitly unassigned commands', async () => {
  const host = shortcut => ({ commands: { getAll: async () => [{ name: 'capture', shortcut }] } });
  assert.equal(await captureShortcut(host('Ctrl+Shift+Y')), 'Ctrl+Shift+Y');
  assert.equal(await captureShortcut(host('')), '');
});

test('page opening always reuses the matching active tab or an authorized tab in the current window', async () => {
  const { createPageOpener } = load('apps/extension/src/runtime/browser/open-page.ts');
  const created = [], activated = [];
  let active = { id: 1, index: 0, url: 'https://example.com/page' };
  const browser = { windows: { getLastFocused: async () => ({ id: 10 }) }, permissions: { contains: async () => true }, tabs: { query: async query => query.active ? [active] : [{ id: 2, active: false, url: 'https://example.com/page' }], create: async value => created.push(value), update: async id => activated.push(id) } };
  await createPageOpener(browser)('https://example.com/page'); assert.equal(created.length, 0); assert.equal(activated.length, 0);
  active = { id: 1, index: 0, url: 'https://example.com/other' };
  await createPageOpener(browser)('https://example.com/page'); assert.equal(created.length, 0); assert.deepEqual(activated, [2]);
});
