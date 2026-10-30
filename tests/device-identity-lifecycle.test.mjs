import { productionModules } from './helpers/production-module.mjs';
import { createPatchSliceCache, diffState } from '../apps/extension/src/runtime/transport/state-diff.ts';
import { teamUnreadCounts } from '../apps/extension/src/domain/chat/unread-mentions.ts';
import * as contractLimits from '../packages/shared/src/contracts/limits.ts';
import * as contractCommon from '../packages/shared/src/contracts/common.ts';
import { parseCommand } from '../apps/extension/src/runtime/transport/command-map.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as identity from '../packages/shared/src/identity.ts';
import * as rooms from '../packages/shared/src/contracts/rooms.ts';
import { Api, ApiError } from '../apps/extension/src/runtime/transport/api.ts';
import { deviceKeyPublication, ensureCryptoIdentity, ownDeviceSigned, secretStorageCallbacks, OnlySignedDevicesIsolationMode } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { connectionBlock, connectionStatus, readonlyNotice, sendFailure } from '../apps/extension/src/runtime/transport/connection.ts';
import { commandError, SERIAL_COMMANDS } from '../apps/extension/src/runtime/composition/commands.ts';
import { sessionGuard, sessionScope } from '../apps/extension/src/runtime/account/session.ts';
import { DeviceCleanup, within } from '../apps/extension/src/runtime/account/cleanup.ts';
import * as social from '../apps/extension/src/domain/annotations/social.ts';
import { emptyItems } from '../apps/extension/src/domain/annotations/social.ts';
import { assetView } from '../apps/extension/src/domain/assets/model.ts';
import { canSend, emptyDraft, readQuoteRange } from '../apps/extension/src/domain/chat/model.ts';
import { readView, validateView, pageView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { messageExpiry } from '../apps/extension/src/runtime/chat/message-expiry.ts';
import { requireEncryptedSend, teamSendGuard } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { installEncryptedRoom } from './helpers/encrypted-room.mjs';
import { SendPacer, throttleWait, THROTTLE_RETRIES } from '../apps/extension/src/runtime/chat/send-pacer.ts';
import { publishSendQueue } from '../apps/extension/src/runtime/chat/messages.ts';
import { mergePoke, pruneTeamItems } from '../apps/extension/src/runtime/annotations/team-items.ts';
import { uniqueMediaIds } from '../apps/extension/src/runtime/teams/teams.ts';
import { offlineDirectory } from '../apps/extension/src/runtime/account/offline-directory.ts';
import { retainedViews } from '../apps/extension/src/runtime/viewing/view-retention.ts';
import { notificationTarget } from '../apps/extension/src/runtime/chat/notification-policy.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { resolveTokenMetadata, tokenName } from '../apps/extension/src/runtime/viewing/token-page.ts';
import { imageSource } from '../apps/extension/src/runtime/media/image-sessions.ts';
import { defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures } from '../apps/extension/src/domain/annotations/interaction.ts';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const pin = '123456';
const ownIdentity = identity.deriveIdentity(mnemonic);
const passwordSet = { name: 'password-set', payload: { password: pin } };
const accountLogin = { name: 'account-login', payload: { words: mnemonic.split(' ') } };
const readKey = client => client.options.cryptoCallbacks.getSecretStorageKey({ keys: { key: {} } }, 'm.cross_signing.master');

function fixture({ stored = new Map(), hasKeys = false, verified = false, ready = false } = {}) {
  const intervals = []; const clients = []; const writes = []; const snapshots = []; const requests = [];
  const server = { hasKeys, verified, devicePublished: verified || ready, bootstrapError: undefined, startError: undefined, syncError: undefined, logoutError: undefined, verifyFails: false, bootstraps: 0, keyChecks: 0 };
  const failures = { commit: false, pendingRemoval: false }; const cleared = [];
  const session = { token: 'token', account: { id: ownIdentity.publicKey, nickname: '' }, matrix: { userId: '@own:test', deviceId: 'DEVICE' }, storageKey: Array(32).fill(1), ...(ready ? { crypto: 'ready' } : {}) };
  const context = {
    parseCommand: input => parseCommand(JSON.parse(JSON.stringify(input))), ...languageGlobals, ...contractLimits, ...contractCommon, ...identity, ...social, ...rooms, resolveTokenMetadata, tokenName, imageSource, TextEncoder, uniqueMediaIds, offlineDirectory, retainedViews, pruneTeamItems, notificationTarget, assetView, canSend, emptyDraft, readQuoteRange, readView, validateView, pageView, messageExpiry, publishSendQueue, throttleWait, THROTTLE_RETRIES, readonlyNotice, sendFailure, Api, ApiError, API_URL: 'https://service.test', crypto, Date, Uint8Array, URL, URLSearchParams, Headers, Blob, AbortController, setTimeout, clearTimeout, setInterval: callback => { intervals.push(callback); return intervals.length; },
    deviceKeyPublication, ensureCryptoIdentity, ownDeviceSigned, secretStorageCallbacks, OnlySignedDevicesIsolationMode, connectionBlock, connectionStatus, commandError, SERIAL_COMMANDS, sessionGuard, sessionScope, DeviceCleanup, within,
    emptyItems, defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures, deviceLabel: () => 'Test', usableDirectory: () => undefined,
    SendPacer, requireEncryptedSend, teamSendGuard, createPatchSliceCache, diffState, teamUnreadCounts,
    fetch: async (_input, init) => { const keys = JSON.parse(init.body).device_keys; if (keys?.user_id === session.matrix.userId && keys?.device_id === session.matrix.deviceId) server.devicePublished = true; return new Response('{}'); },
    EventType: { RoomMessage: 'm.room.message' }, EventStatus: { NOT_SENT: 'not_sent', SENT: 'sent' }, MsgType: { Text: 'm.text' }, DiagnosticErrors: class { observe() {} record() {} },
    ClientEvent: { Sync: 'sync', ToDeviceEvent: 'toDevice' }, RoomEvent: { Timeline: 'timeline' }, MatrixEventEvent: { Decrypted: 'decrypted' }, PendingEventOrdering: { Detached: 'detached' }, MatrixScheduler: class {},
    connectLiveEvents: () => () => {},
    createClient: options => {
      const handlers = new Map();
      const cryptoApi = {
        setDeviceIsolationMode() {},
        userHasCrossSigningKeys: async () => { server.keyChecks++; return server.hasKeys; },
        getCrossSigningStatus: async () => ({ privateKeysInSecretStorage: true }),
        bootstrapSecretStorage: async config => {
          client.key = (await readKey(client))?.[1];
          assert.deepEqual((await config.createSecretStorageKey()).privateKey, client.key);
          if (server.bootstrapError) throw server.bootstrapError;
        },
        bootstrapCrossSigning: async () => { server.bootstraps++; server.hasKeys = true; },
        getDeviceVerificationStatus: async (user, device) => {
          assert.equal(user, session.matrix.userId); assert.equal(device, session.matrix.deviceId);
          return { crossSigningVerified: server.verified };
        },
        crossSignDevice: async () => { assert.equal(server.devicePublished, true, 'Signatures require a published device'); server.verified = !server.verifyFails; },
      };
      const client = {
        options, started: 0, stopped: 0, retries: 0, emit: (name, event) => handlers.get(name)?.(event),
        getUserId: () => options.userId, getDeviceId: () => options.deviceId, getCrypto: () => cryptoApi,
        downloadKeysForUsers: async ([user]) => { server.keyChecks++; const key = 'ed25519:SELF'; return { self_signing_keys: server.hasKeys ? { [user]: { keys: { [key]: 'SELF' } } } : {}, device_keys: { [user]: server.devicePublished ? { [options.deviceId]: { signatures: server.verified ? { [user]: { [key]: 'sig' } } : {} } } : {} } }; },
        initRustCrypto: async () => { if (server.initialising) await server.initialising.promise; }, on: (name, listener) => handlers.set(name, listener),
        removeListener: (name, listener) => { if (handlers.get(name) === listener) handlers.delete(name); },
        getSyncState: () => server.syncError ? 'ERROR' : client.started ? 'PREPARED' : null,
        getRooms: () => [],
        startClient: async () => {
          if (server.startError) throw server.startError;
          client.started++;
          handlers.get('sync')?.(server.syncError ? 'ERROR' : 'PREPARED', undefined, { error: server.syncError });
          if (!server.syncError && !server.devicePublished) await options.fetchFn('https://service.test/_matrix/client/v3/keys/upload', { method: 'POST', body: JSON.stringify({ device_keys: { user_id: options.userId, device_id: options.deviceId } }) });
        },
        clearStores: async options => { cleared.push(options); },
        stopClient: () => { client.stopped++; }, retryImmediately: () => { client.retries++; },
      };
      clients.push(client); return client;
    },
  };
  context.Runtime = productionModules(context)('apps/extension/src/runtime/composition/core.ts').PalsideService;
  const storage = {
    get: async key => structuredClone(stored.get(key)), rows: async () => [],
    put: async (key, _account, _kind, value) => { writes.push({ key, value: structuredClone(value) }); stored.set(key, structuredClone(value)); },
    putMany: async rows => {
      if (failures.commit) throw new languageGlobals.MessageError(languageGlobals.uiMessage('extension.runtime.storageSaveFailed'));
      for (const { key, value } of rows) { writes.push({ key, value: structuredClone(value) }); stored.set(key, structuredClone(value)); }
    },
    remove: async key => { if (key === 'pending-device' && failures.pendingRemoval) throw Error('storage unavailable'); stored.delete(key); },
    cleanup: async () => {}, clearAccount: async (account, preservePreferences) => {
      for (const key of stored.keys()) if (key.startsWith(`${account}:`) && (!preservePreferences || key !== `${account}:preferences`)) stored.delete(key);
    },
    cache: async (account, id, value) => { stored.set(`${account}:cache:${id}`, structuredClone(value)); return []; },
    updateDraft: async (account, team, patch, revision, empty) => {
      const key = `${account}:draft:${team}`; const previous = stored.get(key) ?? { value: empty, revision: 0 };
      assert.equal(previous.revision, revision);
      const value = { revision: revision + 1, value: { ...previous.value, ...patch }, updatedAt: Date.now() };
      stored.set(key, structuredClone(value)); return structuredClone(value);
    },
    clearSentDraft: async (account, team, revision, empty) => {
      const key = `${account}:draft:${team}`; const previous = stored.get(key);
      if (previous?.revision !== revision) return false;
      stored.set(key, { revision: revision + 1, value: structuredClone(empty), updatedAt: Date.now() }); return true;
    },
  };
  const value = new context.Runtime(undefined, undefined, storage);
  value.initialise = async () => {};
  value.cache.expireLocalContent = async () => {};
  value.auth.fetchSnapshot = async () => { value.state.connection.service = 'ready'; };
  value.emit = () => snapshots.push(structuredClone(value.state));
  value.state.config = { websiteUrl: 'https://site.test', signupDifficulty: 1 };
  value.api.request = async (path, options) => {
    requests.push({ path, token: options?.token ?? value.api.token, ...options });
    if (path === 'accounts.create' || path === 'devices.create') {
      session.account.id = value.auth.pendingIdentity.publicKey;
      return structuredClone(session);
    }
    if (path === 'accounts.logout') { if (server.logoutError) throw server.logoutError; return {}; }
    if (path === 'system.config') return value.state.config;
    if (path === 'accounts.lookup') return { account: session.account };
    if (path === 'rooms.blocks') return { people: [] };
    throw Error(`Unexpected request: ${path}`);
  };
  return { value, clients, server, session, stored, writes, snapshots, requests, cleared, failures, intervals };
}

async function startup(f, { vault = true } = {}) {
  f.stored.set('device', structuredClone(f.session));
  if (vault) f.stored.set('vault', await identity.sealMnemonic(mnemonic, pin));
  await f.value.auth.start();
}

function assertRolledBack(f) {
  assert.equal(f.value.state.setup, 'password');
  assert.equal(f.value.state.authenticated, false);
  assert.equal(f.value.state.account, undefined);
  assert.equal(f.value.auth.session, undefined);
  assert.equal(f.value.auth.client, undefined);
  assert.equal(f.value.auth.cryptoInitialised, false);
  assert.equal(f.stored.has('device'), false);
  assert.equal(f.stored.has('vault'), false);
  assert.ok(f.value.auth.pendingDevice);
  assert.ok(f.value.auth.pendingIdentity);
  assert.equal(f.value.auth.mnemonic, mnemonic);
  assert.equal(f.value.auth.authMode, 'login');
}

for (const mode of ['create', 'login']) test(`password-set after account-${mode} bootstraps and commits a verified device with its vault`, async () => {
  const { value, stored, clients, server, requests, snapshots, writes } = fixture();
  const words = mode === 'create' ? (await value.command({ name: 'account-generate' })).words : mnemonic.split(' ');
  await value.command({ name: `account-${mode}`, payload: mode === 'login' ? { words } : {} });
  const expected = identity.deriveIdentity(words.join(' '));
  const result = await value.command(passwordSet);
  assert.equal(result.nicknameRequired, true);
  assert.equal(server.bootstraps, 1);
  assert.deepEqual(clients[0].key, expected.secretStorageKey);
  assert.deepEqual(requests.find(request => ['accounts.create', 'devices.create'].includes(request.path)).secretKey, expected.secretKey);
  assert.equal(await readKey(clients[0]), null);
  assert.equal(value.auth.pendingIdentity, undefined); assert.equal(value.auth.pendingDevice, undefined);
  assert.equal(value.auth.mnemonic, undefined); assert.equal(value.auth.authMode, undefined); assert.equal(value.state.setup, undefined);
  assert.equal(value.state.authenticated, true); assert.equal(value.auth.session.crypto, 'ready');
  assert.equal(stored.get('device').crypto, 'ready');
  assert.equal(await identity.openMnemonic(stored.get('vault'), pin), words.join(' '));
  assert.equal(stored.has('pending-device'), false);
  assert.equal(value.state.connection.messaging, 'ready');
  assert.ok(snapshots.filter(state => state.setup === 'password').every(state => !state.authenticated));
  assert.ok(writes.filter(row => row.key === 'device').every(row => row.value.crypto === 'ready'));
});

for (const failure of ['bootstrap', 'verification', 'start', 'commit']) test(`password-set ${failure} failure rolls back and retries the same registered device`, async () => {
  const f = fixture(); const { value, server, clients, requests, stored, failures } = f;
  value.api.token = 'previous-token';
  await value.command(accountLogin);
  if (failure === 'bootstrap') server.bootstrapError = Error('bootstrap offline');
  if (failure === 'verification') server.verifyFails = true;
  if (failure === 'start') server.startError = Error('sync offline');
  if (failure === 'commit') failures.commit = true;
  await assert.rejects(value.command(passwordSet), error => error instanceof languageGlobals.MessageError && error.text.key === (failure === 'commit' ? 'extension.runtime.storageSaveFailed' : 'extension.runtime.cryptoIdentityUnavailable'));
  assertRolledBack(f);
  assert.equal(value.api.token, 'previous-token');
  assert.equal(clients[0].stopped, 1); assert.equal(await readKey(clients[0]), null);
  const pending = value.auth.pendingDevice; const storageKey = [...pending.storageKey];
  assert.equal(stored.get('pending-device').token, pending.token);
  await value.auth.maintainConnection(); await assert.rejects(value.command({ name: 'reconnect' }), error => error.text.key === 'extension.runtime.signInFirst');
  value.networkChanged(false); value.networkChanged(true);
  assert.equal(clients.length, 1);
  server.bootstrapError = undefined; server.verifyFails = false; server.startError = undefined; failures.commit = false;
  await value.command(passwordSet);
  assert.equal(requests.filter(request => request.path === 'devices.create' && ['accounts.create', 'devices.create'].includes(request.path)).length, 1);
  assert.equal(value.auth.session, pending); assert.deepEqual([...value.auth.session.storageKey], storageKey);
  assert.equal(stored.get('device').crypto, 'ready'); assert.equal(value.state.setup, undefined);
  assert.equal(value.state.authenticated, true); assert.equal(value.api.token, pending.token);
  assert.equal(value.auth.pendingDevice, undefined); assert.equal(await readKey(clients[1]), null);
});

test('registration ApiError remains readable and leaves the password step retryable', async () => {
  const { value, stored } = fixture(); await value.command(accountLogin);
  const error = new ApiError(503, { error: 'SERVICE_UNAVAILABLE' });
  value.api.request = async () => { throw error; };
  await assert.rejects(value.command(passwordSet), candidate => candidate === error);
  assert.equal(value.state.setup, 'password'); assert.equal(value.state.authenticated, false);
  assert.equal(value.auth.pendingDevice, undefined); assert.ok(value.auth.pendingIdentity);
  assert.equal(stored.size, 0);
});

test('a snapshot authentication failure preserves the pending sign-in for retry', async () => {
  const f = fixture(); const { value } = f;
  await value.command(accountLogin);
  delete value.auth.fetchSnapshot;
  const request = value.api.request;
  const error = new ApiError(401, { error: 'AUTH_REQUIRED' });
  value.api.request = (path, options) => { if (path === 'accounts.snapshot') throw error; return request(path, options); };
  await assert.rejects(value.command(passwordSet), candidate => candidate === error);
  assertRolledBack(f);
  assert.equal(f.requests.filter(request => request.path === 'accounts.logout').length, 0);
});

test('a sync token failure during sign-in preserves the password step and pending identity', async () => {
  const f = fixture(); await f.value.command(accountLogin);
  f.server.syncError = { errcode: 'M_UNKNOWN_TOKEN' };
  await assert.rejects(f.value.command(passwordSet), error => error instanceof languageGlobals.MessageError);
  assertRolledBack(f);
  assert.equal(f.requests.filter(request => request.path === 'accounts.logout').length, 0);
});

test('account creation falling back to an existing account reuses the registered device on retry', async () => {
  const f = fixture(); const { value, server, requests } = f;
  await value.command({ name: 'account-generate' }); await value.command({ name: 'account-create' });
  const request = value.api.request; let accounts = 0;
  value.api.request = (path, options) => {
    if (path === 'accounts.create') { accounts++; throw new ApiError(409, { error: 'ACCOUNT_EXISTS' }); }
    return request(path, options);
  };
  server.bootstrapError = Error('offline'); await assert.rejects(value.command(passwordSet));
  assert.equal(value.auth.authMode, 'create'); assert.equal(value.state.setup, 'password');
  server.bootstrapError = undefined; await value.command(passwordSet);
  assert.equal(accounts, 1);
  assert.equal(requests.filter(request => request.path === 'devices.create' && ['accounts.create', 'devices.create'].includes(request.path)).length, 1);
  assert.equal(f.stored.get('device').crypto, 'ready');
});

test('startup clears an incomplete device even when server keys are signed', async () => {
  const f = fixture({ hasKeys: true, verified: true }); await startup(f);
  assert.equal(f.stored.has('device'), false); assert.equal(f.value.auth.session, undefined);
  assert.equal(f.clients[0].started, 0); assert.equal(f.server.bootstraps, 0);
  assert.equal(f.value.state.error.key, 'extension.runtime.loginIncomplete'); assert.equal(f.value.state.authenticated, false);
  assert.equal(f.clients[0].options.cryptoCallbacks, undefined);
  assert.equal(f.stored.has('vault'), false); assert.equal(f.server.keyChecks, 0);
  assert.equal(f.requests.find(request => request.path === 'accounts.logout').token, f.session.token);
  assert.equal(f.cleared.length, 1); assert.equal(f.cleared[0].cryptoDatabasePrefix, `palside-local-crypto-${ownIdentity.publicKey}`);
});

for (const hasKeys of [false, true]) test(`startup signs out an unverified interrupted sign-in (server keys: ${hasKeys}) without reconnecting`, async () => {
  const f = fixture({ hasKeys }); f.server.logoutError = Error('offline'); await startup(f);
  const { value, stored, clients, requests, cleared, server } = f;
  assert.equal(value.state.error.key, 'extension.runtime.loginIncomplete');
  assert.equal(value.state.authenticated, false); assert.equal(value.auth.session, undefined); assert.equal(value.api.token, undefined);
  assert.equal(value.auth.cryptoInitialised, false); assert.equal(value.auth.client, undefined);
  assert.equal(stored.has('device'), false); assert.equal(stored.has('vault'), false);
  assert.equal(clients[0].started, 0); assert.equal(clients[0].stopped, 1); assert.equal(server.bootstraps, 0);
  assert.equal(cleared.length, 1); assert.equal(cleared[0].cryptoDatabasePrefix, `palside-local-crypto-${ownIdentity.publicKey}`);
  assert.equal(requests.find(request => request.path === 'accounts.logout').token, f.session.token);
  const count = clients.length;
  for (let i = 0; i < 3; i++) { await value.auth.maintainConnection(); await assert.rejects(value.command({ name: 'reconnect' }), error => error.text.key === 'extension.runtime.signInFirst'); }
  value.networkChanged(false); value.networkChanged(true); await value.auth.maintainConnection();
  assert.equal(clients.length, count); assert.equal(clients[0].retries, 0);
  assert.equal(value.state.error.key, 'extension.runtime.loginIncomplete');
});

test('a durable ready device resumes without another bootstrap or key check', async () => {
  const f = fixture({ ready: true }); await startup(f);
  assert.equal(f.clients[0].started, 1); assert.equal(f.server.bootstraps, 0); assert.equal(f.server.keyChecks, 0);
});

test('startup restores annotation tombstones before stale original and edit cache rows', async () => {
  const f = fixture({ ready: true }); const now = Date.now();
  const original = { id: '$deleted', teamId: 'team', author: f.session.account.id, asset: 'Ethereum:0x1111111111111111111111111111111111111111', text: 'old', timestamp: now, expiresAt: now + 86_400_000 };
  const seen = [];
  f.value.storage.rows = async (_account, kind) => {
    seen.push(kind);
    if (kind === 'annotation-deletion') return [{ value: { id: original.id, teamId: 'team', status: 'committed', expiresAt: original.expiresAt } }];
    if (kind === 'cache') return [original, { ...original, id: '$edit', edits: original.id, baseRevision: original.id, text: 'late' }].map(item => ({ key: `${f.session.account.id}:cache:item:${item.id}`, value: { kind: 'stickies', item } }));
    return [];
  };
  await startup(f);
  assert.ok(seen.indexOf('annotation-deletion') < seen.indexOf('cache'));
  assert.equal(f.value.interactions.stickyRecords.length, 0);
  assert.equal(f.value.state.items.stickies.length, 0);
  assert.equal(f.value.timeline.redactions.has(original.id), true);
});

test('startup revokes a failed pending sign-in and removes its crypto store', async () => {
  const first = fixture(); first.server.bootstrapError = Error('offline');
  await first.value.command(accountLogin); await assert.rejects(first.value.command(passwordSet));
  const f = fixture({ stored: first.stored }); await f.value.auth.start();
  assert.equal(f.value.state.error.key, 'extension.runtime.loginIncomplete');
  assert.equal(f.value.state.authenticated, false); assert.equal(f.stored.has('pending-device'), false);
  assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
  assert.equal(f.requests.filter(request => request.path === 'accounts.logout').length, 1); assert.equal(f.cleared.length, 1);
});

test('startup preserves a committed sign-in if pending marker removal was interrupted', async () => {
  const first = fixture(); first.failures.pendingRemoval = true;
  await first.value.command(accountLogin); await first.value.command(passwordSet);
  assert.ok(first.stored.has('pending-device')); assert.equal(first.stored.get('device').crypto, 'ready');
  const f = fixture({ stored: first.stored }); await f.value.auth.start();
  assert.equal(f.value.state.authenticated, true); assert.equal(f.stored.has('pending-device'), false);
  assert.equal(f.requests.filter(request => request.path === 'accounts.logout').length, 0);
});

for (const name of ['account-discard', 'account-generate', 'account-create', 'account-login']) test(`${name} revokes and clears a registered pending device even when logout fails`, async () => {
  const f = fixture(); const { value, server, requests, stored } = f;
  await value.command(accountLogin); server.bootstrapError = Error('offline');
  await assert.rejects(value.command(passwordSet));
  server.logoutError = Error('offline'); value.api.token = 'previous-token';
  await value.command({ name, payload: name === 'account-login' ? { words: mnemonic.split(' ') } : {} });
  assert.equal(value.auth.pendingDevice, undefined); assert.equal(stored.has('pending-device'), false);
  assert.equal(value.api.token, name === 'account-discard' ? undefined : 'previous-token');
  if (name === 'account-discard') {
    assert.equal(value.state.setup, undefined); assert.equal(value.state.authenticated, false);
    assert.equal(value.auth.mnemonic, undefined); assert.equal(value.auth.pendingIdentity, undefined);
    assert.equal(value.auth.authenticationScope().signal.aborted, true);
  }
  assert.equal(requests.find(request => request.path === 'accounts.logout').token, f.session.token);
  assert.equal(f.cleared.length, 1);
});

test('sign-out is signed out even when the crypto store cannot be cleared, and can run again', async () => {
  const f = fixture({ ready: true, hasKeys: true, verified: true });
  await startup(f);
  assert.equal(f.value.state.authenticated, true);
  f.clients.at(-1).clearStores = async () => { throw Error('blocked'); };
  assert.equal((await f.value.command({ name: 'logout' })).remote, true);
  assert.equal(f.value.state.authenticated, false); assert.equal(f.value.auth.session, undefined);
  assert.equal(f.stored.has('device'), false); assert.equal(f.stored.has('vault'), false);
  const calls = f.requests.length;
  assert.equal((await f.value.command({ name: 'logout' })).remote, true);
  assert.equal(f.requests.length, calls);
});

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function activeFixture() {
  const f = fixture({ ready: true });
  f.value.auth.session = f.session; f.value.api.token = f.session.token;
  f.value.state.authenticated = true; f.value.state.account = f.session.account; f.value.state.data.self = f.session.account.id;
  f.value.state.connection = { service: 'ready', messaging: 'ready', networkOnline: true, retrying: false };
  f.value.auth.client = { stopClient() {}, clearStores: async () => {} };
  return f;
}

test('session guard reads the live identity instead of a captured value', () => {
  const expected = {}; let current = expected;
  const guard = sessionGuard(() => current, expected, () => Error('changed'));
  guard(); current = undefined; assert.throws(guard, /changed/);
});

test('a connection delayed in storage cannot restore an account after sign-out', async () => {
  const f = fixture({ ready: true }); const blocked = deferred();
  const get = f.value.storage.get;
  f.value.storage.get = key => key.endsWith(':preferences') ? blocked.promise : get(key);
  const connecting = f.value.auth.connect(f.session);
  const rejected = assert.rejects(connecting, error => error.text.key === 'extension.runtime.loginChanged');
  await drain(); assert.equal(f.value.auth.session, f.session);
  await f.value.auth.clearDevice();
  blocked.resolve({ current: 'old-team' }); await rejected;
  assert.equal(f.value.state.authenticated, false); assert.equal(f.value.auth.session, undefined);
  assert.equal(f.value.state.preferences.current, '');
  assert.equal(f.clients.filter(client => client.started).length, 0);
});

test('draft and history completions after logout do not repopulate anonymous state', async () => {
  const f = activeFixture(); const draft = deferred(); const history = deferred();
  f.value.storage.updateDraft = () => draft.promise;
  f.value.state.remoteTeams = [{ id: 'team', roomId: '!room' }];
  f.value.auth.client.getRoom = () => ({ oldState: {} });
  f.value.auth.client.scrollback = () => history.promise;
  const writing = assert.rejects(f.value.command({ name: 'draft', payload: { accountId: f.session.account.id, teamId: 'team', revision: 0, patch: { text: 'old' } } }), error => error.text.key === 'extension.runtime.loginChanged');
  const loading = assert.rejects(f.value.command({ name: 'history', payload: { teamId: 'team' } }), error => error.text.key === 'extension.runtime.loginChanged');
  await drain(); assert.equal(f.value.state.history.team.loading, true);
  await f.value.auth.clearDevice();
  draft.resolve({ value: { text: 'old' }, revision: 1 }); history.resolve();
  await Promise.all([writing, loading]);
  assert.deepEqual(Object.keys(f.value.state.drafts), []); assert.equal(f.value.state.history, undefined);
});

test('permanently hung storage deletion emits anonymous state immediately and releases auth queue at deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = activeFixture(); let deletes = 0;
  f.value.storage.remove = () => { deletes++; return new Promise(() => {}); };
  f.value.api.request = () => new Promise(() => {});
  const logout = f.value.command({ name: 'logout' });
  await drain();
  assert.equal(f.value.state.authenticated, false); assert.equal(f.snapshots.at(-1).authenticated, false);
  assert.equal(f.value.auth.session, undefined); assert.equal(deletes, 4);
  t.mock.timers.tick(3000); await drain();
  assert.equal((await logout).remote, false);
  const reopen = assert.rejects(f.value.auth.connect(f.session), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  await drain(); t.mock.timers.tick(3000); await reopen;
  assert.equal(f.clients.length, 0); assert.equal(deletes, 4);
  const next = assert.rejects(f.value.command({ name: 'account-generate' }), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  await drain(); t.mock.timers.tick(3000); await next;
});

test('late crypto deletion blocks reopening until it completes and is not duplicated', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = activeFixture(); const deleting = deferred(); let calls = 0;
  f.value.auth.client.clearStores = () => { calls++; return deleting.promise; };
  const logout = f.value.command({ name: 'logout' }); await drain();
  t.mock.timers.tick(3000); await logout; assert.equal(calls, 1);
  const blocked = assert.rejects(f.value.auth.connect(f.session), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  await drain(); t.mock.timers.tick(3000); await blocked;
  assert.equal(calls, 1); assert.equal(f.clients.length, 0);
  deleting.resolve(); await drain();
  await f.value.auth.connect(f.session); assert.equal(f.value.state.authenticated, true);
});

test('ordinary logout preserves isolated preferences and re-login restores them unchanged', async () => {
  const f = activeFixture(); const account = f.session.account.id;
  const preferences = { web: { share: true, interact: false }, current: 'team', notifications: 'mentions', notificationPreview: false, hiddenStickies: ['sticky'], startedTeams: ['team'] };
  f.stored.set(`${account}:preferences`, preferences); f.stored.set(`${account}:draft:team`, { value: { text: 'secret' } });
  await f.value.command({ name: 'logout' });
  assert.deepEqual(f.stored.get(`${account}:preferences`), preferences);
  assert.equal(f.stored.has(`${account}:draft:team`), false);
  await f.value.auth.connect(f.session);
  assert.deepEqual(JSON.parse(JSON.stringify(f.value.state.preferences)), preferences);
});

function sendingFixture() {
  const f = activeFixture(); const sent = [];
  const team = { id: 'team', roomId: '!room', joined: true, periods: [{ joinedAt: 0, leftAt: null }], retentionDays: 7, memberIds: [f.session.account.id], people: [{ id: f.session.account.id, matrixId: '@own:test' }] };
  f.value.state.remoteTeams = [team]; f.value.state.data.teams = [{ ...team }];
  installEncryptedRoom(f.value.auth.client);
  f.value.auth.client.sendEvent = async (_room, _type, content) => { sent.push(structuredClone(content)); return { event_id: '$confirmed' }; };
  f.value.auth.client.fetchRoomEvent = async () => { throw Error('offline'); };
  const message = { id: 'message', author: f.session.account.id, teamId: 'team', text: 'original', time: '', status: 'sending' };
  const key = `${f.session.account.id}:draft:team`;
  const draft = { value: { text: message.text }, revision: 4, updatedAt: Date.now() };
  f.stored.set(key, structuredClone(draft)); f.value.state.drafts.team = structuredClone(draft);
  return { ...f, sent, message, key };
}

test('durable queued send releases only its draft revision before waiting for quota', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const f = sendingFixture(); const persisted = deferred(); const put = f.value.storage.put;
  f.value.sending.pacer.reserve = () => Date.now() + 2000;
  f.value.storage.put = async (...args) => { await persisted.promise; return put(...args); };
  const sending = f.value.command({ name: 'send', payload: { message: f.message, revision: 4 } });
  await drain(); assert.equal(f.value.state.drafts.team.value.text, 'original');
  persisted.resolve(); await drain();
  assert.equal(f.stored.get(`${f.session.account.id}:outgoing:message`).message.text, 'original');
  assert.equal(f.value.state.drafts.team.value.text, ''); assert.equal(f.sent.length, 0);
  assert.equal(f.value.state.sendQueue.team.count, 1);
  // The panel shows the queued message itself, so the queue names it and its slot.
  assert.deepEqual(f.value.state.sendQueue.team.items, [{ id: f.message.id, at: Date.now() + 2000 }]);
  await f.value.command({ name: 'draft', payload: { teamId: 'team', accountId: f.session.account.id, revision: 5, patch: { text: 'next draft' } } });
  t.mock.timers.tick(2000); await sending;
  assert.equal(f.sent[0].body, 'original'); assert.equal(f.value.state.drafts.team.value.text, 'next draft');
});

for (const change of ['membership', 'room', 'identity']) test(`queued chat rechecks ${change} immediately before SDK send`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const f = sendingFixture();
  f.value.sending.pacer.reserve = () => Date.now() + 2000;
  const sending = assert.rejects(f.value.command({ name: 'send', payload: { message: f.message, revision: 4 } }));
  await drain();
  assert.equal(f.value.state.sendQueue.team.count, 1);
  if (change === 'membership') f.value.state.remoteTeams[0].memberIds = [];
  if (change === 'room') f.value.state.remoteTeams[0].roomId = '!replacement';
  if (change === 'identity') {
    const api = f.value.auth.client.getCrypto();
    api.getUserVerificationStatus = async () => ({ needsUserApproval: true });
    f.value.auth.client.getCrypto = () => api;
  }
  t.mock.timers.tick(2000);
  await sending;
  assert.equal(f.sent.length, 0);
});

