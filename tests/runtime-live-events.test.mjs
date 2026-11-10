import { MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectLiveEvents } from '../apps/extension/src/runtime/transport/live-events.ts';
import { Api, ApiError, LiveChannelLost } from '../apps/extension/src/runtime/transport/api.ts';
import { liveMatrixFetch } from '../apps/extension/src/runtime/transport/matrix-fetch.ts';

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/** A WebSocket stand-in: records what the client sends; tests play the service's side. */
function fakeSockets() {
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(data) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
    ready() { this.open(); this.message({ type: 'ready', serverTime: 1 }); }
  }
  return { FakeSocket, sockets };
}
const event = (name, data) => ({ type: 'event', event: name, data });

test('the live socket authenticates first, delivers pushes and carries requests until it closes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { FakeSocket, sockets } = fakeSockets();
  const states = [], refreshes = [], presence = [], channels = [];
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh: refresh => refreshes.push(refresh), onPresence: (account, state) => presence.push([account, state]), onState: open => states.push(open), onChannel: channel => channels.push(channel) });
  try {
    const ws = sockets[0];
    assert.equal(ws.url, 'wss://service.test/live');
    ws.open(); assert.deepEqual(ws.sent, [{ type: 'auth', token: 'token' }]);
    assert.deepEqual(states, []);
    ws.message({ type: 'ready', serverTime: 1 });
    assert.deepEqual(states, [true]); assert.equal(channels.length, 1);
    ws.message(event('refresh', { scope: 'me', at: 5 })); ws.message({ type: 'ping' });
    ws.message(event('presence', { account: 'alice', state: 'away' })); ws.message(event('presence', { account: 'alice', state: 'online' }));
    assert.deepEqual(refreshes, [{ scope: 'me', at: 5 }]); assert.deepEqual(presence, [['alice', 'away']]);
    const reply = channels[0].request({ type: 'request', endpoint: 'viewing.react', body: { teamId: 't', messages: {} } }, new AbortController().signal);
    const request = ws.sent[1];
    assert.equal(request.type, 'request'); assert.equal(request.endpoint, 'viewing.react'); assert.match(request.id, /^[\w-]+$/);
    ws.message({ type: 'reply', id: request.id, status: 200, body: { delivered: 2 } });
    assert.deepEqual(await reply, { status: 200, body: { delivered: 2 } });
    const lost = channels[0].request({ type: 'request', endpoint: 'viewing.react', body: { teamId: 't', messages: {} } }, new AbortController().signal);
    ws.close(1006);
    await assert.rejects(lost, error => error.sent === true);
    assert.deepEqual(states, [true, false]); assert.equal(channels.at(-1), undefined);
  } finally { stop(); }
});

test('pushes deliver every room event and invite count; malformed ones are dropped', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { FakeSocket, sockets } = fakeSockets();
  const rooms = [], pending = [];
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onRoom: room => rooms.push(room), onTeamInvites: count => pending.push(count) });
  try {
    sockets[0].ready();
    const key = 'token:Solana:So11111111111111111111111111111111111111112';
    const events = [{ key, type: 'message', message: { id: 'm', key, author: { id: 'peer', nickname: 'Peer', avatarId: null }, text: 'hello', createdAt: 1, folded: false, reported: false } }, { key, type: 'folded', id: 'm' }, { key, type: 'retract', id: 'm' }, { key, type: 'count', count: 3 }, { key, type: 'likes', id: 'm', count: 2 }];
    for (const room of events) sockets[0].message(event('room', room));
    for (const count of [2, 0, -1]) sockets[0].message(event('team-invites', { pending: count }));
    sockets[0].message('not json');
    assert.deepEqual(rooms, events); assert.deepEqual(pending, [2, 0]);
  } finally { stop(); }
});

test('a socket that went quiet, or stays silent after a request timed out, is lost at once without waiting for its closing handshake', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5);
  const { FakeSocket, sockets } = fakeSockets();
  // A dead network: close() starts a handshake that never finishes, so no close event arrives.
  FakeSocket.prototype.close = function () { this.readyState = 2; };
  const states = [], channels = [];
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onState: open => states.push(open), onChannel: channel => channels.push(channel) });
  try {
    sockets[0].ready();
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(25_000); sockets[0].message({ type: 'ping' }); }
    assert.deepEqual(states, [true]);
    t.mock.timers.tick(MINUTE_MS);
    assert.deepEqual(states, [true, false]); assert.equal(channels.at(-1), undefined);
    t.mock.timers.tick(1000); await drain();
    assert.equal(sockets.length, 2);
    sockets[1].ready();
    // A slow request alone does not condemn the socket: it asks for a pong, and an answer keeps every other request alive.
    const ask = signal => channels.at(-1).request({ type: 'request', endpoint: 'viewing.react', body: {} }, signal);
    const slow = new AbortController(), other = ask(new AbortController().signal);
    const unanswered = ask(slow.signal);
    slow.abort(new DOMException('timed out', 'TimeoutError'));
    await assert.rejects(unanswered, error => error.name === 'TimeoutError');
    assert.deepEqual(sockets[1].sent.at(-1), { type: 'ping' });
    t.mock.timers.tick(4_000); sockets[1].message({ type: 'pong' }); t.mock.timers.tick(5_000);
    assert.deepEqual(states, [true, false, true]);
    sockets[1].message({ type: 'reply', id: sockets[1].sent[1].id, status: 200, body: { delivered: 1 } });
    assert.equal((await other).status, 200);
    // A socket that stays silent after the ping is lost.
    const again = new AbortController(), last = ask(again.signal);
    again.abort(new DOMException('timed out', 'TimeoutError'));
    await assert.rejects(last, error => error.name === 'TimeoutError');
    t.mock.timers.tick(5_000);
    assert.deepEqual(states, [true, false, true, false]); assert.equal(channels.at(-1), undefined);
  } finally { stop(); }
});

