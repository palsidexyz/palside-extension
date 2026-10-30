import test from 'node:test';
import assert from 'node:assert/strict';
import { connectLiveEvents } from '../apps/extension/src/runtime/transport/live-events.ts';

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('silent SSE streams become unknown at the heartbeat deadline and reconnect', async t => {
  t.mock.method(Math, 'random', () => 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = []; const signals = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    signals.push(init.signal);
    return { ok: true, body: new ReadableStream({ start() {} }) };
  });
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onState: open => states.push(open) });
  try {
    await drain(); assert.deepEqual(states, [true]);
    t.mock.timers.tick(59_999); await drain(); assert.deepEqual(states, [true]);
    t.mock.timers.tick(1); await drain(); assert.deepEqual(states, [true, false]); assert.equal(signals[0].aborted, true);
    t.mock.timers.tick(1000); await drain(); assert.equal(signals.length, 2); assert.equal(states.at(-1), true);
  } finally { stop(); t.mock.timers.tick(60_000); await drain(); }
});

test('SSE comment heartbeats reset the idle deadline without generating product events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states = []; const refreshes = []; let stream;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, body: new ReadableStream({ start(controller) { stream = controller; } }) }));
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh: scope => refreshes.push(scope), onState: open => states.push(open) });
  try {
    await drain();
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(25_000); stream.enqueue(new TextEncoder().encode(': heartbeat\n\n')); await drain(); }
    assert.deepEqual(states, [true]); assert.deepEqual(refreshes, []);
    t.mock.timers.tick(60_000); await drain(); assert.deepEqual(states, [true, false]);
  } finally { stop(); }
});


test('SSE delivers all five room events and re-reads invites on team-invites events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const rooms = [], pending = [], refreshes = []; let stream;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, body: new ReadableStream({ start(controller) { stream = controller; } }) }));
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh: scope => refreshes.push(scope), onRoom: event => rooms.push(event), onTeamInvites: count => pending.push(count) });
  try {
    await drain(); const key = 'token:Solana:So11111111111111111111111111111111111111112';
    const events = [{ key, type: 'message', message: { id: 'm', key, author: { id: 'peer', nickname: 'Peer', avatarId: null }, text: 'hello', createdAt: 1, folded: false, reported: false } }, { key, type: 'folded', id: 'm' }, { key, type: 'retract', id: 'm' }, { key, type: 'count', count: 3 }, { key, type: 'stance', stance: { bull: 1, hold: 2, bear: 3 } }];
    stream.enqueue(new TextEncoder().encode(events.map(event => `event: room\ndata: ${JSON.stringify(event)}\n\n`).join('') + 'event: team-invites\ndata: {"pending":2}\n\nevent: team-invites\ndata: {"pending":0}\n\nevent: team-invites\ndata: {"pending":-1}\n\n'));
    await drain(); assert.deepEqual(rooms, events); assert.deepEqual(pending, [2, 0]); assert.deepEqual(refreshes, []);
  } finally { stop(); }
});

for (const random of [0, 0.5, 0.999]) test(`SSE 429 waits for Retry-After plus bounded jitter (${random})`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.mock.method(Math, 'random', () => random);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfterMs: 45_000 }), { status: 429, headers: { 'Retry-After': '45' } }); });
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh() {} });
  try {
    await drain(); t.mock.timers.tick(44_999); await drain(); assert.equal(calls, 1);
    t.mock.timers.tick(1 + Math.floor(random * 1000)); await drain(); assert.equal(calls, 2);
  } finally { stop(); }
});

for (const status of [401, 503]) test(`SSE ${status} retains its reconnect backoff with bounded jitter and stop cancels it`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  t.mock.method(Math, 'random', () => 0.5);
  let calls = 0; const states = [];
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status }); });
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onState: value => states.push(value) });
  try {
    await drain(); assert.deepEqual(states, [false]);
    const first = status === 401 ? 30_500 : 1500;
    t.mock.timers.tick(first - 1); await drain(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await drain(); assert.equal(calls, 2);
    stop(); t.mock.timers.tick(60_000); await drain(); assert.equal(calls, 2);
  } finally { stop(); }
});

test('SSE server waits longer than one timer interval never overflow into an immediate retry', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 }); t.mock.method(Math, 'random', () => 0);
  const wait = 2_147_483_647 + 5000; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfterMs: wait }), { status: 429 }); });
  const stop = connectLiveEvents({ baseUrl: 'https://service.test', token: () => 'token', onRefresh() {} });
  try {
    await drain(); t.mock.timers.tick(2_147_483_647); await drain(); assert.equal(calls, 1);
    t.mock.timers.tick(4999); await drain(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await drain(); assert.equal(calls, 2);
  } finally { stop(); }
});