const webpageRef = () => ({ target: { kind: 'quote', exact: 'quoted text', prefix: '', suffix: '' }, caption: 'quoted text', view: { version: 1, id: 'web', kind: 'website', disclosure: 'page', name: 'Article', url: 'https://example.com/article', source: 'example.com', color: '', glyph: '' } });

test('reference-only HTTP(S) webpage messages keep their reference in storage and encrypted content', async () => {
  const f = sendingFixture(); const ref = webpageRef(); f.message = { ...f.message, text: '', ref };
  await f.value.command({ name: 'send', payload: { message: f.message, revision: 4 } });
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].body, '');
  assert.equal(f.sent[0]['com.palside.ref'].view.url, ref.view.url);
  assert.equal(f.value.state.data.messages[0].ref.caption, ref.caption);
  assert.equal(f.stored.get(`${f.session.account.id}:cache:$confirmed`).message.ref.view.url, ref.view.url);
});

for (const invalid of ['url', 'caption', 'target']) test(`invalid reference ${invalid} fails before persistence and preserves draft`, async () => {
  const f = sendingFixture(); const ref = webpageRef();
  if (invalid === 'url') ref.view.url = 'file:///private';
  if (invalid === 'caption') ref.caption = '';
  if (invalid === 'target') ref.target = { kind: 'invalid' };
  await assert.rejects(f.value.command({ name: 'send', payload: { message: { ...f.message, text: '', ref }, revision: 4 } }), error => error.text.key === 'extension.runtime.tokenIdentityUnknown');
  assert.equal(f.sent.length, 0); assert.equal(f.value.state.drafts.team.value.text, 'original');
  assert.equal(f.value.sending.outgoing.size, 0); assert.equal(f.value.state.data.messages.length, 0);
});

