import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createClient, EventStatus, MatrixEvent, MatrixScheduler, MemoryStore, Room } from 'matrix-js-sdk';
import { requireEncryptedSend } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { encryptedCrypto, encryptedRoom } from './helpers/encrypted-room.mjs';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'wxt/browser') return { url: 'data:text/javascript,export const browser = {}', shortCircuit: true };
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { TeamInteractions } = await import('../apps/extension/src/runtime/annotations/interactions.ts');
const { SharingRuntime } = await import('../apps/extension/src/runtime/viewing/sharing.ts');
const { SendingRuntime } = await import('../apps/extension/src/runtime/chat/sending.ts');
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
hooks.deregister();
const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
function fixture(client) {
  const calls = [];
  const team = { id: 'team', roomId: '!room:test', joined: true, memberIds: ['self', 'peer'], people: [{ id: 'self', matrixId: '@self:test', nickname: 'Self' }, { id: 'peer', matrixId: '@peer:test', nickname: 'Peer' }], retentionDays: 7 };
  const runtime = {
    state: { authenticated: true, remoteTeams: [team], preferences: { current: 'team', web: { share: true } }, toggles: { share: true }, connection: { service: 'ready', messaging: 'ready', networkOnline: true }, data: { teams: [], people: [{ id: 'peer', presence: 'active' }] }, items: { stickies: [] } },
    auth: { session: { account: { id: 'self' }, matrix: { userId: '@self:test', deviceId: 'SELF' } }, client, requireConnection() {}, scope: () => ({ check() {}, current: () => true, wait: value => value }) },
    api: { async request(path, options) { calls.push({ path, options }); return { selected: true, expiresAt: Date.now() + 30_000, delivered: 1 }; } },
    storage: { cache: async () => [] }, cache: { evictCachedContent() {}, pruneViews() {} }, foreground: async () => true, emit() {},
  };
  runtime.sharing = new SharingRuntime(runtime);
  runtime.sharing.page = { kind: 'asset', url: 'https://example.com/token', id: asset };
  runtime.sharing.ownViewing = { teamId: 'team', view: runtime.sharing.page, expiresAt: Date.now() + 30_000 };
  runtime.sharing.selectedDevice = true;
  runtime.sharing.expireViewing = () => {};
  return { runtime, calls, team, interactions: new TeamInteractions(runtime) };
}

