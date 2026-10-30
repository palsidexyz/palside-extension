import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, hkdfSync } from 'node:crypto';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  ENGLISH_WORDS, HTTP_AUTH_KIND, PIN_LENGTH, isValidPin, authorizationHeader, createHttpAuth, deriveIdentity,
  generateMnemonic, isValidMnemonic, leadingZeroBits, normalizeMnemonic, npubDecode, npubEncode, openMnemonic,
  sealMnemonic, signEvent, shortNpub, verifyEvent, verifyHttpAuth, isValidVault, VAULT_ITERATIONS,
} from '../packages/shared/src/identity.ts';
import { systemEndpoints } from '../packages/shared/src/contracts/routes/system.ts';
import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import { unlockLocalMnemonic } from '../apps/extension/src/runtime/account/local-password.ts';
import { Api } from '../apps/extension/src/runtime/transport/api.ts';
import { createServiceApi } from '../scripts/lib/service-accounts.mjs';

const vector1 = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const vector2 = 'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';

/** Always changes the last hex digit, so the forged value never equals the original. */
const tamper = hex => `${hex.slice(0, -1)}${hex.at(-1) === '0' ? '1' : '0'}`;

test('NIP-06 vectors and npub round trip', () => {
  const one = deriveIdentity(vector1);
  assert.equal(Buffer.from(one.secretKey).toString('hex'), '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a');
  assert.equal(one.publicKey, '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917');
  assert.equal(one.npub, 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu');
  const two = deriveIdentity(vector2);
  assert.equal(Buffer.from(two.secretKey).toString('hex'), 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add');
  assert.equal(two.publicKey, 'd41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573');
  assert.equal(npubDecode(one.npub), one.publicKey);
  assert.equal(npubEncode(one.publicKey), one.npub);
  assert.equal(shortNpub(one.npub), 'npub1zutz…x7nu');
});

test('mnemonic normalization and twelve-word validation', () => {
  assert.equal(ENGLISH_WORDS.length, 2048);
  const generated = generateMnemonic();
  assert.equal(generated.split(' ').length, 12);
  assert.equal(isValidMnemonic(generated), true);
  assert.equal(isValidMnemonic(`${generated.slice(0, -1)}x`), false);
  assert.equal(isValidMnemonic(generated.split(' ').slice(0, 11).join(' ')), false);
  assert.equal(isValidMnemonic(`${generated} extra`), false);
  assert.equal(normalizeMnemonic('  LEADER\n  MONKEY  '), 'leader monkey');
  assert.equal(normalizeMnemonic([' LEADER ', 'MONKEY']), 'leader monkey');
});

test('matrix secret storage HKDF is stable and vector pinned', () => {
  const one = deriveIdentity(vector1); const two = deriveIdentity(vector2);
  const expected = hkdfSync('sha256', mnemonicToSeedSync(vector1, ''), Buffer.alloc(0), 'palside/matrix-secret-storage/v1', 32);
  assert.equal(Buffer.from(one.secretStorageKey).toString('hex'), Buffer.from(expected).toString('hex'));
  assert.equal(one.secretStorageKey.length, 32);
  assert.notDeepEqual(one.secretStorageKey, two.secretStorageKey);
});

test('NIP-01 signing and tamper detection', () => {
  const secret = deriveIdentity(vector1).secretKey;
  const event = signEvent({ created_at: 1700000000, kind: 1, tags: [['p', 'abc']], content: 'hello' }, secret);
  assert.equal(verifyEvent(event), true);
  assert.equal(verifyEvent({ ...event, content: 'tampered' }), false);
  assert.equal(verifyEvent({ ...event, tags: [['p', 'def']] }), false);
  assert.equal(verifyEvent({ ...event, sig: tamper(event.sig) }), false);
});

const key = deriveIdentity(vector1).secretKey;
const body = new TextEncoder().encode('payload');
function authEvent(overrides = {}) { return createHttpAuth({ url: 'https://api.example.test/x', method: 'post', body, secretKey: key, now: 1700000000, ...overrides }); }
function checked(event, overrides = {}) { return verifyHttpAuth({ header: authorizationHeader(event), url: 'https://api.example.test/x', method: 'POST', body, now: 1700000000, ...overrides }); }

test('NIP-98 success and check order failures', async () => {
  const event = await authEvent();
  assert.deepEqual(checked(event), { ok: true, event });
  assert.equal(verifyHttpAuth({ header: undefined, url: '', method: 'GET', now: 1700000000 }).code, 'AUTH_REQUIRED');
  assert.equal(verifyHttpAuth({ header: 'Nostr !!!', url: '', method: 'GET', now: 1700000000 }).code, 'AUTH_INVALID');
  assert.equal(checked({ ...event, kind: 1 }).code, 'AUTH_INVALID');
  assert.equal(checked({ ...event, tags: [['u', 'https://other.test'], ['method', 'POST'], ['payload', event.tags[2][1]]] }).code, 'AUTH_INVALID');
  assert.equal(verifyHttpAuth({ header: authorizationHeader(event), url: event.tags[0][1], method: 'GET', body, now: 1700000000 }).code, 'AUTH_INVALID');
  const noPayload = await createHttpAuth({ url: event.tags[0][1], method: 'POST', secretKey: key, now: 1700000000 });
  assert.equal(checked(noPayload).code, 'AUTH_INVALID');
  assert.equal(verifyHttpAuth({ header: authorizationHeader(noPayload), url: event.tags[0][1], method: 'POST', now: 1700000000 }).ok, true);
  assert.equal(verifyHttpAuth({ header: authorizationHeader(await authEvent({ now: 1699999939 })), url: event.tags[0][1], method: 'POST', body, now: 1700000000 }).code, 'AUTH_EXPIRED');
  assert.equal(verifyHttpAuth({ header: authorizationHeader(await authEvent({ now: 1700000060 })), url: event.tags[0][1], method: 'POST', body, now: 1700000000 }).ok, true);
  assert.equal(checked({ ...event, sig: tamper(event.sig) }).code, 'AUTH_INVALID');
});

test('NIP-13 difficulty and committed target', async () => {
  assert.equal(leadingZeroBits('000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d'), 36);
  assert.equal(leadingZeroBits(`002f${'0'.repeat(60)}`), 10);
  const mined = await createHttpAuth({ url: 'https://api.example.test/x', method: 'GET', secretKey: key, now: 1700000000, difficulty: 8 });
  assert.ok(leadingZeroBits(mined.id) >= 8);
  assert.deepEqual(mined.tags.find(tag => tag[0] === 'nonce')?.[2], '8');
  let lucky;
  for (let i = 0; i < 10000; i++) {
    const candidate = signEvent({ created_at: 1700000000, kind: HTTP_AUTH_KIND, tags: [['u', 'https://api.example.test/x'], ['method', 'GET'], ['nonce', String(i), '7']], content: '' }, key);
    if (leadingZeroBits(candidate.id) >= 8) { lucky = candidate; break; }
  }
  assert.ok(lucky);
  assert.equal(verifyHttpAuth({ header: authorizationHeader(lucky), url: 'https://api.example.test/x', method: 'GET', now: 1700000000, difficulty: 8 }).code, 'POW_REQUIRED');
  assert.equal(verifyHttpAuth({ header: authorizationHeader({ ...mined, tags: mined.tags.map(tag => tag[0] === 'nonce' ? [tag[0], tag[1], '7'] : tag) }), url: 'https://api.example.test/x', method: 'GET', now: 1700000000, difficulty: 8 }).code, 'AUTH_INVALID');
});

test('signup difficulty is bounded at the config and mining boundaries', async () => {
  const schema = systemEndpoints.find(endpoint => endpoint.id === 'system.config').response.schema;
  for (const difficulty of [-1, 0.5, 33, 257, NaN, Infinity, -Infinity, '8', null]) {
    assert.throws(() => decodeContract(schema, { websiteUrl: 'https://example.test', signupDifficulty: difficulty }));
    await assert.rejects(authEvent({ difficulty }), { message: 'INVALID_DIFFICULTY' });
  }
  for (const signupDifficulty of [0, 1, 32]) assert.equal(decodeContract(schema, { websiteUrl: 'https://example.test', signupDifficulty }).signupDifficulty, signupDifficulty);
});

test('mining yields to cancellation and honors an already aborted signal', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', bytes => bytes.fill(0));
  const controller = new AbortController();
  const reason = new Error('cancel mining');
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(authEvent({ difficulty: 32, signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); }
  for (const difficulty of [0, 32]) await assert.rejects(authEvent({ difficulty, signal: controller.signal }), error => error === reason);
});

test('signed HTTP event serialization preserves the request and nonce tags', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', bytes => bytes.fill(0));
  const pubkey = deriveIdentity(vector1).publicKey;
  const tags = [['u', 'https://api.example.test/x'], ['method', 'POST'], ['request', '00'.repeat(16)], ['payload', createHash('sha256').update(body).digest('hex')], ['nonce', '0', '8']];
  let expected;
  for (let counter = 0; ; counter++) {
    tags.at(-1)[1] = String(counter);
    expected = createHash('sha256').update(JSON.stringify([0, pubkey, 1700000000, HTTP_AUTH_KIND, tags, ''])).digest('hex');
    if (leadingZeroBits(expected) >= 8) break;
  }
  const event = await authEvent({ difficulty: 8 });
  assert.equal(event.id, expected);
  assert.deepEqual(event.tags, tags);
  assert.equal(verifyEvent(event), true);
});

test('transport and service signing propagate cancellation without sending', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', bytes => bytes.fill(0));
  const fetcher = t.mock.fn(() => { throw new Error('unexpected network request'); });
  t.mock.method(globalThis, 'fetch', fetcher);
  const api = new Api('https://api.example.test');
  const service = createServiceApi({ base: api.baseUrl, fetcher });
  for (const request of [
    signal => api.request('accounts.create', { body: { label: 'Browser' }, secretKey: key, difficulty: 32, signal }),
    signal => service('/accounts', { method: 'POST', body: { label: 'Browser' }, secretKey: key, difficulty: 32, signal }),
  ]) {
    const controller = new AbortController(), reason = new Error('cancel request');
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await assert.rejects(request(controller.signal), error => error === reason); }
    finally { clearTimeout(timer); }
  }
  await assert.rejects(api.request('accounts.create', { body: { label: 'Browser' }, secretKey: key, difficulty: 32, timeoutMs: 1 }), { name: 'TimeoutError' });
  assert.equal(fetcher.mock.callCount(), 0);
});