test('pokes from the same sender and URL merge only within the same team', () => {
  const now = Date.now(); const first = { id: 'one', teamId: 'a', from: 'friend', view: { url: 'https://example.com' }, at: now, count: 1 };
  const pokes = mergePoke([first], { ...first, id: 'two', teamId: 'b' }, now);
  assert.equal(pokes.length, 2); assert.equal(pokes[0].count, 1);
  const repeated = mergePoke(pokes, { ...first, id: 'three' }, now);
  assert.equal(repeated.length, 2); assert.equal(repeated[0].count, 2); assert.equal(repeated[1].count, 1);
});

test('logout state revision keeps increasing so the offscreen patch queue can deliver it', async () => {
  const f = activeFixture(); delete f.value.emit;
  f.value.state.revision = 42; const revisions = [];
  f.value.subscribe(state => revisions.push({ revision: state.revision, authenticated: state.authenticated }));
  await f.value.command({ name: 'logout' });
  assert.ok(revisions.every(state => state.revision > 42 && !state.authenticated));
});

test('a snapshot started before SSE disconnection cannot restore stale presence', async () => {
  const f = activeFixture(); const response = deferred();
  f.value.auth.sseOpen = true;
  f.value.state.data.people = [{ id: f.session.account.id, name: 'Own', presence: 'active' }];
  f.value.api.request = () => response.promise;
  const loading = f.value.auth.fetchSnapshot();
  f.value.auth.sseOpen = false; f.value.auth.presenceVersion++;
  f.value.state.data.people = f.value.state.data.people.map(person => ({ ...person, presence: undefined }));
  response.resolve({ account: f.session.account, teams: [], presence: { [f.session.account.id]: 'active' } });
  await loading;
  assert.equal(f.value.state.data.people[0].presence, undefined);
});