test('the network coming back reconnects at once, and probes a socket that still looks open', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5);
  const { FakeSocket, sockets } = fakeSockets();
  let online;
  const states = [];
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onState: open => states.push(open), onOnline: listener => { online = listener; return () => { online = undefined; }; } });
  try {
    for (let i = 0; i < 6; i++) { sockets.at(-1).close(1006); t.mock.timers.tick(10_000); }
    assert.equal(sockets.length, 7);
    sockets.at(-1).close(1006);
    online();
    assert.equal(sockets.length, 8, 'no wait for the backoff');
    sockets.at(-1).ready();
    online();
    assert.deepEqual(sockets.at(-1).sent.at(-1), { type: 'ping' });
    t.mock.timers.tick(5_000);
    assert.equal(states.at(-1), false);
  } finally { stop(); }
  assert.equal(online, undefined);
});

test('a draining service: new requests wait for the next socket, crossed ones are sent again, owed replies still arrive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5);
  const { FakeSocket, sockets } = fakeSockets();
  const api = new Api('https://service.test'); api.token = 'token';
  const link = api.live.attach();
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh() {}, onChannel: channel => link.ready(channel) });
  try {
    sockets[0].ready();
    const owed = api.request('presence.update', { body: { state: 'active' } });
    const crossed = api.request('presence.update', { body: { state: 'away' } });
    await drain();
    const [, first, second] = sockets[0].sent;
    sockets[0].message({ type: 'draining' });
    const later = api.request('presence.update', { body: { state: 'active' } });
    await drain();
    assert.equal(sockets[0].sent.length, 3, 'nothing more goes out on a draining socket');
    sockets[0].message({ type: 'reply', id: first.id, status: 200, body: { state: 'active' } });
    sockets[0].message({ type: 'reply', id: second.id, status: 503, body: { error: 'DRAINING' } });
    assert.deepEqual(await owed, { state: 'active' });
    sockets[0].close(1001);
    t.mock.timers.tick(1_000); await drain();
    sockets[1].ready(); await drain();
    const resent = sockets[1].sent.slice(1);
    assert.deepEqual(resent.map(message => message.body.state).sort(), ['active', 'away']);
    for (const message of resent) sockets[1].message({ type: 'reply', id: message.id, status: 200, body: { state: message.body.state } });
    assert.deepEqual(await crossed, { state: 'away' }); assert.deepEqual(await later, { state: 'active' });
  } finally { stop(); link.detach(); }
});

test('a lost socket reconnects with backoff, a refused device token stops for good, and stop cancels a pending retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5);
  const { FakeSocket, sockets } = fakeSockets();
  let unauthorized = 0; const states = [];
  const stop = connectLiveEvents({ WebSocket: FakeSocket, baseUrl: 'http://127.0.0.1:8787', token: () => 'token', onRefresh() {}, onState: open => states.push(open), onUnauthorized: () => { unauthorized++; } });
  try {
    assert.equal(sockets[0].url, 'ws://127.0.0.1:8787/live');
    sockets[0].close(1006);
    t.mock.timers.tick(999); assert.equal(sockets.length, 1);
    t.mock.timers.tick(1); assert.equal(sockets.length, 2);
    sockets[1].close(1006);
    t.mock.timers.tick(1999); assert.equal(sockets.length, 2);
    t.mock.timers.tick(1); assert.equal(sockets.length, 3);
    sockets[2].open(); sockets[2].close(4401);
    t.mock.timers.tick(MINUTE_MS); await drain();
    assert.equal(unauthorized, 1); assert.equal(sockets.length, 3); assert.deepEqual(states, [false, false, false]);
  } finally { stop(); }
  const again = fakeSockets();
  const halt = connectLiveEvents({ WebSocket: again.FakeSocket, baseUrl: 'https://service.test', token: () => 'token', onRefresh() {} });
  again.sockets[0].close(1006); halt();
  t.mock.timers.tick(MINUTE_MS); assert.equal(again.sockets.length, 1);
});

