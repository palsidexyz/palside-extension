import test from 'node:test'; import assert from 'node:assert/strict'; import { cacheUsage, clearCache } from '../apps/extension/src/runtime/media/local-data.ts';
test('cache usage and clear delegate to owned cache only', async()=>{let cleared=0;const s={cacheBytes:async()=>42,clearCache:async()=>{cleared++}};assert.deepEqual(await cacheUsage(s),{bytes:42});assert.deepEqual(await clearCache(s),{bytes:42});assert.equal(cleared,1)});

const { ClientStorage } = await import('../apps/extension/src/runtime/storage/storage.ts');
function idbHost(t, factory) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; });
}
function database() {
  return { closed: 0, close() { this.closed++; }, transaction() {
    const transaction = { objectStore: () => ({ get() { const request = {}; queueMicrotask(() => { request.onsuccess(); transaction.oncomplete(); }); return request; } }) };
    return transaction;
  } };
}
for (const failure of ['error', 'blocked']) test(`client storage retries ${failure} opens and shares the next connection`, async t => {
  const requests = []; idbHost(t, { open() { const request = {}; requests.push(request); return request; } });
  const storage = new ClientStorage();
  const failed = assert.rejects(storage.get('device'));
  requests[0][`on${failure}`](); await failed;
  const reads = Promise.all([storage.get('device'), storage.get('vault')]);
  assert.equal(requests.length, 2);
  const db = database(); requests[1].result = db; requests[1].onsuccess(); await reads;
  await storage.get('device'); assert.equal(requests.length, 2);
  if (failure === 'blocked') {
    const late = database(); requests[0].result = late; requests[0].onsuccess();
    assert.equal(late.closed, 1); assert.equal(db.closed, 0);
    await storage.get('device'); assert.equal(requests.length, 2);
  }
});
test('a version change closes the cached client database and permits reopening', async t => {
  const requests = []; idbHost(t, { open() { const request = {}; requests.push(request); return request; } });
  const storage = new ClientStorage(), reading = storage.get('device'), first = database();
  requests[0].result = first; requests[0].onsuccess(); await reading; first.onversionchange();
  const next = storage.get('device'); assert.equal(first.closed, 1); assert.equal(requests.length, 2);
  requests[1].result = database(); requests[1].onsuccess(); await next;
});

const { indexedDb } = await import('./helpers/indexed-db.mjs');
test('typed account reads use the compound index without reading unrelated payloads', async t => {
  const host = indexedDb(t), storage = new ClientStorage();
  await storage.put('a:draft:team', 'a', 'draft', 'draft');
  await storage.put('a:outgoing:message', 'a', 'outgoing', 'unsent');
  await storage.cache('a', 'media', new Blob(['image']), Date.now() + 10000);
  host.operations.length = 0;
  assert.equal((await storage.rows('a', 'draft')).length, 1);
  assert.deepEqual(host.operations.filter(op => op.method === 'getAll').map(op => [op.index, op.query]), [['account-kind', ['a', 'draft']]]);
});
test('the 501st cache write visits only eviction metadata and preserves protected records', async t => {
  const host = indexedDb(t), storage = new ClientStorage(), expires = Date.now() + 10000;
  const blob = new Blob([new Uint8Array(200 * 1024)]);
  await storage.put('a:draft:t', 'a', 'draft', 'draft'); await storage.put('a:outgoing:m', 'a', 'outgoing', 'unsent');
  for (let i = 0; i < 500; i++) await storage.cache('a', String(i).padStart(3, '0'), blob, expires);
  host.operations.length = 0;
  const evicted = await storage.cache('b', 'large', new Blob([new Uint8Array(1024 * 1024)]), expires);
  assert.deepEqual(evicted, []);
  assert.equal(host.operations.filter(op => op.method === 'getAll').length, 0);
  assert.equal(host.operations.filter(op => op.method === 'cursorRow').length, 0);
  host.operations.length = 0;
  assert.deepEqual(await storage.cache('b', 'pressure', new Blob([new Uint8Array(2 * 1024 * 1024)]), expires), ['a:cache:000', 'a:cache:001', 'a:cache:002', 'a:cache:003']);
  assert.ok(host.operations.filter(op => op.method === 'cursorRow').length <= 5);
  assert.equal(await storage.get('a:draft:t'), 'draft'); assert.equal(await storage.get('a:outgoing:m'), 'unsent');
});
test('cache pages commit in one transaction with deterministic eviction and consistent byte accounting', async t => {
  const host = indexedDb(t), storage = new ClientStorage(); let now = 1000; t.mock.method(Date, 'now', () => now);
  await storage.cache('a', 'expired', 'expired', 1001); now++;
  host.operations.length = 0;
  assert.deepEqual(await storage.cacheMany('a', [{ id: 'b', value: 'two', expiresAt: 2000 }, { id: 'a', value: 'one', expiresAt: 2000 }]), ['a:cache:expired']);
  assert.equal(host.operations.filter(op => op.method === 'transaction' && op.mode === 'readwrite').length, 1);
  assert.equal(await storage.cacheBytes(), 10);
  await storage.cache('a', 'a', new Blob(['x']), 2000); assert.equal(await storage.cacheBytes(), 6);
  await storage.remove('a:cache:b'); assert.equal(await storage.cacheBytes(), 1);
  await storage.put('a:preferences', 'a', 'preferences', {}); await storage.cache('b', 'c', 'c', 3000);
  await storage.clearAccount('a'); assert.equal(await storage.cacheBytes(), 3); assert.deepEqual(await storage.get('a:preferences'), {});
  await storage.cleanup(3000); assert.equal(await storage.cacheBytes(), 0);
  await storage.cache('b', 'c', 'c', 4000); await storage.clearCache(); assert.equal(await storage.cacheBytes(), 0);
});