function incomingEvent(id, content, timestamp = Date.now()) {
  return {
    getRoomId: () => '!room', getId: () => id, getTs: () => timestamp, getSender: () => '@friend:test',
    getType: () => 'm.room.message', getContent: () => content, getUnsigned: () => ({}),
    isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false, isRedaction: () => false, isRedacted: () => false,
  };
}
function receivingFixture() {
  const f = sendingFixture(); const team = f.value.state.remoteTeams[0];
  team.memberIds.push('friend'); team.people.push({ id: 'friend', matrixId: '@friend:test' });
  team.preferences = { readIds: [], muted: false };
  f.value.state.preferences.notifications = 'all'; f.value.timeline.readyForLiveEvents = true;
  f.value.auth.receiveSince = Date.now() - 1000;
  return f;
}

test('history and replay with recent timestamps never notify; genuine arrival notifies once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = receivingFixture(); const notifications = [];
  f.value.notify = async payload => notifications.push(payload);
  const history = incomingEvent('$history', { body: 'historical', msgtype: 'm.text' });
  await f.value.timeline.consume(history, false);
  await f.value.timeline.consume(history, true);
  t.mock.timers.tick(900); await drain(); assert.equal(notifications.length, 0);
  const live = incomingEvent('$live', { body: 'new', msgtype: 'm.text' });
  await f.value.timeline.consume(live, true); await f.value.timeline.consume(live, true);
  t.mock.timers.tick(900); await drain();
  assert.equal(notifications.length, 1); assert.equal(notifications[0].messageId, '$live');
});

