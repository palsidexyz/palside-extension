import { renderMessage } from '../packages/i18n/src/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionStatus, connectionBlock, sendFailure, readonlyNotice } from '../apps/extension/src/runtime/transport/connection.ts';
import { Api, ApiError } from '../apps/extension/src/runtime/transport/api.ts';
const ready = { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false };
test('network hint, business service and message sync have distinct failure states', () => {
  assert.equal(connectionStatus(ready), 'connected');
  assert.equal(connectionStatus({ ...ready, networkOnline: false }), 'network-offline');
  assert.equal(connectionStatus({ ...ready, service: 'unavailable' }), 'service-unavailable');
  assert.equal(connectionStatus({ ...ready, messaging: 'unavailable' }), 'messaging-unavailable');
  assert.equal(connectionStatus({ ...ready, messaging: 'failed' }), 'initialization-failed');
  assert.equal(connectionStatus({ ...ready, service: 'connecting' }), 'connecting');
  assert.equal(connectionStatus({ ...ready, messaging: 'connecting' }), 'connecting');
});
test('online event and API success alone cannot claim chat has recovered', () => {
  assert.ok(connectionBlock({ ...ready, messaging: 'connecting' }));
  assert.ok(connectionBlock({ ...ready, service: 'unavailable' }));
  assert.equal(connectionBlock(ready), undefined);
  assert.equal(connectionStatus({ ...ready, retrying: true, service: 'unavailable' }), 'service-unavailable');
});
test('offline hint takes priority without mislabelling a failed server as device offline', () => {
  assert.equal(connectionStatus({ ...ready, networkOnline: false, service: 'unavailable', messaging: 'unavailable' }), 'network-offline');
  assert.equal(connectionStatus({ ...ready, service: 'unavailable', messaging: 'unavailable' }), 'service-unavailable');
});
test('permissions retain specific departure reasons independent of connection', () => {
  assert.match(renderMessage('zh-CN', readonlyNotice('removed').title), /移出/);
  assert.match(renderMessage('zh-CN', readonlyNotice('dissolved').title), /解散/);
  assert.match(renderMessage('zh-CN', readonlyNotice('left').title), /离开/);
});
test('lost acknowledgement stays uncertain; definite rejection is failed', () => {
  assert.equal(sendFailure(new Error('lost reply'), true, false).status, 'uncertain');
  assert.equal(sendFailure({ httpStatus: 503 }, true, false).status, 'uncertain');
  assert.equal(sendFailure({ httpStatus: 403 }, true, false).status, 'failed');
  assert.equal(sendFailure({ httpStatus: 403 }, true, true).status, 'uncertain');
  assert.equal(sendFailure({ code: 'CONNECTION_UNAVAILABLE' }, false, false).status, 'waiting');
  assert.equal(sendFailure({ code: 'CONNECTION_UNAVAILABLE' }, true, false).status, 'uncertain');
});
test('upload, permissions, rate limiting and session failures have actionable text', () => {
  assert.match(renderMessage('zh-CN', sendFailure({ code: 'UPLOAD_FAILED' }, false, false).detail), /图片上传失败/);
  assert.match(renderMessage('zh-CN', sendFailure({ httpStatus: 401 }, true, false).detail), /登录已失效/);
  assert.match(renderMessage('zh-CN', sendFailure({ httpStatus: 403 }, true, false).detail), /发送权限/);
  assert.match(renderMessage('zh-CN', sendFailure({ httpStatus: 429 }, true, false).detail), /过于频繁/);
});
test('unreachable service is not labelled device offline and write uncertainty is preserved', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  const api = new Api('https://service.example.test');
  await assert.rejects(api.request('accounts.snapshot'), e => e instanceof ApiError && e.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(api.request('accounts.update', { body: { bio: '' } }), e => e.code === 'RESULT_UNKNOWN');
});
test('HTML gateway failures preserve HTTP status instead of exposing JSON syntax errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<h1>Bad gateway</h1>', { status: 502 }));
  await assert.rejects(new Api('https://service.example.test').request('accounts.snapshot'), e => e.status === 502 && e.code === 'INVALID_RESPONSE' && e.text.key === 'extension.errors.INVALID_RESPONSE');
});

for (const method of ['request', 'upload', 'media', 'roomAvatar', 'inviteAvatar']) test(`${method} preserves standard errors and honors contract milliseconds`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls.push(options); return new Response(JSON.stringify({ error: 'UPLOAD_QUOTA', retryAfterMs: 7000 }), { status: 429, headers: { 'Retry-After': '7' } }); });
  const api = new Api('https://service.test'); api.token = 'token';
  const read = () => method === 'request' ? api.request('teams.create', { key: 'same-operation-0001', body: { name: 'Test' } }) : method === 'upload' ? api.upload(new Blob(['image']), 'avatar') : method === 'media' ? api.media('11111111-1111-4111-8111-111111111111') : method === 'roomAvatar' ? api.roomAvatar('token:Solana:So11111111111111111111111111111111111111112', 'person') : api.inviteAvatar('invite');
  await assert.rejects(read(), error => error instanceof ApiError && error.code === 'UPLOAD_QUOTA' && error.retryAfterMs === 7000);
  t.mock.timers.tick(6999); await assert.rejects(read(), { status: 429 }); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await assert.rejects(read()); assert.equal(calls.length, 2);
  if (method === 'request') assert.ok(calls.every(call => call.headers['Idempotency-Key'] === 'same-operation-0001'));
});

test('HTTP-date Retry-After uses server Date and body milliseconds can require a longer wait', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  let body = { error: 'M_LIMIT_EXCEEDED' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 429, headers: { Date: 'Thu, 01 Jan 2026 00:01:00 GMT', 'Retry-After': 'Thu, 01 Jan 2026 00:01:10 GMT' } }));
  await assert.rejects(new Api('https://service.test').request('accounts.snapshot'), { retryAfterMs: 10_000 });
  body = { error: 'RATE_LIMITED', retryAfterMs: 15_000 };
  await assert.rejects(new Api('https://service.test').request('accounts.snapshot'), { retryAfterMs: 15_000 });
});

test('a shorter concurrent 429 cannot shorten an existing cooldown', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const replies = []; t.mock.method(globalThis, 'fetch', () => new Promise(resolve => replies.push(resolve)));
  const api = new Api('https://service.test');
  const first = assert.rejects(api.request('accounts.snapshot')), second = assert.rejects(api.request('accounts.snapshot'));
  replies[0](new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })); await first;
  replies[1](new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })); await second;
  t.mock.timers.tick(1000); await assert.rejects(api.request('accounts.snapshot'), { retryAfterMs: 9000 });
  assert.equal(replies.length, 2);
});

test('caller cancellation and the request deadline both abort writes without replaying them', async t => {
  for (const cancel of [false, true]) {
    let calls = 0, deadline;
    t.mock.method(AbortSignal, 'timeout', () => { deadline = new AbortController(); return deadline.signal; });
    t.mock.method(globalThis, 'fetch', (_url, options) => { calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); });
    const caller = new AbortController(), api = new Api('https://service.test');
    const result = assert.rejects(api.request('teams.create', { body: { name: 'Test' }, key: 'operation-write-0001', signal: caller.signal }), { code: 'RESULT_UNKNOWN' });
    (cancel ? caller : deadline).abort(); await result; assert.equal(calls, 1);
  }
});
