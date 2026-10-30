import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createClient, EventStatus, MatrixEvent, MatrixScheduler, MemoryStore, Room } from 'matrix-js-sdk';
import { encryptedCrypto } from './helpers/encrypted-room.mjs';
import { renderMessage, errorMessage } from '../packages/i18n/src/core.ts';
import { SendPacer, throttleWait, THROTTLE_MAX_WAIT } from '../apps/extension/src/runtime/chat/send-pacer.ts';
import { sendFailure } from '../apps/extension/src/runtime/transport/connection.ts';
import { Api, ApiError } from '../apps/extension/src/runtime/transport/api.ts';

test('the local pacer mirrors the service: ten at once, then one per second, per team', () => {
  let clock = 1000; const pacer = new SendPacer(undefined, undefined, () => clock);
  for (let i = 0; i < 10; i++) assert.equal(pacer.reserve('team'), 1000);
  assert.equal(pacer.reserve('team'), 2000); assert.equal(pacer.reserve('team'), 3000);
  assert.equal(pacer.reserve('other'), 1000, 'teams pace independently');
  clock = 60_000; assert.equal(pacer.reserve('team'), 60_000, 'an idle team refills its burst');
});

test('a wait the service asked for moves the next slot exactly there', () => {
  const clock = 0; const pacer = new SendPacer(undefined, undefined, () => clock);
  pacer.defer('team', 4500);
  assert.equal(pacer.reserve('team'), 4500); assert.equal(pacer.reserve('team'), 5500);
});

test('only short throttling is absorbed by queueing; quotas and other errors surface', () => {
  assert.equal(throttleWait({ httpStatus: 429, data: { retry_after_ms: 1200 } }), 1200);
  assert.equal(throttleWait(new ApiError(429, { error: 'RATE_LIMITED', retryAfterMs: 50 })), 250);
  assert.equal(throttleWait({ httpStatus: 429, data: { retry_after_ms: THROTTLE_MAX_WAIT + 1 } }), undefined);
  assert.equal(throttleWait(new ApiError(429, { error: 'UPLOAD_QUOTA', retryAfterMs: 3600000 })), undefined);
  assert.equal(throttleWait({ httpStatus: 403 }), undefined);
});

test('throttled errors say how long to wait in a natural unit', () => {
  assert.equal(renderMessage('zh-CN', errorMessage(new ApiError(429, { error: 'RATE_LIMITED', retryAfterMs: 9000 }))), '操作过于频繁，请 9 秒后重试。');
  assert.equal(renderMessage('en', errorMessage(new ApiError(429, { error: 'RATE_LIMITED', retryAfterMs: 61000 }))), 'Too many attempts. Try again in 2 minutes.');
  assert.equal(renderMessage('en', errorMessage(new ApiError(429, { error: 'RATE_LIMITED', retryAfterMs: 3600000 }))), 'Too many attempts. Try again in 1 hour.');
  assert.equal(renderMessage('zh-CN', errorMessage(new ApiError(429, { error: 'RATE_LIMITED' }))), '请求过于频繁，请稍后重试。');
  assert.match(renderMessage('zh-CN', sendFailure(new ApiError(429, { error: 'UPLOAD_QUOTA', retryAfterMs: 7200000 }), false, false).detail), /今日图片额度已用完，约 2 小时后恢复/);
});

test('a throttled route stays quiet locally until the service wait passes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfterMs: 1000 }), { status: 429 }); });
  const api = new Api('https://service.example.test');
  await assert.rejects(api.request('accounts.snapshot'), e => e.status === 429);
  await assert.rejects(api.request('accounts.snapshot'), e => e.status === 429 && e.retryAfterMs === 1000);
  assert.equal(calls, 1, 'the second call never reached the network');
  await assert.rejects(api.request('teams.lobby'), e => e.status === 429); assert.equal(calls, 2, 'other routes are unaffected');
  t.mock.timers.tick(999); await assert.rejects(api.request('accounts.snapshot'), e => e.status === 429); assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await assert.rejects(api.request('accounts.snapshot')); assert.equal(calls, 3);
});

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { SendingRuntime } = await import('../apps/extension/src/runtime/chat/sending.ts');
hooks.deregister();