test('an asset present only in a received reference is registered and cached for details', async () => {
  const f = receivingFixture();
  const view = { version: 1, kind: 'asset', name: 'Token', chain: 'Ethereum', address: '0x1111111111111111111111111111111111111111', url: 'https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111' };
  const ref = { ...webpageRef(), view };
  await f.value.timeline.consume(incomingEvent('$reference', { body: '', msgtype: 'm.text', 'com.palside.ref': ref }), false);
  const message = f.value.state.data.messages[0];
  assert.equal(message.ref.view.kind, 'asset');
  assert.equal(f.value.state.data.views.find(item => item.id === message.ref.view.id).address, view.address);
  const cached = f.stored.get(`${f.session.account.id}:cache:$reference`);
  assert.equal(cached.views[0].address, view.address); assert.equal(cached.message.liveArrival, undefined);
});

test('reconnecting the same session object invalidates earlier asynchronous draft writes', async () => {
  const f = activeFixture(); const delayed = deferred();
  f.value.storage.updateDraft = () => delayed.promise;
  const writing = assert.rejects(f.value.command({ name: 'draft', payload: { accountId: f.session.account.id, teamId: 'team', revision: 0, patch: { text: 'old generation' } } }), error => error.text.key === 'extension.runtime.loginChanged');
  await drain(); await f.value.auth.connect(f.session);
  assert.equal(f.value.auth.session, f.session);
  delayed.resolve({ value: { text: 'old generation' }, revision: 1 }); await writing;
  assert.deepEqual(Object.keys(f.value.state.drafts), []);
});

