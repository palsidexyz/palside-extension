import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../apps/extension/src/background/context.ts';

test('background timers keep the worker global as receiver when called through the context', t => {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const receivers = [];
  // Service worker timers throw "Illegal invocation" for any receiver but the global.
  globalThis.setTimeout = function () { receivers.push(this); if (this !== globalThis) throw new TypeError('Illegal invocation'); return 7; };
  globalThis.clearTimeout = function () { receivers.push(this); if (this !== globalThis) throw new TypeError('Illegal invocation'); };
  t.after(() => Object.assign(globalThis, saved));
  const bg = createContext({ browser: { action: { setTitle: async () => {} }, runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}` } } });
  assert.equal(bg.setTimeout(() => {}, 250), 7);
  bg.clearTimeout(7);
  assert.deepEqual(receivers, [globalThis, globalThis]);
});
