import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loginHost } from './helpers/login-host.mjs';
import { indexedDb } from './helpers/indexed-db.mjs';
import { ClientStorage } from '../apps/extension/src/runtime/storage/storage.ts';
import { deriveIdentity, openMnemonic } from '../packages/shared/src/identity.ts';
import { MessageError, message } from '../packages/i18n/src/core.ts';
import { Api, ApiError } from '../apps/extension/src/runtime/transport/api.ts';

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { SessionRuntime } = await import('../apps/extension/src/runtime/account/session-lifecycle.ts');
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
const { WalletRuntime } = await import('../apps/extension/src/runtime/wallet/runtime.ts');
const { deriveWalletAccount } = await import('../apps/extension/src/runtime/wallet/keys.ts');
const { emptyState } = await import('../apps/extension/src/runtime/composition/state.ts');
const { sessionScope } = await import('../apps/extension/src/runtime/account/session.ts');
hooks.deregister();
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const identity = deriveIdentity(mnemonic), pin = '123456';
const password = { name: 'password-set', payload: { password: pin } };

function fixture() {
  const stored = new Map(), requests = [], snapshots = [], commits = [], clients = [];
  const session = { token: 'token', account: { id: identity.publicKey, nickname: '' }, matrix: { userId: '@self:test', deviceId: 'SELF' } };
  const runtime = {
    state: emptyState(), initialise: async () => {},
    emit() { snapshots.push(structuredClone(this.state)); },
    rooms: { reset() {} }, timeline: {},
    storage: {
      async get(key) { return structuredClone(stored.get(key)); },
      async put(key, _account, _kind, value) { stored.set(key, structuredClone(value)); },
      async putMany(rows) { commits.push(structuredClone(rows)); for (const row of rows) stored.set(row.key, structuredClone(row.value)); },
      async remove(key) { stored.delete(key); },
    },
    api: { token: 'retained-token', async request(path, options) {
      requests.push({ path, ...options });
      if (path === 'accounts.lookup') return { account: session.account };
      if (path === 'chain.config') return { enabled: false, version: 1, deployment: null, dailySponsoredLimit: 0, updatedAt: 1 };
      if (path === 'accounts.create' || path === 'devices.create') return { ...structuredClone(session), account: { ...session.account, id: runtime.auth.pendingIdentity.publicKey } };
      assert.fail(`Unexpected request: ${path}`);
    } },
    auth: {
      generation: 0, finishCleanup: async () => {}, discardPendingDevice: async () => {},
      scope() { const generation = this.generation; return sessionScope(() => this.generation === generation, () => new MessageError(message('extension.runtime.loginChanged'))); },
      async connect(device) {
        const client = { stopped: 0, stopClient() { this.stopped++; } }; clients.push(client);
        this.client = client; this.session = device; this.cryptoInitialised = true; device.crypto = 'ready';
        runtime.api.token = device.token; runtime.state.account = device.account;
      },
    },
  };
  runtime.auth = Object.assign(new SessionRuntime(runtime), runtime.auth);
  runtime.wallet = new WalletRuntime(runtime);
  runtime.state.config.signupDifficulty = 1;
  const commands = new RuntimeCommands(runtime);
  const command = input => commands.execute(input);
  async function begin(mode) {
    const words = mode === 'create' ? (await command({ name: 'account-generate' })).words : mnemonic.split(' ');
    await command({ name: `account-${mode}`, payload: { words } });
    return { phrase: words.join(' '), signingIdentity: deriveIdentity(words.join(' ')) };
  }
  return { runtime, stored, requests, snapshots, commits, clients, command, begin };
}

for (const mode of ['create', 'login']) test(`account-${mode} keeps identity in memory until a PIN is set`, async () => {
  const f = fixture();
  f.runtime.auth.connect = async () => assert.fail('The PIN step does not connect');
  const { phrase, signingIdentity } = await f.begin(mode);
  assert.equal(f.runtime.state.setup, 'password');
  assert.equal(f.runtime.state.authenticated, false);
  assert.equal(f.runtime.auth.mnemonic, phrase);
  assert.deepEqual(f.runtime.auth.pendingIdentity, signingIdentity);
  assert.equal(f.stored.size, 0);
  assert.deepEqual(f.requests.map(request => request.path), mode === 'login' ? ['accounts.lookup'] : []);
  if (mode === 'login') assert.deepEqual(f.requests[0].secretKey, identity.secretKey);
});