test('real Matrix SDK transport: custom events and chat require an encrypted room before HTTP', async () => {
  const requests = [];
  const client = createClient({ baseUrl: 'https://service.invalid', userId: '@self:test', deviceId: 'SELF', accessToken: 'test', fetchFn: async (url, init) => {
    if (!String(url).includes('/send/')) return new Response(JSON.stringify({ errcode: 'M_NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ event_id: '$event' }), { headers: { 'Content-Type': 'application/json' } });
  } });
  // In-memory Rust crypto is real; no service, credentials or persistent crypto store is used.
  await client.initRustCrypto({ useIndexedDB: false });
  try {
    await client.sendEvent('!room:test', 'com.palside.sticky', { text: 'control plaintext' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, 'control plaintext');
    requests.length = 0;
    const f = fixture(client);
    await assert.rejects(f.interactions.teamEvent('team', 'sticky', { asset, site: 'example.com', text: 'secret' }), error => error.text.key === 'extension.runtime.syncingEncryption');
    await assert.rejects(new SendingRuntime(f.runtime).doSend({ id: 'message', teamId: 'team', author: 'self', text: 'secret' }, 0), error => error.text.key === 'extension.runtime.syncingEncryption');
    assert.equal(requests.length, 0);
    assert.equal(f.calls.length, 0);
  } finally { client.stopClient(); }
});

function editFixture(client) {
  const f = fixture(client), records = new Map();
  f.runtime.initialise = async () => {};
  f.runtime.refresh = async () => {};
  f.runtime.state.data.messages = [{ id: '$original', teamId: 'team', author: 'self', text: 'original' }];
  f.runtime.sending = { editOriginals: new Map() };
  Object.assign(f.runtime.storage, {
    get: async key => records.get(key),
    put: async (key, _account, _kind, value) => { records.set(key, value); },
    remove: async key => { records.delete(key); },
  });
  const commands = new RuntimeCommands(f.runtime);
  return { ...f, records, edit: () => commands.execute({ name: 'edit', payload: { teamId: 'team', id: '$original', text: 'edited secret', baseEditedAt: 0 } }) };
}
function originalEvent() {
  return new MatrixEvent({ event_id: '$original', room_id: '!room:test', sender: '@self:test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'original' } });
}

test('real Matrix SDK: edit in an existing unencrypted Room stops before any HTTP', async () => {
  const requests = [];
  const client = createClient({ store: new MemoryStore(), baseUrl: 'https://service.invalid', userId: '@self:test', deviceId: 'SELF', accessToken: 'test', fetchFn: async (url, init) => {
    requests.push({ url: String(url), body: init.body && JSON.parse(init.body) });
    if (!String(url).includes('/send/')) return new Response(JSON.stringify({ errcode: 'M_NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ event_id: '$event' }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await client.initRustCrypto({ useIndexedDB: false });
  requests.length = 0;
  try {
    const room = new Room('!room:test', client, '@self:test');
    client.store.storeRoom(room);
    room.addLiveEvents([originalEvent()], { addToState: false });
    assert.equal(room.hasEncryptionStateEvent(), false);
    await client.sendEvent(room.roomId, 'm.room.message', { msgtype: 'm.text', body: '* control plaintext', 'm.new_content': { msgtype: 'm.text', body: 'control plaintext' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' } });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/send\/m.room.message\//);
    assert.equal(requests[0].body['m.new_content'].body, 'control plaintext');
    requests.length = 0;
    const f = editFixture(client);
    await assert.rejects(f.edit(), error => error.text.key === 'extension.runtime.syncingEncryption');
    assert.equal(requests.length, 0);
    assert.equal(f.records.size, 0);
    assert.equal(f.runtime.sending.editOriginals.size, 0);
  } finally { client.stopClient(); }
});

for (const stage of ['fetch', 'decrypt', 'storage-get', 'storage-put']) {
  for (const change of ['none', 'membership', 'session', 'client', 'room', 'readonly', 'encryption', 'identity']) test(`edit rechecks ${change} after ${stage}`, async () => {
    let f, changed = false; const sent = [];
    const room = encryptedRoom({ findEventById: () => stage === 'fetch' ? undefined : originalEvent(), hasEncryptionStateEvent: () => !(changed && change === 'encryption') });
    const api = encryptedCrypto({ getUserVerificationStatus: async () => ({ needsUserApproval: changed && change === 'identity', wasCrossSigningVerified: () => false }) });
    const mutate = () => {
      changed = true;
      if (change === 'membership') f.team.memberIds.pop();
      if (change === 'session') f.runtime.auth.session = { ...f.runtime.auth.session };
      if (change === 'client') f.runtime.auth.client = { ...client };
      if (change === 'room') f.team.roomId = '!other:test';
      if (change === 'readonly') f.runtime.state.data.teams.push({ id: 'team', readonly: true });
    };
    const client = { getRoom: () => room, getCrypto: () => api, fetchRoomEvent: async () => { mutate(); return originalEvent().event; }, decryptEventIfNeeded: async () => { if (stage === 'decrypt') mutate(); }, sendEvent: async (...args) => { sent.push(args); return { event_id: '$edit' }; } };
    f = editFixture(client);
    for (const method of ['get', 'put']) {
      const original = f.runtime.storage[method];
      f.runtime.storage[method] = async (...args) => { const result = await original(...args); if (stage === `storage-${method}`) mutate(); return result; };
    }
    if (change === 'none') {
      await f.edit();
      assert.equal(sent.length, 1);
      assert.equal(sent[0][0], '!room:test');
      assert.equal(sent[0][1], 'm.room.message');
      assert.equal(sent[0][2]['m.new_content'].body, 'edited secret');
      assert.deepEqual(sent[0][2]['m.relates_to'], { rel_type: 'm.replace', event_id: '$original' });
      assert.equal(f.records.size, 0);
    } else {
      await assert.rejects(f.edit(), error => Boolean(error.text?.key));
      assert.equal(sent.length, 0);
    }
    assert.equal(f.runtime.sending.editOriginals.size, 0);
  });
}

function sdkEditFixture(t, respond) {
  const requests = [];
  const client = createClient({ scheduler: new MatrixScheduler(() => -1), store: new MemoryStore(), baseUrl: 'https://service.invalid', userId: '@self:test', deviceId: 'SELF', accessToken: 'test', fetchFn: async (url, init) => {
    assert.match(String(url), /\/send\/m.room.encrypted\//);
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return respond(requests.length);
  } });
  const room = new Room('!room:test', client, '@self:test', { pendingEventOrdering: 'detached' });
  client.store.storeRoom(room);
  room.currentState.setStateEvents([new MatrixEvent({ room_id: room.roomId, type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })]);
  room.addLiveEvents([originalEvent()], { addToState: false });
  t.mock.method(client, 'getCrypto', () => encryptedCrypto());
  // Only crypto is substituted; the SDK owns transport, local echoes and transaction registration.
  t.mock.method(client, 'encryptEventIfNeeded', async event => {
    if (!event.isEncrypted()) event.makeEncrypted('m.room.encrypted', { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'edit-ciphertext' }, 'sender-key', 'signing-key');
  });
  return { ...editFixture(client), client, room, requests };
}

test('real Matrix Room: edit response loss retries the same local event after encryption checks', async t => {
  const f = sdkEditFixture(t, count => {
    if (count === 1) throw new Error('response lost');
    return Response.json({ event_id: '$edit' });
  });
  await assert.rejects(f.edit(), /response lost/);
  const txn = [...f.records.values()][0], pending = f.room.getEventForTxnId(txn);
  assert.equal(pending.status, EventStatus.NOT_SENT);
  assert.equal(f.records.size, 1);
  assert.equal(f.runtime.sending.editOriginals.size, 0);
  const encryption = t.mock.method(f.room, 'hasEncryptionStateEvent', () => false);
  await assert.rejects(f.edit(), error => error.text.key === 'extension.runtime.syncingEncryption');
  assert.equal(f.requests.length, 1);
  encryption.mock.restore();
  await f.edit();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[0], f.requests[1]);
  assert.equal(f.room.getEventForTxnId(txn), pending);
  assert.equal(pending.status, EventStatus.SENT);
  assert.equal(f.records.size, 0);
  assert.equal(f.runtime.sending.editOriginals.size, 0);
});

test('real Matrix Room: edit reconciles a sent echo when receipt cleanup fails', async t => {
  const f = sdkEditFixture(t, () => Response.json({ event_id: '$edit' }));
  const remove = t.mock.method(f.runtime.storage, 'remove', async () => { throw new Error('storage unavailable'); });
  await assert.rejects(f.edit(), /storage unavailable/);
  const txn = [...f.records.values()][0];
  assert.equal(f.room.getEventForTxnId(txn).status, EventStatus.SENT);
  remove.mock.restore();
  await f.edit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.records.size, 0);
});

for (const status of [EventStatus.SENDING, EventStatus.ENCRYPTING, EventStatus.QUEUED]) test(`real Matrix Room: edit leaves a ${status} echo pending`, async t => {
  const f = sdkEditFixture(t, () => { throw new Error('response lost'); });
  await assert.rejects(f.edit(), /response lost/);
  const txn = [...f.records.values()][0], pending = f.room.getEventForTxnId(txn);
  f.room.updatePendingEvent(pending, EventStatus.SENDING);
  if (status !== EventStatus.SENDING) f.room.updatePendingEvent(pending, status);
  await assert.rejects(f.edit(), error => error.text?.key === 'common.working');
  assert.equal(f.requests.length, 1);
  assert.equal(f.records.size, 1);
  assert.equal(pending.status, status);
  assert.equal(f.runtime.sending.editOriginals.size, 0);
});

for (const failure of ['no-state', 'disabled', 'changed-identity', 'hidden-member']) test(`room send rejects ${failure}`, async () => {
  const room = encryptedRoom({ hasEncryptionStateEvent: () => failure !== 'no-state', getEncryptionTargetMembers: async () => [{ userId: '@extra:test' }] });
  const cryptoApi = encryptedCrypto({ isEncryptionEnabledInRoom: async () => failure !== 'disabled', userHasCrossSigningKeys: async () => failure === 'hidden-member', getUserVerificationStatus: async () => ({ needsUserApproval: failure === 'changed-identity', wasCrossSigningVerified: () => false }) });
  const client = { getRoom: () => room, getCrypto: () => cryptoApi };
  await assert.rejects(requireEncryptedSend(client, '!room:test', [{ matrixId: '@peer:test', nickname: 'Peer' }], () => {}));
});

for (const change of ['session', 'client', 'membership', 'room', 'readonly']) test(`custom event rejects ${change} change during encryption eligibility`, async () => {
  const room = encryptedRoom(); let f, sends = 0;
  const api = encryptedCrypto({ isEncryptionEnabledInRoom: async () => {
    if (change === 'session') f.runtime.auth.session = { ...f.runtime.auth.session };
    if (change === 'client') f.runtime.auth.client = { ...client };
    if (change === 'membership') f.team.memberIds.pop();
    if (change === 'room') f.team.roomId = '!other';
    if (change === 'readonly') f.runtime.state.data.teams.push({ id: 'team', readonly: true });
    return true;
  } });
  const client = { getCrypto: () => api, getRoom: () => room, sendEvent: async () => { sends++; return { event_id: '$bad' }; } };
  f = fixture(client);
  await assert.rejects(f.interactions.teamEvent('team', 'sticky', { asset, site: 'example.com', text: 'secret' }));
  assert.equal(sends, 0);
});

for (const path of ['viewing', 'reaction', 'poke']) {
  for (const change of ['none', 'identity', 'membership', 'session']) test(`${path} enforces signed devices and ${change} guard`, async () => {
    let f; const encrypted = [];
    const api = encryptedCrypto({
      getUserDeviceInfo: async users => new Map(users.map(user => [user, new Map([['SIGNED', {}], ['UNSIGNED', {}]])])),
      getDeviceVerificationStatus: async (_user, device) => ({ signedByOwner: device === 'SIGNED' }),
      encryptToDeviceMessages: async (_type, targets) => {
        encrypted.push(targets);
        if (change === 'identity') api.getUserVerificationStatus = async () => ({ needsUserApproval: true });
        if (change === 'membership') f.team.memberIds.pop();
        if (change === 'session') f.runtime.auth.session = { ...f.runtime.auth.session };
        return { batch: targets.map(target => ({ ...target, payload: { ciphertext: 'cipher' } })) };
      },
    });
    f = fixture({ getCrypto: () => api });
    const send = () => path === 'viewing' ? f.runtime.sharing.publishViewing() : path === 'reaction' ? f.interactions.react('team', '🔥', 1) : f.interactions.poke('team', 'peer');
    if (change !== 'none' && path !== 'viewing') await assert.rejects(send()); else await send();
    assert.equal(encrypted.length, 1);
    assert.ok(encrypted[0].every(target => target.deviceId === 'SIGNED'));
    assert.equal(f.calls.length, change === 'none' ? 1 : 0);
  });
}