const { registerHooks } = await import('node:module');
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { LocalDataRuntime } = await import('../apps/extension/src/runtime/media/cache.ts');
const { SessionRuntime } = await import('../apps/extension/src/runtime/account/session-lifecycle.ts');
hooks.deregister();
test('history message pages share one durable cache write and retain reply deadlines', async t => {
  const host = indexedDb(t), storage = new ClientStorage(), session = { account: { id: 'a' } }, now = Date.now();
  const first = { id: '$first', teamId: 'team', timestamp: now, text: 'first' }, reply = { id: '$reply', teamId: 'team', timestamp: now + 1, text: 'reply', replyTo: '$first' };
  const runtime = { storage, auth: { session, scope: () => ({ current: () => true, wait: promise => promise }) }, state: { remoteTeams: [{ id: 'team', roomId: 'room', periods: [{ joinedAt: 0, leftAt: null }], retentionDays: 1 }], data: { teams: [], messages: [reply, first], views: [] } } };
  const cache = new LocalDataRuntime(runtime); cache.eventTimes.set(first.id, now); cache.eventTimes.set(reply.id, now + 1);
  await cache.cachePage(async () => { await cache.cacheMessage(reply, now + 1); await cache.cacheMessage(first, now); });
  assert.equal(host.operations.filter(op => op.method === 'transaction' && op.mode === 'readwrite').length, 1);
  assert.equal((await storage.get('a:cache:$reply')).message.replyToExpiresAt, now + 86400_000);
  assert.equal((await storage.rows('a', 'cache')).length, 2);
});

test('history backfill serializes pages, waits for decryption, and discards a replaced session', async t => {
  const host = indexedDb(t), storage = new ClientStorage(), events = [], now = Date.now();
  const runtime = { storage, state: { remoteTeams: [{ id: 'team', roomId: 'room', periods: [{ joinedAt: 0, leftAt: null }], retentionDays: 1 }], data: { teams: [], messages: [], views: [] } } };
  runtime.auth = new SessionRuntime(runtime); runtime.auth.session = { account: { id: 'a' } };
  runtime.cache = new LocalDataRuntime(runtime);
  runtime.timeline = { async consume(event) { assert.ok(event.decrypted); events.push(event.id); await runtime.cache.cacheMessage({ id: event.id, teamId: 'team', text: '', timestamp: now }, now); } };
  runtime.auth.client = {
    async scrollback(room, count) { assert.equal(count, 100); for (const id of room.ids) runtime.auth.historyPage.events.add({ id, isEncrypted: () => true }); },
    async decryptEventIfNeeded(event) { await Promise.resolve(); event.decrypted = true; },
  };
  await Promise.all([runtime.auth.history({ ids: ['$one', '$two'] }), runtime.auth.history({ ids: ['$three'] })]);
  assert.deepEqual(events, ['$one', '$two', '$three']);
  assert.equal(host.operations.filter(op => op.method === 'transaction' && op.mode === 'readwrite').length, 2);
  assert.equal(runtime.auth.historyPage, undefined);
  runtime.auth.client.scrollback = async () => { runtime.auth.historyPage.events.add({ id: '$discard', isEncrypted: () => true }); runtime.auth.session = { account: { id: 'b' } }; };
  await assert.rejects(runtime.auth.history({ ids: [] }));
  assert.deepEqual(events, ['$one', '$two', '$three']); assert.equal(runtime.auth.historyPage, undefined);
});

test('batch eviction preserves timestamp ties, replacements, expiry boundaries and surviving reinsertions', async t => {
  indexedDb(t); t.mock.method(Date, 'now', () => 1000);
  const storage = new ClientStorage(), blob = new Blob([new Uint8Array(40 * 1024 * 1024)]);
  await storage.cacheMany('a', [{ id: 'b', value: blob, expiresAt: 2000 }, { id: 'a', value: blob, expiresAt: 2000 }]);
  assert.deepEqual(await storage.cache('a', 'c', blob, 2000), ['a:cache:a']);
  assert.deepEqual(await storage.cacheMany('a', [{ id: 'd', value: blob, expiresAt: 2000 }, { id: 'b', value: blob, expiresAt: 2000 }]), ['a:cache:c']);
  assert.deepEqual((await storage.rows('a', 'cache')).map(row => row.key), ['a:cache:b', 'a:cache:d']);
  await storage.clearCache();
  await storage.cache('a', 'zero', 'zero', 0); await storage.cache('a', 'negative', 'negative', -1);
  assert.deepEqual(await storage.cache('a', 'boundary', 'boundary', 1000), ['a:cache:negative']);
  assert.deepEqual(await storage.cache('a', 'boundary', 'replacement', 2000), []);
  await storage.cleanup(1000); assert.equal(await storage.get('a:cache:zero'), 'zero'); assert.equal(await storage.get('a:cache:boundary'), 'replacement');
});

test('unreadable vaults use the incomplete-session path', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const session = { account: { id: 'a' } }, revoked = [];
  const runtime = { state: { data: {}, connection: {} }, storage: { get: async key => key === 'device' ? session : key === 'vault' ? { v: -1 } : undefined, rows: async () => [], cleanup: async () => {} }, dispatch: {}, api: { request: async () => ({}) }, emit() {} };
  const auth = new SessionRuntime(runtime);
  auth.revokeDevice = async value => { revoked.push(value); }; auth.clearDevice = async () => { auth.session = undefined; };
  await auth.start(); assert.deepEqual(revoked, [session]); assert.deepEqual(runtime.state.error, { key: 'extension.runtime.loginIncomplete' });
});
