import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseEvents } from '../apps/extension/src/runtime/transport/live-events.ts';

test('SSE parser handles comments, CRLF and multiline data', () => {
  const parsed = parseSseEvents(': ping\r\nevent: refresh\r\ndata: {"scope":"me"}\r\ndata: tail\r\n\r\npartial');
  assert.deepEqual(parsed.events, [{ event: 'refresh', data: '{"scope":"me"}\ntail' }]);
  assert.equal(parsed.remainder, 'partial');
});

test('SSE parser defaults event name and ignores comments', () => {
  assert.deepEqual(parseSseEvents(': hello\ndata: ok\n\n').events, [{ event: 'message', data: 'ok' }]);
});

test('presence events carry the three-state account status', () => {
  assert.deepEqual(parseSseEvents('event: presence\ndata: {"account":"alice","state":"away"}\n\n').events, [{ event: 'presence', data: '{"account":"alice","state":"away"}' }]);
});

test('401 stops reconnection and expires the session even with an unreadable response body', async t => {
  const { connectLiveEvents } = await import('../apps/extension/src/runtime/transport/live-events.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, expired = 0; const states = [];
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('unauthorized', { status: 401 }); });
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'revoked', onRefresh() {}, onState: value => states.push(value), onUnauthorized: () => { expired++; } });
  const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  await drain(); t.mock.timers.tick(120_000); await drain();
  assert.equal(calls, 1); assert.equal(expired, 1); assert.deepEqual(states, [false]); stop();
});

test('room SSE carries a single hot ranking and rejects the removed two-board shape', async () => {
  const { decodeContract } = await import('../packages/shared/src/contracts/validation.ts');
  const { events } = await import('../packages/shared/src/contracts/events.ts');
  const row = { key: `token:sol:${'a'.repeat(32)}`, count: 5, site: null, stance: { bull: 2, hold: 1, bear: 0 }, faces: [], rise: 3 };
  const payload = { type: 'hot', rooms: { rows: [row] } };
  const wire = parseSseEvents(`event: room\ndata: ${JSON.stringify(payload)}\n\n`).events[0];
  assert.deepEqual(decodeContract(events.room, JSON.parse(wire.data)), payload);
  const face = { id: 'peer', nickname: 'Peer', avatarId: null };
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, faces: [face, face, face, face] }] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: Array.from({ length: 21 }, () => row) } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, viewers: 5 }] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rising: [], top: [] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, rise: 2 }] } }));
});
