import { MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { danmaku } from '../apps/extension/src/background/danmaku.ts';
import { ROOM_REPLAY_COUNT, ROOM_REPLAY_GAP_MS, ROOM_REPLAY_WINDOW_MS } from '@palside/shared/rules/rooms';

const address = '0x39dbed3a2bd333467115de45665cc57f813c4571', key = `token:Ethereum:${address}`;
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000_000 });
  const timers = new Map(), pagePorts = new Map();
  const state = { authenticated: true, account: { id: 'me' }, preferences: { rooms: {}, web: { interact: true } }, toggles: { interact: true }, rooms: { current: { key, loading: false, messages: [] }, blocked: [] } };
  const bg = { state, browser: { storage: { local: { get: async () => ({}), set: async () => {} } } }, pages: { pagePorts }, panels: new Map([['panel', 1]]),
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    async roomPagePerson(person) { return { name: person.nickname, mate: false }; } };
  const service = danmaku(bg); t.after(() => service.clear());
  function page(tabId = 1) { const items = [], port = { postMessage: message => { if (message.type === 'danmaku') items.push(...message.items); } }, info = { tabId, windowId: 1, siteGranted: true, url: `https://gmgn.ai/eth/token/${address}` }; pagePorts.set(port, info); return { items, port, sync: () => service.syncPage(port, info) }; }
  const message = (id, age = 0) => ({ id, key, text: id, createdAt: Date.now() - age, author: { id: 'peer', nickname: 'Peer' } });
  async function tick() { for (const [id, timer] of [...timers]) { assert.equal(timer.ms, ROOM_REPLAY_GAP_MS); timers.delete(id); timer.fn(); } await settle(); }
  return { service, state, page, message, tick };
}

test('opening replays latest twenty from one hour at 600ms gaps, flags only replay and excludes folded/blocked', async t => {
  const f = fixture(t); await f.service.ready;
  const rows = Array.from({ length: 25 }, (_, n) => f.message(`m${n}`, 3000 - n));
  f.state.rooms.blocked = [{ id: 'blocked' }];
  f.state.rooms.current.messages = [f.message('expired', ROOM_REPLAY_WINDOW_MS), ...rows, { ...f.message('folded'), folded: true }, { ...f.message('blocked'), author: { id: 'blocked' } }];
  const p = f.page(); p.sync(); await settle();
  assert.deepEqual(p.items.map(item => item.id), ['m5']); assert.equal(p.items[0].replay, true);
  f.state.rooms.current.messages.push(f.message('live')); p.sync();
  for (let n = 0; n < ROOM_REPLAY_COUNT; n++) await f.tick();
  assert.deepEqual(p.items.map(item => item.id), [...rows.slice(-ROOM_REPLAY_COUNT).map(row => row.id), 'live']);
  assert.ok(p.items.slice(0, ROOM_REPLAY_COUNT).every(item => item.replay === true));
  assert.equal(p.items.at(-1).replay, undefined);
});

test('replay deduplicates per tab and token for exactly ten minutes, independently of one-hour history', async t => {
  const f = fixture(t); await f.service.ready;
  f.state.rooms.current.messages = [f.message('half-hour-old', 30 * MINUTE_MS)];
  let p = f.page(); p.sync(); await settle(); assert.equal(p.items.length, 1);
  f.service.forget(p.port); p = f.page(); p.sync(); await settle(); assert.equal(p.items.length, 0);
  const other = f.page(2); other.sync(); await settle(); assert.equal(other.items.length, 1);
  t.mock.timers.tick(10 * MINUTE_MS - 1); f.service.forget(p.port); p = f.page(); p.sync(); await settle(); assert.equal(p.items.length, 0);
  t.mock.timers.tick(1); f.service.forget(p.port); p = f.page(); p.sync(); await settle(); assert.equal(p.items.length, 1); assert.equal(p.items[0].replay, true);
});