test('logout waits for an old crypto opener before deletion without blocking anonymous state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ ready: true }); const opening = deferred(); f.server.initialising = opening;
  const connecting = assert.rejects(f.value.auth.connect(f.session), error => error.text.key === 'extension.runtime.loginChanged');
  await drain(); assert.equal(f.clients.length, 1);
  const logout = f.value.command({ name: 'logout' }); await drain();
  assert.equal(f.value.state.authenticated, false); assert.equal(f.cleared.length, 0);
  t.mock.timers.tick(3000); await logout;
  assert.equal(f.cleared.length, 0);
  opening.resolve(); await connecting; await drain();
  assert.equal(f.cleared.length, 1); assert.ok(f.clients[0].stopped >= 2);
  f.server.initialising = undefined;
  await f.value.auth.connect(f.session); assert.equal(f.value.state.authenticated, true);
});

test('serial command queue releases mnemonic results while callers receive them', async () => {
  const { value } = fixture();
  const secret = { words: ['SYNTHETIC_SECRET_MARKER'] };
  value.dispatch.execute = async command => command.name === 'mnemonic-reveal' ? secret : 'snapshot';
  assert.equal(await value.command({ name: 'mnemonic-reveal', payload: { password: pin } }), secret);
  assert.equal(await value.command({ name: 'snapshot' }), 'snapshot');
  assert.equal(await value.auth.authQueue, undefined);
});

