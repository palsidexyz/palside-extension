import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
const { preloadHistory } = productionModules()('apps/extension/src/runtime/account/matrix-session.ts');
function fixture() {
  const rooms = new Map(['one', 'two'].map(id => [id, { id, oldState: { paginationToken: 'older' } }]));
  const pages = [];
  const runtime = { state: { preferences: { current: 'one' }, remoteTeams: ['one', 'two'].map(id => ({ id, roomId: id, joined: true })) }, timeline: { missingEvents: new Map() }, emit() {} };
  const auth = { runtime, cryptoInitialised: true, client: { getRoom: id => rooms.get(id) }, historyPages: new WeakMap(), historyPreloads: new WeakMap(), scope: () => ({ current: () => true }), async history(room) { pages.push(room.id); auth.historyPages.set(room, (auth.historyPages.get(room) ?? 0) + 1); } };
  return { auth, runtime, pages, rooms, preload: () => preloadHistory.call(auth) };
}
test('only the current squad preloads ten pages; switching fills the next squad once', async () => {
  const f = fixture(); await Promise.all([f.preload(), f.preload()]);
  assert.deepEqual(f.pages, Array(10).fill('one')); assert.equal(f.runtime.state.history.two, undefined);
  f.runtime.state.preferences.current = 'two'; await f.preload();
  assert.deepEqual(f.pages.slice(10), Array(10).fill('two'));
  f.runtime.state.preferences.current = 'one'; await f.preload(); assert.equal(f.pages.length, 20);
});
test('preload stops when switching and resumes its remaining page budget', async () => {
  const f = fixture(); const history = f.auth.history;
  f.auth.history = async room => { await history(room); if (f.pages.length === 3) f.runtime.state.preferences.current = 'two'; };
  await f.preload(); assert.equal(f.pages.length, 3); assert.equal(f.runtime.state.history.one.loading, false);
  f.runtime.state.preferences.current = 'one'; await f.preload(); assert.equal(f.pages.length, 10);
});
test('preload stops at the end of history and preserves missing-key status', async () => {
  const f = fixture(); f.runtime.timeline.missingEvents.set('one', new Set(['missing']));
  const history = f.auth.history; f.auth.history = async room => { await history(room); room.oldState.paginationToken = null; };
  await f.preload(); assert.equal(f.pages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.runtime.state.history.one)), { missingKeys: 1, loaded: true, loading: false });
});