test('payload commitments match empty and nonempty request bytes in both directions', async () => {
  const event = await authEvent();
  for (const body of [undefined, new Uint8Array(0)]) {
    assert.equal(checked(event, { body }).code, 'AUTH_INVALID');
    const noPayload = await authEvent({ body });
    assert.equal(noPayload.tags.some(tag => tag[0] === 'payload'), false);
    assert.equal(checked(noPayload, { body }).ok, true);
    assert.equal(checked(noPayload).code, 'AUTH_INVALID');
    const emptyPayload = signEvent({ ...noPayload, tags: [...noPayload.tags, ['payload', createHash('sha256').update('').digest('hex')]] }, key);
    assert.equal(checked(emptyPayload, { body }).ok, true);
    assert.equal(checked(emptyPayload).code, 'AUTH_INVALID');
  }
  for (const payloads of [[['payload']], [['payload', '']], [event.tags.find(tag => tag[0] === 'payload'), ['payload', 'invalid']]]) {
    const invalid = signEvent({ ...event, tags: [...event.tags.filter(tag => tag[0] !== 'payload'), ...payloads] }, key);
    assert.equal(checked(invalid).code, 'AUTH_INVALID');
    assert.equal(checked(invalid, { body: undefined }).code, 'AUTH_INVALID');
  }
});

