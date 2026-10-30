import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../apps/extension/src/runtime/transport/api.ts';
import { deviceLabel } from '../apps/extension/src/runtime/account/device-label.ts';
import { deviceKeyPublication, ensureCryptoIdentity, ownDeviceSigned, sendBlock, secretStorageCallbacks } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { deriveIdentity, generateMnemonic } from '../packages/shared/src/identity.ts';

test('device label maps supported platforms', () => {
  assert.equal(deviceLabel({ platform: 'MacIntel' }), 'macOS · Chrome');
  assert.equal(deviceLabel({ platform: 'Win32' }), 'Windows · Chrome');
  assert.equal(deviceLabel({ platform: 'Linux x86_64' }), 'Linux · Chrome');
  assert.equal(deviceLabel({ userAgentData: { platform: 'Chrome OS' }, platform: 'Linux' }), 'ChromeOS · Chrome');
  assert.equal(deviceLabel({ platform: '' }), 'Chrome');
});

test('signed API request retries AUTH_EXPIRED once using Date clock offset and exact body bytes', async t => {
  const identity = deriveIdentity(generateMnemonic());
  const calls = [];
  const serverDate = new Date(Date.now() + 7000);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(init);
    if (calls.length === 1) return new Response(JSON.stringify({ error: 'AUTH_EXPIRED' }), { status: 401, headers: { Date: serverDate.toUTCString() } });
    return new Response(JSON.stringify({ token: 'token', account: { id: identity.publicKey, nickname: '', bio: '', tags: [], avatarId: null, acceptTeamInvites: true, matrixId: '@self:test', revision: 0 }, matrix: { userId: '@self:test', deviceId: 'SELF' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await new Api('https://service.example.test').request('accounts.create', { body: { label: 'Mac · Chrome' }, secretKey: identity.secretKey, difficulty: 0 });
  assert.deepEqual(result, { token: 'token', account: { id: identity.publicKey, nickname: '', bio: '', tags: [], avatarId: null, acceptTeamInvites: true, matrixId: '@self:test', revision: 0 }, matrix: { userId: '@self:test', deviceId: 'SELF' } }); assert.equal(calls.length, 2);
  const first = JSON.parse(Buffer.from(calls[0].headers.Authorization.slice(6), 'base64').toString());
  const second = JSON.parse(Buffer.from(calls[1].headers.Authorization.slice(6), 'base64').toString());
  assert.ok(second.created_at > first.created_at);
  assert.deepEqual(calls[0].body, calls[1].body);
});

for (const kind of ['avatar', 'encrypted', 'report']) {
  for (const nextToken of ['account-b', undefined]) {
    test(`${kind} upload is abandoned when the account ${nextToken ? 'switches' : 'logs out'} during Blob conversion`, async t => {
      const api = new Api('https://service.example.test'); api.token = 'account-a';
      const conversion = Promise.withResolvers();
      const blob = new Blob(['image']);
      t.mock.method(blob, 'arrayBuffer', () => conversion.promise);
      const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'uploaded' }));
      const pending = api.upload(blob, kind, 'team', '$event');
      const rejected = assert.rejects(pending, { message: 'extension.runtime.loginChanged' });
      api.token = nextToken;
      conversion.resolve(new Uint8Array([1, 2, 3]).buffer);
      await rejected;
      assert.equal(fetch.mock.callCount(), 0);
    });
  }

  test(`${kind} upload discards a response completed after an account switch`, async t => {
    const api = new Api('https://service.example.test'); api.token = 'account-a';
    const dispatched = Promise.withResolvers(), response = Promise.withResolvers();
    const fetch = t.mock.method(globalThis, 'fetch', (_url, init) => {
      dispatched.resolve(init); return response.promise;
    });
    const pending = api.upload(new Blob(['image']), kind, 'team', '$event');
    const rejected = assert.rejects(pending, { message: 'extension.runtime.loginChanged' });
    const init = await dispatched.promise;
    assert.equal(init.headers.Authorization, 'Bearer account-a');
    api.token = 'account-b';
    response.resolve(Response.json({ id: 'uploaded' }));
    await rejected;
    assert.equal(fetch.mock.callCount(), 1);
  });

  test(`${kind} upload sends the originating token and bytes while the account is active`, async t => {
    const api = new Api('https://service.example.test'); api.token = 'account-a';
    const bytes = new Uint8Array([1, 2, 3]);
    const request = t.mock.method(api, 'request', async (id, options) => {
      assert.equal(id, 'media.upload');
      assert.equal(options.token, 'account-a');
      assert.deepEqual(options.body, bytes);
      assert.deepEqual(options.query, kind === 'report' ? { kind, teamId: 'team', eventId: '$event' } : { kind, teamId: 'team' });
      assert.equal(options.timeoutMs, 30_000);
      return { id: 'uploaded' };
    });
    assert.equal(await api.upload(new Blob([bytes]), kind, 'team', '$event'), 'uploaded');
    assert.equal(request.mock.callCount(), 1);
  });
}

test('secret storage callback returns null without an in-memory key', async () => {
  const callbacks = secretStorageCallbacks(() => undefined);
  assert.equal(await callbacks.getSecretStorageKey({ keys: { key: {} } }, 'm.cross_signing.master'), null);
});

test('device publication waits for this device keys upload, not one-time keys or another device', async () => {
  const publication = deviceKeyPublication('@self:test', 'NEW');
  const abort = new AbortController();
  let completed = false;
  const pending = publication.wait(abort.signal).then(() => { completed = true; });
  publication.observe(JSON.stringify({ one_time_keys: {} }), new Response('{}'));
  publication.observe(JSON.stringify({ device_keys: { user_id: '@self:test', device_id: 'OTHER' } }), new Response('{}'));
  await Promise.resolve();
  assert.equal(completed, false);
  publication.observe(JSON.stringify({ device_keys: { user_id: '@self:test', device_id: 'NEW' } }), new Response('{}'));
  await pending;
  assert.equal(completed, true);
});

test('device publication releases failed, cancelled and timed out initialization', async () => {
  const failed = deviceKeyPublication('@self:test', 'NEW');
  failed.observe(JSON.stringify({ device_keys: { user_id: '@self:test', device_id: 'NEW' } }), new Response('{}', { status: 503 }));
  await assert.rejects(failed.wait(new AbortController().signal));
  const cancelled = deviceKeyPublication('@self:test', 'NEW'), abort = new AbortController();
  const pending = cancelled.wait(abort.signal); abort.abort();
  await assert.rejects(pending);
  await assert.rejects(deviceKeyPublication('@self:test', 'NEW').wait(new AbortController().signal, 1));
});

test('identity retry republishes locally trusted device signature and still requires server confirmation', async () => {
  let uploads = 0;
  const crypto = {
    userHasCrossSigningKeys: async () => true,
    bootstrapSecretStorage: async () => {},
    getCrossSigningStatus: async () => ({ privateKeysInSecretStorage: true }),
    bootstrapCrossSigning: async () => {},
    getDeviceVerificationStatus: async () => ({ crossSigningVerified: true }),
    crossSignDevice: async () => { uploads++; },
  };
  const client = { getCrypto: () => crypto, getUserId: () => '@self:test', getDeviceId: () => 'NEW', downloadKeysForUsers: async () => ({ self_signing_keys: { '@self:test': { keys: { 'ed25519:signer': 'signer' } } }, device_keys: { '@self:test': { NEW: {} } } }) };
  await ensureCryptoIdentity(client, new Uint8Array(32));
  assert.equal(uploads, 1);
  assert.equal(await ownDeviceSigned(client), false);
  crypto.getCrossSigningStatus = async () => ({ privateKeysInSecretStorage: false });
  await assert.rejects(ensureCryptoIdentity(client, new Uint8Array(32)));
  assert.equal(uploads, 1);
});

function cryptoFake(status = {}, identities = []) { return { getUserVerificationStatus: async id => ({ wasCrossSigningVerified: () => false, isCrossSigningVerified: () => false, ...status[id] }), userHasCrossSigningKeys: async id => identities.includes(id) }; }
function clientFake(targets, statuses = {}, identities = []) { return { getCrypto: () => cryptoFake(statuses, identities), getRoom: () => ({ getEncryptionTargetMembers: async () => targets.map(userId => ({ userId })) }) }; }

test('sendBlock allows clean rooms and members absent from a room', async () => {
  assert.equal(await sendBlock(clientFake(['@a:example']), '!room', ['@a:example', '@b:example']), undefined);
});

test('sendBlock detects changed identities and hidden room members', async () => {
  assert.deepEqual(await sendBlock(clientFake(['@a:example'], { '@a:example': { needsUserApproval: true } }), '!room', ['@a:example']), { code: 'IDENTITY_CHANGED', userId: '@a:example' });
  assert.deepEqual(await sendBlock(clientFake(['@a:example', '@extra:example'], {}, ['@extra:example']), '!room', ['@a:example']), { code: 'HIDDEN_MEMBER' });
});

test('sendBlock fails closed for missing crypto/room and withdrawn verified identity', async () => {
  await assert.rejects(sendBlock({ getCrypto: () => undefined, getRoom: () => undefined }, '!room', []));
  assert.deepEqual(await sendBlock(clientFake(['@a:example'], { '@a:example': { wasCrossSigningVerified: () => true } }), '!room', ['@a:example']), { code: 'IDENTITY_CHANGED', userId: '@a:example' });
});

test('sendBlock ignores extra room users without a cross-signing identity', async () => {
  assert.equal(await sendBlock(clientFake(['@a:example', '@service:example']), '!room', ['@a:example']), undefined);
});