for (const mode of ['create', 'login']) test(`account-${mode} publishes authentication only after the device and vault commit`, async () => {
  const f = fixture(), connected = Promise.withResolvers(), releaseConnection = Promise.withResolvers(), committing = Promise.withResolvers(), releaseCommit = Promise.withResolvers();
  const { phrase, signingIdentity: expectedIdentity } = await f.begin(mode);
  const connect = f.runtime.auth.connect, commit = f.runtime.storage.putMany;
  f.runtime.auth.connect = async function (device, signingIdentity) {
    assert.deepEqual(signingIdentity, expectedIdentity);
    assert.equal(f.stored.get('pending-device').token, device.token);
    connected.resolve(); await releaseConnection.promise; await connect.call(this, device);
  };
  f.runtime.storage.putMany = async rows => { committing.resolve(); await releaseCommit.promise; return commit(rows); };
  const pending = f.command(password);
  await connected.promise;
  assert.equal(f.runtime.state.authenticated, false); assert.equal(f.commits.length, 0);
  assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
  releaseConnection.resolve(); await committing.promise;
  assert.equal(f.runtime.state.authenticated, false); assert.equal(f.runtime.state.setup, 'password');
  releaseCommit.resolve(); assert.deepEqual(await pending, { nicknameRequired: true });
  assert.equal(f.commits.length, 1);
  assert.deepEqual(f.requests.find(request => ['accounts.create', 'devices.create'].includes(request.path)).secretKey, expectedIdentity.secretKey);
  assert.deepEqual(f.commits[0].map(row => row.key), ['device', 'vault']);
  assert.equal(f.stored.get('device').crypto, 'ready');
  assert.equal(await openMnemonic(f.stored.get('vault'), pin), phrase);
  assert.equal(f.runtime.state.wallet.address, deriveWalletAccount(phrase).address);
  assert.equal(f.stored.get(`${expectedIdentity.publicKey}:wallet-address`), f.runtime.state.wallet.address);
  assert.equal(f.runtime.state.wallet.availability, 'closed');
  assert.ok(f.snapshots.filter(state => state.wallet).every(state => state.wallet.address === deriveWalletAccount(phrase).address));
  assert.equal(f.stored.has('pending-device'), false);
  assert.equal(f.runtime.state.authenticated, true); assert.equal(f.runtime.state.setup, undefined);
  for (const key of ['pendingIdentity', 'pendingDevice', 'mnemonic', 'authMode']) assert.equal(f.runtime.auth[key], undefined);
  assert.ok(f.snapshots.filter(state => state.setup === 'password').every(state => !state.authenticated));
});

for (const failure of ['connection', 'commit']) test(`PIN ${failure} failure preserves the registered device for retry`, async () => {
  const f = fixture(); await f.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  const connect = f.runtime.auth.connect, commit = f.runtime.storage.putMany;
  if (failure === 'connection') f.runtime.auth.connect = async function (device) { await connect.call(this, device); throw Error('unavailable'); };
  else f.runtime.storage.putMany = async () => { throw new MessageError(message('extension.runtime.storageSaveFailed')); };
  await assert.rejects(f.command(password), error => error.text.key === (failure === 'commit' ? 'extension.runtime.storageSaveFailed' : 'extension.runtime.cryptoIdentityUnavailable'));
  const device = f.runtime.auth.pendingDevice;
  assert.ok(device); assert.deepEqual(f.stored.get('pending-device').storageKey, device.storageKey);
  assert.equal(f.runtime.state.setup, 'password'); assert.equal(f.runtime.state.authenticated, false);
  assert.equal(f.runtime.state.account, undefined); assert.equal(f.runtime.auth.session, undefined);
  assert.equal(f.runtime.auth.client, undefined); assert.equal(f.runtime.auth.cryptoInitialised, false);
  assert.equal(f.clients[0].stopped, 1); assert.equal(f.runtime.api.token, 'retained-token');
  assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
  assert.equal(f.runtime.auth.mnemonic, mnemonic); assert.deepEqual(f.runtime.auth.pendingIdentity, identity);
  f.runtime.auth.connect = connect; f.runtime.storage.putMany = commit;
  await f.command(password);
  assert.equal(f.runtime.auth.session, device);
  assert.equal(f.requests.filter(request => request.path === 'devices.create').length, 1);
});