test('serial command barrier preserves order, reports failure and lets the next command run', async () => {
  const { value } = fixture(), calls = [], errors = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const failure = Object.assign(new Error('synthetic failure'), { code: 'COMMAND_FAILED' });
  value.diagnosticErrors.record = error => errors.push(error);
  value.dispatch.execute = async command => {
    calls.push(command.name);
    if (command.name === 'mnemonic-reveal') { await gate; throw failure; }
    return 'next result';
  };
  const first = value.command({ name: 'mnemonic-reveal', payload: { password: pin } });
  const rejected = assert.rejects(first, error => error === failure);
  const next = value.command(passwordSet);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['mnemonic-reveal']);
  release();
  await rejected;
  assert.equal(await next, 'next result');
  assert.deepEqual(calls, ['mnemonic-reveal', 'password-set']);
  assert.deepEqual(errors, [failure]);
  assert.equal(await value.auth.authQueue, undefined);
});


test('to-device dispatch allows plaintext viewing control and requires encryption for private events', async () => {
  const { MatrixEvent } = await import('matrix-js-sdk');
  const f = fixture({ ready: true }); await startup(f);
  const calls = [];
  f.value.sharing.consumeViewing = async () => { calls.push('viewing'); };
  f.value.sharing.expireViewing = () => {};
  f.value.signals.consume = () => { calls.push('signal'); };
  f.value.interactions.consumeReaction = () => { calls.push('reaction'); };
  f.value.interactions.consumePoke = async () => { calls.push('poke'); };
  const client = f.clients[0];
  const states = [{ accountId: 'peer', teamId: 'team', order: 1, sequence: 1, expiresAt: Date.now() + 30_000 }];
  const control = new MatrixEvent({ type: 'com.palside.viewing.active', sender: f.session.matrix.userId, content: { states } });
  client.emit('toDevice', control);
  assert.deepEqual(f.value.sharing.activeViewing.get('peer'), states[0]);
  for (const type of ['com.palside.viewing', 'com.palside.signal', 'com.palside.reaction', social.POKE_EVENT]) {
    const clear = { type, sender: '@peer:test', content: { teamId: 'team' } };
    client.emit('toDevice', new MatrixEvent(clear));
    assert.equal(calls.length, 0);
  }
  for (const type of ['com.palside.viewing', 'com.palside.signal', 'com.palside.reaction', social.POKE_EVENT]) {
    const clear = { type, sender: '@peer:test', content: { teamId: 'team' } };
    const event = new MatrixEvent({ type: 'm.room.encrypted', sender: clear.sender, content: {} });
    await event.attemptDecryption({ decryptEvent: async () => ({ clearEvent: clear }) });
    client.emit('toDevice', event);
  }
  assert.deepEqual(calls, ['viewing', 'signal', 'reaction', 'poke']);
  client.emit('toDevice', new MatrixEvent({ type: 'com.palside.viewing.active', sender: '@other:test', content: { states: [] } }));
  assert.deepEqual(f.value.sharing.activeViewing.get('peer'), states[0]);
});