test('vault is sealed with a six-digit PIN using randomized WebCrypto encryption', async () => {
  assert.equal(PIN_LENGTH, 6);
  assert.equal(isValidPin('042913'), true);
  for (const pin of ['04291', '0429133', '04291a', ' 042913', '０４２９１３']) assert.equal(isValidPin(pin), false);
  await assert.rejects(sealMnemonic(vector1, 'correct horse'), error => error.message === 'PIN_INVALID');
  const one = await sealMnemonic(vector1, '042913');
  const two = await sealMnemonic(vector1, '042913');
  assert.equal(one.v, 2);
  assert.equal(await openMnemonic(one, '042913'), vector1);
  await assert.rejects(openMnemonic(one, '042914'), error => error.message === 'WRONG_PASSWORD');
  await assert.rejects(openMnemonic({ ...one, v: 1 }, '042913'), error => error.message === 'INVALID_VAULT');
  assert.notEqual(one.salt, two.salt);
  assert.notEqual(one.iv, two.iv);
  assert.equal(one.ciphertext.includes('leader'), false);
  const corrupted = Buffer.from(one.ciphertext, 'base64'); corrupted[0] ^= 1;
  const tampered = { ...one, ciphertext: corrupted.toString('base64') };
  assert.equal(isValidVault(tampered), true);
  await assert.rejects(openMnemonic(tampered, '042913'), { message: 'WRONG_PASSWORD' });
});