test('registration failure remains readable and leaves the PIN step retryable', async () => {
  const f = fixture(); await f.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  const error = new ApiError(503, { error: 'SERVICE_UNAVAILABLE' });
  f.runtime.api.request = async () => { throw error; };
  await assert.rejects(f.command(password), candidate => candidate === error);
  assert.equal(f.runtime.state.setup, 'password'); assert.equal(f.runtime.state.authenticated, false);
  assert.equal(f.runtime.auth.pendingDevice, undefined); assert.ok(f.runtime.auth.pendingIdentity);
  assert.equal(f.stored.size, 0);
});

test('account creation uses an existing account and retains its registered device across retry', async () => {
  const f = fixture(); await f.begin('create');
  const request = f.runtime.api.request, connect = f.runtime.auth.connect; let accounts = 0;
  f.runtime.api.request = (path, options) => { if (path === 'accounts.create') { accounts++; throw new ApiError(409, { error: 'ACCOUNT_EXISTS' }); } return request(path, options); };
  f.runtime.auth.connect = async () => { throw Error('unavailable'); };
  await assert.rejects(f.command(password));
  f.runtime.auth.connect = connect; await f.command(password);
  assert.equal(accounts, 1); assert.equal(f.requests.filter(request => request.path === 'devices.create').length, 1);
  assert.equal(f.stored.get('device').crypto, 'ready');
});

test('Device and vault writes both roll back when their IndexedDB transaction aborts', async t => {
  const host = indexedDb(t), storage = new ClientStorage(), f = fixture();
  f.runtime.storage = storage;
  await f.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  await storage.put('unrelated', 'other', 'preferences', { retained: true });
  const rows = host.stores.get('records').rows, set = rows.set.bind(rows);
  let deviceWritten = false;
  rows.set = (key, value) => {
    if (key === 'device') deviceWritten = true;
    if (key === 'vault') { assert.equal(deviceWritten, true); throw new Error('transaction aborted'); }
    return set(key, value);
  };
  await assert.rejects(f.command(password), error => error.text?.key === 'extension.runtime.storageSaveFailed');
  assert.equal(deviceWritten, true);
  assert.equal(await storage.get('device'), undefined); assert.equal(await storage.get('vault'), undefined);
  assert.deepEqual(await storage.get('unrelated'), { retained: true });
  assert.ok(await storage.get('pending-device')); assert.equal(f.runtime.state.authenticated, false);
  await f.command(password);
  assert.equal((await storage.get('device')).crypto, 'ready');
  assert.equal(await openMnemonic(await storage.get('vault'), pin), mnemonic);
});

test('Device signing waits for key publication and server verification before authentication', { timeout: 5000 }, async t => {
  const f = loginHost(t), signingIn = f.begin(); await f.started.promise;
  assert.equal(f.calls.includes('sign'), false); assert.equal(f.stored.has('device'), false);
  await f.upload({ one_time_keys: { key: 'one-time' } });
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'OTHER' } });
  assert.equal(f.calls.includes('sign'), false); assert.equal(f.runtime.state.authenticated, false);
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
  await f.verifying.promise;
  assert.equal(f.calls.filter(call => call === 'sign').length, 1);
  assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
  assert.equal(f.runtime.state.authenticated, false);
  f.verify.resolve(); await signingIn;
  assert.equal(f.runtime.state.authenticated, true);
  assert.ok(f.calls.indexOf('verify') < f.calls.indexOf('commit'));
});