test('while a live connection runs, carried requests wait for the socket and never fall back to HTTP', async t => {
  const api = new Api('https://service.test'); api.token = 'token';
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response(JSON.stringify({ delivered: 3 }), { status: 200 }); });
  // No connection for this device: HTTP.
  assert.deepEqual(await api.request('viewing.react', { body: { teamId: 'team', messages: {} } }), { delivered: 3 });
  assert.equal(fetches, 1);

  const link = api.live.attach();
  const sent = [];
  const channel = { request: async message => { sent.push(message); return { status: 200, body: message.endpoint === 'invites.options' ? { accepts: true, teams: [] } : { delivered: 1 } }; } };
  // The socket is still connecting: the request waits for it instead of leaving over HTTP.
  const waiting = api.request('viewing.react', { body: { teamId: 'team', messages: {} } });
  await drain(); assert.equal(sent.length, 0);
  link.ready(channel);
  assert.deepEqual(await waiting, { delivered: 1 });
  // Params and query travel as URL strings; signing out stays on HTTP.
  await api.request('invites.options', { query: { accountId: 'acc' } });
  assert.deepEqual(sent.at(-1), { type: 'request', endpoint: 'invites.options', query: { accountId: 'acc' } });
  await api.request('accounts.logout', {}).catch(() => {});
  assert.equal(fetches, 2);

  // A socket that dropped before sending waits for the next one; a reply lost with the socket is an unknown result.
  link.ready({ request: async () => { throw new LiveChannelLost(false); } });
  const retried = api.request('viewing.react', { body: { teamId: 'team', messages: {} } });
  await drain(); link.ready(channel);
  assert.deepEqual(await retried, { delivered: 1 });
  link.ready({ request: async () => { throw new LiveChannelLost(true); } });
  await assert.rejects(api.request('viewing.react', { body: { teamId: 'team', messages: {} } }), error => error instanceof ApiError && error.code === 'RESULT_UNKNOWN');
  // Waiting past the request's time is a service that never answered, with nothing sent.
  link.ready(undefined);
  await assert.rejects(api.request('viewing.react', { body: { teamId: 'team', messages: {} }, timeoutMs: 20 }), error => error instanceof ApiError && error.code === 'SERVICE_UNAVAILABLE');
  link.ready({ request: async () => ({ status: 429, body: { error: 'RATE_LIMITED', retryAfterMs: 5000 } }) });
  await assert.rejects(api.request('viewing.react', { body: { teamId: 'team', messages: {} } }), error => error instanceof ApiError && error.status === 429 && error.retryAfterMs === 5000);
  link.detach();
  assert.equal(fetches, 2);
});

test('the Matrix client fetch rides the socket with edit marks and fails like a dropped connection', async () => {
  const api = new Api('https://service.test'); api.token = 'token';
  const link = api.live.attach();
  const sent = [];
  link.ready({ request: async message => { sent.push(message); return message.path.endsWith('/versions') ? { status: 200, body: { versions: ['v1.11'] } } : { status: 403, body: { errcode: 'M_FORBIDDEN', error: 'M_FORBIDDEN' } }; } });
  const fetch = liveMatrixFetch(api.live, url => url.pathname.endsWith('/t1') ? { original: '$root', editBase: '5' } : undefined);
  const versions = await fetch('https://service.test/_matrix/client/versions', { headers: { Authorization: 'Bearer token' } });
  assert.equal(versions.status, 200); assert.deepEqual(await versions.json(), { versions: ['v1.11'] });
  const send = await fetch('https://service.test/_matrix/client/v3/rooms/!r/send/m.room.encrypted/t1?x=1', { method: 'PUT', body: JSON.stringify({ ciphertext: 'c' }) });
  assert.equal(send.status, 403);
  assert.deepEqual(sent, [
    { type: 'matrix', method: 'GET', path: '/_matrix/client/versions' },
    { type: 'matrix', method: 'PUT', path: '/_matrix/client/v3/rooms/!r/send/m.room.encrypted/t1?x=1', body: { ciphertext: 'c' }, original: '$root', editBase: '5' },
  ]);
  link.ready({ request: async () => { throw new LiveChannelLost(true); } });
  await assert.rejects(fetch('https://service.test/_matrix/client/v3/sync'), error => error instanceof TypeError);
  const abort = new AbortController(); link.ready(undefined);
  const aborted = fetch('https://service.test/_matrix/client/v3/sync', { signal: abort.signal });
  abort.abort(new DOMException('stopped', 'AbortError'));
  await assert.rejects(aborted, error => error.name === 'AbortError');
  link.detach();
  await assert.rejects(fetch('https://service.test/_matrix/client/versions'), error => error instanceof TypeError);
});
