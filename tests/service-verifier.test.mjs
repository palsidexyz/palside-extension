import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceApi, mediaResponseStatus, requestDeadline, waitUntil } from '../scripts/lib/service-accounts.mjs';

test('media status decodes successful binary responses', async () => {
  assert.equal(await mediaResponseStatus(new Response(new Uint8Array([1, 2, 3]))), 200);
});

test('media status accepts shared 403 and 404 error bodies', async () => {
  for (const [status, error] of [[403, 'MEDIA_FORBIDDEN'], [404, 'MEDIA_UNAVAILABLE']]) {
    assert.equal(await mediaResponseStatus(Response.json({ error }, { status })), status);
  }
});

test('media status rejects malformed denied responses', async () => {
  for (const status of [403, 404]) {
    for (const body of [{}, { error: 'UNKNOWN' }, { errcode: 'M_FORBIDDEN', error: 'denied' }, { error: 'MEDIA_FORBIDDEN', extra: true }]) {
      await assert.rejects(mediaResponseStatus(Response.json(body, { status })));
    }
    await assert.rejects(mediaResponseStatus(new Response('invalid json', { status })), SyntaxError);
  }
});

function keepAlive(t) {
  // AbortSignal.timeout does not keep the Node event loop alive.
  const timer = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(timer));
}

function stalledRequest(signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('request deadline aborts a request that never returns headers', { timeout: 2_000 }, async t => {
  keepAlive(t);
  const signal = requestDeadline(20);
  await assert.rejects(stalledRequest(signal), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
});

test('request deadline remains active while the response body stalls', { timeout: 2_000 }, async t => {
  keepAlive(t);
  const signal = requestDeadline(20);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
  }));
  await assert.rejects(response.json(), { name: 'TimeoutError' });
});

test('request deadline preserves caller cancellation', async () => {
  const controller = new AbortController();
  const signal = requestDeadline(30_000, controller.signal);
  const reason = new Error('client stopped');
  const pending = assert.rejects(stalledRequest(signal), error => error === reason);
  controller.abort(reason);
  await pending;
  assert.equal(requestDeadline(30_000, controller.signal).reason, reason);
});

test('request deadline expires even with an active caller signal', { timeout: 2_000 }, async t => {
  keepAlive(t);
  const controller = new AbortController();
  await assert.rejects(stalledRequest(requestDeadline(20, controller.signal)), { name: 'TimeoutError' });
  assert.equal(controller.signal.aborted, false);
});

test('service API passes a deadline to fetch and propagates body timeouts', { timeout: 2_000 }, async t => {
  keepAlive(t);
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 30_000);
    return timeout(20);
  });
  const api = createServiceApi({ base: 'http://service.invalid', fetcher: async (url, { signal }) => {
    assert.equal(url, 'http://service.invalid/_matrix/client/versions');
    assert.ok(signal instanceof AbortSignal);
    return { ok: true, status: 200, json: () => stalledRequest(signal) };
  } });
  await assert.rejects(api('/_matrix/client/versions'), { name: 'TimeoutError' });
});

test('polling expires while a callback is pending and ignores its late rejection', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let calls = 0, rejectCheck;
  const pending = waitUntil(() => {
    calls++;
    return new Promise((resolve, reject) => { rejectCheck = reject; });
  }, 500);
  const rejected = assert.rejects(pending, /Timed out waiting for Matrix synchronization/);
  t.mock.timers.tick(100);
  t.mock.timers.tick(400);
  await rejected;
  rejectCheck(new Error('late callback failure'));
  await Promise.resolve();
  t.mock.timers.tick(1_000);
  assert.equal(calls, 1);
});

test('polling retries false results and errors, then stops after success', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let calls = 0;
  const pending = waitUntil(async () => {
    calls++;
    if (calls === 1) throw new Error('not ready');
    return calls === 3;
  }, 500);
  for (let index = 0; index < 3; index++) {
    t.mock.timers.tick(100);
    await Promise.resolve();
  }
  await pending;
  t.mock.timers.tick(1_000);
  assert.equal(calls, 3);
});

test('polling preserves the last callback error at its deadline', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const reason = new Error('service unavailable');
  const rejected = assert.rejects(waitUntil(() => { throw reason; }, 500), error => error === reason);
  t.mock.timers.tick(500);
  await rejected;
});