test('Logout cancels identity publication and sync errors prevent sign-in completion', { timeout: 5000 }, async t => {
  for (const failure of ['logout', 'sync']) {
    const f = loginHost(t), signingIn = f.begin(), rejected = assert.rejects(signingIn);
    await f.started.promise;
    const abort = f.runtime.auth.identityAbort;
    if (failure === 'logout') await f.runtime.command({ name: 'logout', payload: {} });
    else f.clients[0].emit('ERROR', undefined, { error: new Error('initial sync failed') });
    await rejected;
    assert.equal(abort.signal.aborted, true); assert.equal(f.runtime.state.authenticated, false);
    assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
    assert.equal(f.calls.includes('sign'), false); assert.ok(f.clients[0].stops > 0);
    await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
    assert.equal(f.runtime.state.authenticated, false); assert.equal(f.calls.includes('commit'), false);
  }
});

for (const name of ['logout', 'account-discard']) for (const phase of ['publication', 'verification']) test(`${name} cancels ${phase} through runtime.command without restoring setup`, { timeout: 5000 }, async t => {
  const f = loginHost(t), signingIn = f.begin(), rejected = assert.rejects(signingIn, error => error.text?.key === 'extension.runtime.loginChanged');
  await f.started.promise;
  if (phase === 'verification') {
    await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
    await f.verifying.promise;
  }
  const signal = f.runtime.auth.authenticationScope().signal;
  const cancelled = f.runtime.command({ name, payload: {} });
  assert.equal(signal.aborted, true);
  await cancelled; await rejected;
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.runtime.state.authenticated, false);
  assert.equal(f.runtime.api.token, undefined);
  assert.equal(f.runtime.auth.pendingIdentity, undefined);
  assert.equal(f.runtime.auth.pendingDevice, undefined);
  assert.equal(f.stored.has('pending-device'), false);
  assert.equal(f.stored.has('device'), false);
  assert.equal(f.stored.has('vault'), false);
  f.verify.reject(new Error('verification unavailable'));
  void f.verify.promise.catch(() => {});
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.runtime.api.token, undefined);
  assert.equal(f.calls.includes('commit'), false);
});

test('Cancellation invalidates queued PIN submissions before cleanup', { timeout: 5000 }, async t => {
  const f = loginHost(t), signingIn = f.begin(), rejected = assert.rejects(signingIn);
  await f.started.promise;
  const retry = assert.rejects(f.runtime.command(password), error => error.text?.key === 'extension.runtime.loginChanged');
  await f.runtime.command({ name: 'logout', payload: {} });
  await Promise.all([rejected, retry]);
  assert.equal(f.clients.filter(client => client.starts).length, 1);
  assert.equal(f.runtime.state.setup, undefined);
});

test('Cancellation during initialization prevents the waiting login from starting', { timeout: 5000 }, async t => {
  const f = loginHost(t), initialising = Promise.withResolvers(), ready = Promise.withResolvers();
  f.runtime.initialise = () => { initialising.resolve(); return ready.promise; };
  f.runtime.api.request = async () => assert.fail('Cancelled login cannot dispatch');
  const rejected = assert.rejects(f.runtime.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } }), error => error.text?.key === 'extension.runtime.loginChanged');
  await initialising.promise;
  const cancelled = f.runtime.command({ name: 'account-discard', payload: {} });
  ready.resolve(); await cancelled; await rejected;
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.runtime.auth.pendingIdentity, undefined);
});

test('A new login queued after cancellation gets its own live authentication signal', { timeout: 5000 }, async t => {
  const f = loginHost(t), rejected = assert.rejects(f.begin());
  await f.started.promise;
  const signal = f.runtime.auth.authenticationScope().signal;
  const cancelled = f.runtime.command({ name: 'logout', payload: {} });
  const next = f.runtime.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  await cancelled; await rejected; await next;
  assert.equal(signal.aborted, true);
  assert.equal(f.runtime.auth.authenticationScope().signal.aborted, false);
  assert.equal(f.runtime.state.setup, 'password');
});

for (const outcome of ['success', 'not-found']) test(`Cancelled signed lookup ignores a late ${outcome}`, { timeout: 5000 }, async t => {
  const f = loginHost(t), requested = Promise.withResolvers(), response = Promise.withResolvers();
  const request = f.runtime.api.request;
  f.runtime.api.request = (endpoint, options) => {
    if (endpoint !== 'accounts.lookup') return request(endpoint, options);
    requested.resolve(options.signal); return response.promise;
  };
  const login = f.runtime.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  const rejected = assert.rejects(login, error => error.text?.key === 'extension.runtime.loginChanged');
  const signal = await requested.promise;
  const cancelled = f.runtime.command({ name: 'account-discard', payload: {} });
  assert.equal(signal.aborted, true);
  if (outcome === 'success') response.resolve({});
  else response.reject(new ApiError(404, { error: 'ACCOUNT_NOT_FOUND' }));
  await cancelled; await rejected;
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.runtime.auth.pendingIdentity, undefined);
  assert.equal(f.runtime.auth.mnemonic, undefined);
});