test('invalid vault structure is rejected before password derivation', async t => {
  const vault = { v: 2, iterations: VAULT_ITERATIONS, salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(32).toString('base64') };
  const importKey = t.mock.method(globalThis.crypto.subtle, 'importKey', () => { throw new Error('unexpected key derivation'); });
  const invalid = [undefined, null, [], {}, { ...vault, v: 1 }];
  for (const iterations of [0, -1, 1, VAULT_ITERATIONS + 1, 2 ** 32 - 1, 1.5, NaN, Infinity, '600000']) invalid.push({ ...vault, iterations });
  for (const field of ['salt', 'iv', 'ciphertext']) {
    for (const value of [undefined, null, 1, '', '!!!!', vault[field] + '\n', '_'.repeat(24)]) invalid.push({ ...vault, [field]: value });
    if (vault[field].endsWith('=')) invalid.push({ ...vault, [field]: vault[field].replace(/=+$/, '') });
  }
  for (const [field, lengths] of [['salt', [15, 17]], ['iv', [11, 13]], ['ciphertext', [15, 257, 100_000]]]) {
    for (const length of lengths) invalid.push({ ...vault, [field]: Buffer.alloc(length).toString('base64') });
  }
  invalid.push({ ...vault, salt: vault.salt.slice(0, -3) + 'B==' });
  assert.equal(isValidVault(vault), true);
  for (const value of invalid) {
    assert.equal(isValidVault(value), false);
    await assert.rejects(openMnemonic(value, '042913'), { message: 'INVALID_VAULT' });
  }
  assert.equal(importKey.mock.callCount(), 0);
});

test('invalid vaults do not consume PIN attempts, while decryption failures lock after five', async () => {
  const vault = await sealMnemonic(vector1, '042913');
  const entries = new Map([['vault', { ...vault, iterations: 1 }], ['self:password-attempts', { failures: 4, lockedUntil: 0 }]]);
  let writes = 0;
  const storage = { async get(key) { return entries.get(key); }, async put(key, _account, _kind, value) { writes++; entries.set(key, value); } };
  const unlock = password => unlockLocalMnemonic({ storage, accountId: 'self', password, check() {}, locks: { request: (_name, callback) => callback() }, now: () => 1000 });
  for (let i = 0; i < 6; i++) await assert.rejects(unlock('042913'), { code: 'LOGIN_INCOMPLETE' });
  assert.equal(writes, 0);
  assert.deepEqual(entries.get('self:password-attempts'), { failures: 4, lockedUntil: 0 });
  entries.set('vault', vault);
  await assert.rejects(unlock('042914'), { code: 'PASSWORD_LOCKED', lockedUntil: 901000 });
  assert.deepEqual(entries.get('self:password-attempts'), { failures: 5, lockedUntil: 901000 });
  await assert.rejects(unlock('042913'), { code: 'PASSWORD_LOCKED' });
});