test('initialise retries a failed start and shares one successful startup', async () => {
  const f = fixture(); let attempts = 0;
  f.value.auth.start = async () => { if (++attempts === 1) throw Error('storage unavailable'); };
  await assert.rejects(f.value.auth.initialise(), /storage unavailable/);
  await Promise.all([f.value.auth.initialise(), f.value.auth.initialise()]);
  await f.value.auth.initialise();
  assert.equal(attempts, 2);
});

for (const preservePreferences of [true, false]) for (const step of ['device', 'vault', 'pending-device', 'pending-invite', 'account', 'crypto', 'device-cleanup']) {
  test(`cleanup resumes after ${step} failure across service reconstruction (preferences ${preservePreferences})`, async () => {
    const f = activeFixture(), account = f.session.account.id;
    f.stored.set('device', structuredClone(f.session)); f.stored.set('vault', { secret: 'vault' });
    f.stored.set(`${account}:preferences`, { current: 'team' }); f.stored.set(`${account}:draft:team`, { text: 'private' });
    const remove = f.value.storage.remove, clear = f.value.storage.clearAccount;
    f.value.storage.remove = async key => { if (key === step) throw Error('blocked'); return remove(key); };
    f.value.storage.clearAccount = async (...args) => { if (step === 'account') throw Error('blocked'); return clear(...args); };
    f.value.auth.client.clearStores = async () => { if (step === 'crypto') throw Error('blocked'); };
    await f.value.auth.clearDevice(preservePreferences);
    assert.equal(f.value.state.authenticated, false);
    const intent = f.stored.get('device-cleanup'); assert.ok(intent, 'unfinished cleanup remains durable');
    assert.deepEqual(Object.keys(intent).sort(), ['accountId', 'cryptoDatabasePrefix', 'preservePreferences']);
    assert.equal(intent.accountId, account); assert.equal(intent.preservePreferences, preservePreferences);
    const next = fixture({ stored: f.stored });
    await next.value.auth.start();
    assert.equal(next.value.state.authenticated, false); assert.equal(next.clients.filter(client => client.started).length, 0);
    assert.equal(next.stored.has('device-cleanup'), false); assert.equal(next.stored.has('device'), false); assert.equal(next.stored.has('vault'), false);
    assert.equal(next.stored.has(`${account}:draft:team`), false);
    assert.equal(next.stored.has(`${account}:preferences`), preservePreferences);
    assert.equal(next.cleared[0].cryptoDatabasePrefix, `palside-local-crypto-${account}`);
  });
}

test('cleanup persistence failure keeps account locators intact and prevents reopening', async () => {
  const f = activeFixture();
  f.stored.set('device', structuredClone(f.session)); f.stored.set('vault', { secret: 'vault' });
  let deletions = 0; f.value.auth.client.clearStores = async () => { deletions++; };
  const put = f.value.storage.put;
  f.value.storage.put = async () => { throw Error('disk unavailable'); };
  await f.value.auth.clearDevice(true);
  assert.equal(f.value.state.authenticated, false); assert.ok(f.stored.has('device')); assert.ok(f.stored.has('vault')); assert.equal(deletions, 0);
  await assert.rejects(f.value.auth.connect(f.session), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  assert.equal(f.clients.length, 0);
  f.value.storage.put = put; await f.value.auth.finishCleanup();
  assert.equal(f.stored.has('device'), false); assert.equal(deletions, 1);
});

test('reconstructed cleanup stays anonymous through another crypto failure and retries startup once', async () => {
  const first = activeFixture(); first.stored.set('device', structuredClone(first.session));
  first.value.auth.client.clearStores = async () => { throw Error('blocked'); };
  await first.value.auth.clearDevice(true);
  const next = fixture({ stored: first.stored }); let attempts = 0;
  const created = next.clients.push.bind(next.clients);
  next.clients.push = client => { client.clearStores = async () => { if (++attempts < 3) throw Error('deletion failed'); }; return created(client); };
  await assert.rejects(next.value.auth.initialise(), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  assert.equal(next.value.state.authenticated, false); assert.ok(next.stored.has('device-cleanup'));
  await assert.rejects(next.value.auth.connect(next.session), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  assert.equal(next.clients.filter(client => client.started).length, 0);
  await Promise.all([next.value.auth.initialise(), next.value.auth.initialise()]);
  assert.equal(attempts, 3); assert.equal(next.stored.has('device-cleanup'), false);
  assert.equal(next.value.state.authenticated, false);
});

test('a failed local deletion does not duplicate a still-running crypto cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = activeFixture(), deleting = deferred(); let calls = 0;
  f.value.storage.remove = async () => { throw Error('storage unavailable'); };
  f.value.auth.client.clearStores = () => { calls++; return deleting.promise; };
  const logout = f.value.auth.clearDevice(true); await drain(); t.mock.timers.tick(3000); await logout;
  const blocked = assert.rejects(f.value.auth.finishCleanup(), error => error.text.key === 'extension.runtime.deviceCleanupPending');
  await drain(); t.mock.timers.tick(3000); await blocked; assert.equal(calls, 1);
  deleting.resolve(); await drain(); assert.ok(f.stored.has('device-cleanup'));
});

test('successful startup owns one crypto client and one maintenance interval across concurrent retries', async () => {
  const f = fixture({ ready: true });
  f.stored.set('device', structuredClone(f.session)); f.stored.set('vault', await identity.sealMnemonic(mnemonic, pin));
  let reads = 0; const cleanup = f.value.storage.cleanup;
  f.value.storage.cleanup = async () => { if (++reads === 1) throw Error('storage unavailable'); return cleanup(); };
  await assert.rejects(f.value.auth.initialise());
  await Promise.all([f.value.auth.initialise(), f.value.auth.initialise()]); await f.value.auth.initialise();
  assert.equal(f.clients.filter(client => client.started).length, 1); assert.equal(f.intervals.length, 1);
});