test('Cancellation aborts signup proof of work before request dispatch', { timeout: 5000 }, async t => {
  const f = loginHost(t), signing = Promise.withResolvers(), api = new Api('https://service.test');
  f.runtime.auth = new SessionRuntime(f.runtime); f.runtime.dispatch = new RuntimeCommands(f.runtime);
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('Cancelled signing cannot dispatch'));
  await f.runtime.command({ name: 'account-generate', payload: {} });
  await f.runtime.command({ name: 'account-create', payload: {} });
  f.runtime.state.config.signupDifficulty = 32;
  f.runtime.api.request = (endpoint, options) => {
    assert.equal(endpoint, 'accounts.create');
    const result = api.request(endpoint, options);
    signing.resolve(options.signal); return result;
  };
  const rejected = assert.rejects(f.runtime.command(password), error => error.text?.key === 'extension.runtime.loginChanged');
  const signal = await signing.promise;
  await f.runtime.command({ name: 'account-discard', payload: {} });
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.stored.size, 0);
});

for (const mode of ['create', 'login']) test(`Cancelled ${mode} registration preserves an unknown dispatched outcome`, { timeout: 5000 }, async t => {
  const f = loginHost(t), dispatched = Promise.withResolvers(), api = new Api('https://service.test');
  f.runtime.auth = new SessionRuntime(f.runtime); f.runtime.dispatch = new RuntimeCommands(f.runtime);
  const fetch = t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    dispatched.resolve(options.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  if (mode === 'create') {
    await f.runtime.command({ name: 'account-generate', payload: {} });
    await f.runtime.command({ name: 'account-create', payload: {} });
    f.runtime.state.config.signupDifficulty = 1;
  } else await f.runtime.command({ name: 'account-login', payload: { words: mnemonic.split(' ') } });
  f.runtime.api.request = api.request.bind(api);
  const rejected = assert.rejects(f.runtime.command(password), error => error.code === 'RESULT_UNKNOWN');
  const signal = await dispatched.promise;
  await f.runtime.command({ name: 'logout', payload: {} }); await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(f.runtime.state.setup, undefined);
  assert.equal(f.runtime.state.authenticated, false);
});

test('A registration completing after cancellation is revoked without committing a device', { timeout: 5000 }, async t => {
  const f = loginHost(t), requested = Promise.withResolvers(), response = Promise.withResolvers(), revoked = [];
  const request = f.runtime.api.request;
  f.runtime.api.request = (endpoint, options) => {
    if (endpoint === 'devices.create') { requested.resolve(options.signal); return response.promise; }
    if (endpoint === 'accounts.logout') { revoked.push(options.token); return Promise.resolve({}); }
    return request(endpoint, options);
  };
  const rejected = assert.rejects(f.begin(), error => error.text?.key === 'extension.runtime.loginChanged');
  const signal = await requested.promise;
  const cancelled = f.runtime.command({ name: 'logout', payload: {} });
  assert.equal(signal.aborted, true);
  response.resolve({ token: 'late-token', account: { id: identity.publicKey }, matrix: { userId: '@self:test', deviceId: 'SELF' } });
  await cancelled; await rejected;
  assert.deepEqual(revoked, ['late-token']);
  assert.equal(f.stored.size, 0);
  assert.equal(f.calls.includes('commit'), false);
  assert.equal(f.runtime.state.setup, undefined);
});

test('Cancellation waits for an in-flight device commit before clearing storage', { timeout: 5000 }, async t => {
  const f = loginHost(t), committing = Promise.withResolvers(), release = Promise.withResolvers();
  const putMany = f.runtime.storage.putMany;
  f.runtime.storage.putMany = async rows => { committing.resolve(); await release.promise; return putMany(rows); };
  const rejected = assert.rejects(f.begin(), error => error.text?.key === 'extension.runtime.loginChanged');
  await f.started.promise;
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
  f.verify.resolve(); await committing.promise;
  let cleaned = false;
  const cancelled = f.runtime.command({ name: 'logout', payload: {} }).then(() => { cleaned = true; });
  await Promise.resolve(); assert.equal(cleaned, false);
  release.resolve(); await cancelled; await rejected;
  assert.equal(f.stored.has('device'), false);
  assert.equal(f.stored.has('vault'), false);
  assert.equal(f.runtime.state.authenticated, false);
  assert.equal(f.runtime.state.setup, undefined);
});

for (const name of ['device-remove', 'delete-account']) test(`${name} preserves an unknown outcome when logout aborts its signed request`, { timeout: 5000 }, async t => {
  const f = loginHost(t), signingIn = f.begin();
  await f.started.promise;
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
  f.verify.resolve(); await signingIn;
  f.runtime.dispatch = new RuntimeCommands(f.runtime);
  const dispatched = Promise.withResolvers(), api = new Api('https://service.test');
  const fetch = t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    dispatched.resolve(options.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const request = f.runtime.api.request;
  f.runtime.api.request = (endpoint, options) => endpoint === 'accounts.logout' ? request(endpoint, options) : api.request(endpoint, options);
  const rejected = assert.rejects(f.runtime.command({ name, payload: { password: pin, ...(name === 'device-remove' ? { id: 'SELF' } : {}) } }), error => error.code === 'RESULT_UNKNOWN');
  const signal = await dispatched.promise;
  await f.runtime.command({ name: 'logout', payload: {} }); await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(f.runtime.state.authenticated, false);
});

test('A verified sign-in starts sync once and projects the initial timeline', { timeout: 5000 }, async t => {
  const f = loginHost(t), signingIn = f.begin(); await f.started.promise;
  assert.equal(f.runtime.state.data.messages.length, 0);
  await f.upload({ device_keys: { user_id: '@self:test', device_id: 'SELF' } });
  await f.verifying.promise;
  assert.equal(f.runtime.state.data.messages.length, 0);
  f.verify.resolve(); await signingIn;
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(f.clients.length, 1); assert.equal(f.clients[0].starts, 1);
  assert.equal(f.runtime.state.authenticated, true);
  assert.equal(f.runtime.state.data.messages.length, 1);
  assert.equal(f.runtime.state.data.messages[0].id, '$initial');
  assert.equal(f.runtime.state.data.messages[0].text, 'Initial message');
  assert.equal(f.runtime.state.data.messages[0].author, 'peer');
});

for (const vault of [{ v: 0 }, { v: 999 }, null, undefined]) test(`startup clears an unreadable vault through incomplete sign-in (${vault?.v ?? 'absent'})`, async () => {
  const device = { token: 'token', account: { id: identity.publicKey }, matrix: { userId: '@self:test', deviceId: 'SELF' }, storageKey: Array(32).fill(1), crypto: 'ready' };
  const stored = new Map([['device', device], ['vault', vault]]), calls = [];
  const runtime = {
    state: emptyState(), dispatch: {}, emit() {},
    storage: { get: async key => stored.get(key), rows: async () => [], cleanup: async () => {} },
    api: { request: async name => { assert.equal(name, 'system.config'); return {}; } },
  };
  const auth = new SessionRuntime(runtime);
  auth.revokeDevice = async session => { assert.equal(session, device); calls.push('revoke'); };
  auth.clearDevice = async preservePreferences => {
    assert.equal(preservePreferences, false); calls.push('clear'); stored.clear(); auth.session = undefined;
  };
  auth.connect = async () => assert.fail('An unreadable session cannot connect');
  try {
    await auth.start();
    assert.equal(runtime.state.error.key, 'extension.runtime.loginIncomplete');
    assert.deepEqual(calls.sort(), ['clear', 'revoke']);
    assert.equal(stored.size, 0); assert.equal(auth.session, undefined);
    assert.equal(runtime.state.authenticated, false); assert.equal(runtime.state.ready, true);
  } finally { clearInterval(auth.timer); }
});