function sdkSendFixture(t, respond) {
  const requests = [], echoes = [], records = new Map();
  const client = createClient({ scheduler: new MatrixScheduler(() => -1), store: new MemoryStore(), baseUrl: 'https://service.invalid', userId: '@self:test', deviceId: 'SELF', accessToken: 'test', fetchFn: async (url, init) => {
    assert.match(String(url), /\/send\/m.room.encrypted\//);
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    echoes.push(room.getEventForTxnId('message'));
    return respond(requests.length);
  } });
  const room = new Room('!room:test', client, '@self:test', { pendingEventOrdering: 'detached' });
  client.store.storeRoom(room);
  room.currentState.setStateEvents([new MatrixEvent({ room_id: room.roomId, type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })]);
  t.mock.method(client, 'getCrypto', () => encryptedCrypto());
  // Only crypto and receipt lookup are substituted; sending uses the SDK's real Room ledger.
  t.mock.method(client, 'encryptEventIfNeeded', async event => {
    if (!event.isEncrypted()) event.makeEncrypted('m.room.encrypted', { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'message-ciphertext' }, 'sender-key', 'signing-key');
  });
  t.mock.method(client, 'fetchRoomEvent', async () => { throw new Error('sync pending'); });
  const runtime = {
    state: { remoteTeams: [{ id: 'team', roomId: room.roomId, joined: true, memberIds: ['self'], people: [{ id: 'self', matrixId: '@self:test', nickname: 'Self' }], retentionDays: 7 }], data: { teams: [], messages: [] }, drafts: {}, preferences: {}, connection: { service: 'ready', messaging: 'ready', networkOnline: true } },
    auth: { session: { account: { id: 'self' } }, client, requireConnection() {}, scope: () => ({ check() {}, current: () => true, wait: value => value }) },
    storage: { get: async key => records.get(key), put: async (key, _account, _kind, value) => { records.set(key, structuredClone(value)); }, remove: async key => { records.delete(key); }, clearSentDraft: async () => true },
    cache: { eventTimes: new Map(), cacheMessage: async () => {} },
    sharing: { savePreferences: async () => {} }, diagnosticErrors: { record(error) { throw error; } }, emit() {},
  };
  const sending = new SendingRuntime(runtime);
  return { runtime, sending, room, requests, echoes, records, send: () => sending.send({ id: 'message', teamId: 'team', author: 'self', text: 'secret' }, 0) };
}

test('real Matrix Room: a throttled send reuses its original event and ciphertext', async t => {
  const f = sdkSendFixture(t, count => Response.json(count <= 2 ? { errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 250 } : { event_id: '$sent' }, { status: count <= 2 ? 429 : 200 }));
  const queue = t.mock.method(f.sending, 'queue', async (_team, _message, _at, guard) => { guard(); });
  assert.deepEqual(await f.send(), { eventId: '$sent' });
  assert.equal(queue.mock.callCount(), 2);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[1], f.requests[2]);
  assert.equal(f.echoes[1], f.echoes[2]);
  assert.deepEqual(f.requests[0], f.requests[1]);
  assert.equal(f.echoes[0], f.echoes[1]);
  assert.equal(f.room.getEventForTxnId('message'), f.echoes[0]);
  assert.equal(f.echoes[0].status, EventStatus.SENT);
  assert.equal(f.sending.outgoing.size, 0);
  assert.deepEqual(f.runtime.state.data.messages.map(message => [message.id, message.status]), [['$sent', 'sent']]);
});

test('real Matrix Room: throttled retry rechecks encryption before resending', async t => {
  const f = sdkSendFixture(t, () => Response.json({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 250 }, { status: 429 }));
  t.mock.method(f.sending, 'queue', async (_team, _message, _at, guard) => {
    t.mock.method(f.room, 'hasEncryptionStateEvent', () => false);
    guard();
  });
  await assert.rejects(f.send());
  assert.equal(f.requests.length, 1);
  assert.equal(f.room.getEventForTxnId('message'), f.echoes[0]);
  assert.equal(f.echoes[0].status, EventStatus.NOT_SENT);
  assert.equal(f.sending.outgoing.size, 1);
});

test('real Matrix Room: response loss stays uncertain and a manual retry uses the same event', async t => {
  const f = sdkSendFixture(t, count => {
    if (count === 1) throw new Error('response lost');
    return Response.json({ event_id: '$sent' });
  });
  await assert.rejects(f.send());
  assert.equal(f.requests.length, 1);
  assert.equal(f.runtime.state.data.messages[0].status, 'uncertain');
  assert.equal(f.sending.outgoing.size, 1);
  assert.deepEqual(await f.send(), { eventId: '$sent' });
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[0], f.requests[1]);
  assert.equal(f.echoes[0], f.echoes[1]);
});

for (const status of [EventStatus.SENT, EventStatus.SENDING, EventStatus.ENCRYPTING, EventStatus.QUEUED]) test(`real Matrix Room: throttled retry reconciles a ${status} echo`, async t => {
  const f = sdkSendFixture(t, () => Response.json({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 250 }, { status: 429 }));
  t.mock.method(f.sending, 'queue', async (_team, _message, _at, guard) => {
    const pending = f.room.getEventForTxnId('message');
    f.room.updatePendingEvent(pending, EventStatus.SENDING);
    if (status !== EventStatus.SENDING) f.room.updatePendingEvent(pending, status, status === EventStatus.SENT ? '$sent' : undefined);
    guard();
  });
  if (status === EventStatus.SENT) {
    assert.deepEqual(await f.send(), { eventId: '$sent' });
    assert.equal(f.sending.outgoing.size, 0);
  } else {
    await assert.rejects(f.send());
    assert.equal(f.runtime.state.data.messages[0].status, 'uncertain');
    assert.equal(f.sending.outgoing.size, 1);
  }
  assert.equal(f.requests.length, 1);
  assert.equal(f.room.getEventForTxnId('message'), f.echoes[0]);
  assert.equal(f.echoes[0].status, status);
});
