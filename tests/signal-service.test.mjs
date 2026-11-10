import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { MINUTE_MS } from '@palside/shared/units';
import { encryptedCrypto,encryptedRoom } from './helpers/encrypted-room.mjs';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts') && /\/runtime\/annotations\/(?:signal-service|signals|chart-drawing-store|chart-drawings|chart-marks)\.ts$/.test(context.parentURL ?? '')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { SignalService } = await import('../apps/extension/src/runtime/annotations/signal-service.ts');
const { SIGNAL_CLOCK_SKEW, SIGNAL_EVENT, SIGNAL_RECORD_EVENT, SIGNAL_RECORD_LIMIT, SIGNAL_RECORDS_PER_MINUTE, SIGNAL_TTL, signalAsset, readSignal } = await import('../apps/extension/src/runtime/annotations/signals.ts');
hooks.deregister();
const payload = () => ({ url: 'https://example.com/page', kind: 'attention', target: { kind: 'page' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const calls = [], encrypted = [];
  const session = { account: { id: 'self' }, matrix: { userId: '@self', deviceId: 'SELF' } };
  const team = { id: 'team', joined: true, roomId: '!team', memberIds: ['self', 'peer'], people: [{ id: 'self', matrixId: '@self' }, { id: 'peer', matrixId: '@peer' }] };
  const devices = new Map([['@peer', new Map([['PEER', {}]])], ['@self', new Map([['OTHER', {}]])], ['@stranger', new Map([['DEVICE', {}]])]]);
  const cryptoApi = { ...encryptedCrypto(), async getUserDeviceInfo() { return devices; }, async encryptToDeviceMessages(type, targets, content) { encrypted.push({ type, targets, content }); return { batch: targets.map(target => ({ ...target, payload: { ciphertext: 'encrypted' } })) }; } };
  let generation = 0, emits = 0;
  const runtime = {
    state: { signals: [], preferences: { current: 'team' }, remoteTeams: [team], data: { teams: [{ id: 'team', readonly: false }] } },
    auth: { session, client: { getCrypto: () => cryptoApi }, requireConnection() {}, scope() { const start = generation; const check = () => { if (start !== generation) throw Error('scope changed'); }; return { check, async wait(work) { const result = await work; check(); return result; } }; } },
    api: { async request(path, options) { calls.push({ path, options }); return { delivered: 1 }; } }, emit() { emits++; },
  };
  const service = new SignalService(runtime);
  const host = { current: true };
  const send = service.send.bind(service);
  service.send = (teamId, value, guard = async () => host.current) => send(teamId, value, guard);
  t.after(() => service.reset());
  const event = (patch = {}, sender = '@peer', encrypted = true) => ({ isEncrypted: () => encrypted, getType: () => SIGNAL_EVENT, getSender: () => sender, getContent: () => ({ ...payload(), id: '0123456789abcdef', sentAt: Date.now(), teamId: 'team', ...patch }) });
  return { runtime, service, host, session, team, devices, cryptoApi, calls, encrypted, event, invalidate: () => generation++, emits: () => emits };
}

test('send fails closed without a background guard and when its guard refuses', async t => {
  const f = fixture(t);
  await assert.rejects(new SignalService(f.runtime).send('team', payload()));
  await assert.rejects(f.service.send('team', payload(), async () => false));
  assert.equal(f.encrypted.length, 0);
  assert.equal(f.calls.length, 0);
});

test('send encrypts only current teammate devices and returns queue receipt', async t => {
  const f = fixture(t);
  const result = await f.service.send('team', payload());
  assert.deepEqual(result, { queued: 1 });
  assert.equal(f.encrypted[0].type, SIGNAL_EVENT);
  assert.deepEqual(f.encrypted[0].targets, [{ userId: '@peer', deviceId: 'PEER' }]);
  assert.equal(f.calls[0].path, 'viewing.react');
  assert.deepEqual(f.calls[0].options.body.messages, { '@peer': { PEER: { ciphertext: 'encrypted' } } });
  assert.equal(f.runtime.state.signals.length, 0);
});

test('send excludes unsigned devices and blocks identity changes before relay', async t => {
  const f = fixture(t);
  f.devices.get('@peer').set('UNSIGNED', {});
  f.cryptoApi.getDeviceVerificationStatus = async (_user, device) => ({ signedByOwner: device !== 'UNSIGNED' });
  await f.service.send('team', payload());
  assert.deepEqual(f.encrypted[0].targets, [{ userId: '@peer', deviceId: 'PEER' }]);
  const encrypt = f.cryptoApi.encryptToDeviceMessages;
  f.cryptoApi.encryptToDeviceMessages = async (...args) => {
    const result = await encrypt(...args);
    f.cryptoApi.getUserVerificationStatus = async () => ({ needsUserApproval: true });
    return result;
  };
  await assert.rejects(f.service.send('team', payload()), error => error.code === 'IDENTITY_CHANGED', 'the sender is told why');
  assert.equal(f.calls.length, 1);
});

test('send rejects stale team, readonly, missing membership and missing public link', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.send('other', payload()));
  f.runtime.state.data.teams[0].readonly = true;
  await assert.rejects(f.service.send('team', payload()));
  f.runtime.state.data.teams[0].readonly = false;
  f.team.memberIds = ['peer'];
  await assert.rejects(f.service.send('team', payload()));
  f.team.memberIds.push('self');
  await assert.rejects(f.service.send('team', { ...payload(), url: '' }));
  f.runtime.auth.requireConnection = () => { throw Error('offline'); };
  await assert.rejects(f.service.send('team', payload()), /offline/);
  assert.equal(f.calls.length, 0);
});

test('burst limiter admits three attempts per two seconds and resets', async t => {
  const f = fixture(t);
  await Promise.all(Array.from({ length: 3 }, () => f.service.send('team', payload())));
  await assert.rejects(f.service.send('team', payload()));
  t.mock.timers.tick(2_000);
  await f.service.send('team', payload());
  f.service.reset();
  await f.service.send('team', payload());
  assert.equal(f.calls.length, 5);
});

for (const stage of ['discovery', 'encryption']) {
  for (const change of ['session', 'generation', 'current', 'membership', 'reset', 'host']) test(`send rejects ${change} invalidation during ${stage}`, async t => {
    const f = fixture(t), gate = deferred(), entered = deferred();
    const method = stage === 'discovery' ? 'getUserDeviceInfo' : 'encryptToDeviceMessages';
    const original = f.cryptoApi[method];
    f.cryptoApi[method] = async (...args) => { entered.resolve(); await gate.promise; return original(...args); };
    const pending = f.service.send('team', payload());
    await entered.promise;
    if (change === 'session') f.runtime.auth.session = { ...f.session };
    if (change === 'generation') f.invalidate();
    if (change === 'current') f.runtime.state.preferences.current = 'other';
    if (change === 'membership') f.team.memberIds = ['self'];
    if (change === 'reset') f.service.reset();
    if (change === 'host') f.host.current = false;
    gate.resolve();
    await assert.rejects(pending);
    assert.equal(f.calls.length, 0);
  });
}

test('encryption preserves initiation timestamp and expires before relay', async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.cryptoApi.getUserDeviceInfo = async () => { t.mock.timers.tick(4_000); return f.devices; };
  f.cryptoApi.encryptToDeviceMessages = async (_type, _targets, content) => { assert.equal(content.sentAt, 100_000); entered.resolve(); await gate.promise; return { batch: [{ userId: '@peer', deviceId: 'PEER', payload: {} }] }; };
  const pending = f.service.send('team', payload());
  await entered.promise;
  const rejected = assert.rejects(pending);
  t.mock.timers.tick(1_000);
  gate.resolve();
  await rejected;
  assert.equal(f.calls.length, 0);
});

test('relay response cannot succeed under changed account or team', async t => {
  const f = fixture(t);
  f.runtime.api.request = async () => { f.runtime.state.preferences.current = 'other'; return { delivered: 1 }; };
  await assert.rejects(f.service.send('team', payload()));
});

test('consume requires encrypted real current teammate and ignores self and spoofed metadata', t => {
  const f = fixture(t);
  for (const event of [f.event({}, '@peer', false), f.event({}, '@self'), f.event({}, '@outsider'), f.event({ teamId: 'other' }), f.event({ sentAt: Date.now() - SIGNAL_CLOCK_SKEW - 1 })]) f.service.consume(event, f.session);
  f.service.consume(f.event(), { ...f.session });
  f.team.people[1].deleted = true;
  f.service.consume(f.event(), f.session);
  f.team.people[1].deleted = false;
  assert.equal(f.runtime.state.signals.length, 0);
  f.service.consume(f.event({ personId: 'forged' }), f.session);
  assert.equal(f.runtime.state.signals[0].personId, 'peer');
  f.service.consume(f.event(), f.session);
  assert.equal(f.runtime.state.signals.length, 1);
});

test('signals carry service time, so a device clock a minute off still sends and receives', async t => {
  const f = fixture(t);
  f.service.syncClock(100_000 - MINUTE_MS, 99_900, 100_100); // this device runs a minute ahead of the service
  await f.service.send('team', payload());
  assert.equal(f.encrypted[0].content.sentAt, 40_000, 'on the wire in service time');
  f.service.consume(f.event({ sentAt: 40_000 }), f.session);
  const [item] = f.runtime.state.signals;
  assert.equal(item.sentAt, 100_000, 'in state on this device clock'); assert.equal(item.at, 100_000);
  f.service.consume(f.event({ id: 'fedcba9876543210', sentAt: 100_000 }), f.session);
  assert.equal(f.runtime.state.signals.length, 1, 'a send time a minute off in service time is refused');
});

test('expiry counts from arrival, so a sender whose clock runs behind still shows for the full lifetime', t => {
  const f = fixture(t);
  f.service.consume(f.event({ sentAt: Date.now() - 4_000 }), f.session);
  t.mock.timers.tick(500);
  f.service.consume(f.event({ id: 'fedcba9876543210' }), f.session);
  t.mock.timers.tick(SIGNAL_TTL - 500);
  assert.deepEqual(f.runtime.state.signals.map(item => item.id), ['fedcba9876543210']);
  t.mock.timers.tick(500);
  assert.equal(f.runtime.state.signals.length, 0);
});

test('receive bounds both state and dedupe, preserving replay protection at capacity', t => {
  const f = fixture(t);
  for (let i = 0; i < 600; i++) f.service.consume(f.event({ id: String(i).padStart(16, '0') }), f.session);
  assert.equal(f.runtime.state.signals.length, 128);
  const emits = f.emits();
  f.service.consume(f.event({ id: '0000000000000000' }), f.session);
  assert.equal(f.emits(), emits);
  t.mock.timers.tick(SIGNAL_CLOCK_SKEW);
  f.service.consume(f.event({ id: '0000000000000600' }), f.session);
  assert.equal(f.runtime.state.signals.length, 1);
});

test('reset clears dedupe, signals and timers and invalidates pending work', t => {
  const f = fixture(t);
  f.service.consume(f.event(), f.session);
  f.service.reset();
  const emits = f.emits();
  t.mock.timers.tick(SIGNAL_TTL);
  assert.equal(f.emits(), emits);
  assert.equal(f.runtime.state.signals.length, 0);
  f.service.consume(f.event(), f.session);
  assert.equal(f.runtime.state.signals.length, 1);
});

/** A room the record can be written to: encrypted, nothing blocking, and each send seen. */
function recording(f) {
  const sent = [], pending = new Map();
  let fail = false;
  const room = encryptedRoom({ getEventForTxnId: id => pending.get(id) });
  Object.assign(f.runtime.auth.client, {
    getRoom: () => room, cancelled: [],
    async sendEvent(roomId, type, content, txn) {
      if (fail) { pending.set(txn, { txn }); throw Error('refused'); }
      sent.push({ roomId, type, content, txn });
      return { event_id: '$' + txn };
    },
    cancelPendingEvent(event) { this.cancelled.push(event.txn); pending.delete(event.txn); },
  });
  f.runtime.storage = { rows: new Map(), async cache(account, id, value) { this.rows.set(account + ':cache:' + id, value); return []; }, async remove(key) { this.rows.delete(key); } };
  f.runtime.cache = { evictCachedContent() {} };
  return { sent, room, fail: on => { fail = on; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const TOKEN = 'Solana:So11111111111111111111111111111111111111112';
const recordEvent = (patch = {}, id = '$record', ts = 90_000) => ({ getId: () => id, getTs: () => ts, getContent: () => ({ id: '0123456789abcdef', teamId: 'team', url: 'https://example.com/page', sentAt: 12_345, kind: 'danger', target: { kind: 'page' }, ...patch }) });

test('a signal or emote shows its chat line at once as pending and writes it to the room with the relay', async t => {
  const f = fixture(t), room = recording(f);
  const sending = f.service.send('team', { ...payload(), asset: TOKEN });
  await settle();
  const pending = f.runtime.state.signalRecords.find(record => record.pending);
  assert.equal(pending.personId, 'self'); assert.equal(pending.asset, TOKEN);
  await sending; await settle();
  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].type, SIGNAL_RECORD_EVENT);
  assert.equal(room.sent[0].roomId, '!team');
  assert.equal(room.sent[0].content.asset, TOKEN);
  assert.equal(room.sent[0].content.url, 'https://example.com/page');
  assert.equal(room.sent[0].content.id, pending.id);
  // The room event comes back and takes the pending line's place.
  await f.service.keepRecord(recordEvent({ ...room.sent[0].content }, '$echo'), 'team', 'self', 500_000, f.session);
  assert.deepEqual(f.runtime.state.signalRecords.map(record => [record.id, Boolean(record.pending)]), [['$echo', false]]);
  await f.service.send('team', { ...payload(), emote: 'gm' });
  await settle();
  assert.equal(room.sent.length, 2);
  assert.equal(room.sent[1].content.emote, 'gm');
});

test('no record is written when the relay failed, and a failed record leaves nothing waiting and does not fail the signal', async t => {
  const f = fixture(t), room = recording(f);
  await assert.rejects(f.service.send('team', payload(), async () => false));
  await settle();
  assert.equal(room.sent.length, 0);
  room.fail(true);
  assert.deepEqual(await f.service.send('team', payload()), { queued: 1 });
  await settle();
  assert.equal(f.runtime.auth.client.cancelled.length, 1);
});

test('a relay refused after the pending line showed takes the line back and writes nothing to the room', async t => {
  const f = fixture(t), room = recording(f);
  f.runtime.api.request = async () => { await settle(); throw Error('relay refused'); };
  const sending = f.service.send('team', payload());
  await settle();
  assert.equal(f.runtime.state.signalRecords.filter(record => record.pending).length, 1);
  await assert.rejects(sending, /relay refused/);
  await settle(); await settle();
  assert.equal(room.sent.length, 0);
  assert.equal(f.runtime.state.signalRecords.length, 0);
});

test('records are limited per minute so signals cannot use up the chat sends of the squad; the signal itself still goes', async t => {
  const f = fixture(t), room = recording(f);
  for (let index = 0; index < SIGNAL_RECORDS_PER_MINUTE + 3; index++) {
    t.mock.timers.tick(1_000);
    assert.deepEqual(await f.service.send('team', payload()), { queued: 1 });
    await settle();
  }
  assert.equal(room.sent.length, SIGNAL_RECORDS_PER_MINUTE);
  t.mock.timers.tick(MINUTE_MS);
  await f.service.send('team', payload());
  await settle();
  assert.equal(room.sent.length, SIGNAL_RECORDS_PER_MINUTE + 1);
});

test('a record is kept with the service time of its event however old its send time is, once, and cached', async t => {
  const f = fixture(t);
  recording(f);
  await f.service.keepRecord(recordEvent(), 'team', 'peer', 500_000, f.session);
  await f.service.keepRecord(recordEvent(), 'team', 'peer', 500_000, f.session);
  assert.deepEqual(f.runtime.state.signalRecords, [{ id: '$record', teamId: 'team', personId: 'peer', url: 'https://example.com/page', kind: 'danger', target: { kind: 'page' }, timestamp: 90_000, expiresAt: 500_000 }]);
  assert.equal(f.runtime.storage.rows.get('self:cache:signal:$record').timestamp, 90_000);
  t.mock.timers.tick(SIGNAL_TTL * 100);
  assert.equal(f.runtime.state.signalRecords.length, 1, 'it does not expire with the live signal');
});

test('a record for another squad or with bad content is not kept; an emote record is', async t => {
  const f = fixture(t);
  recording(f);
  await f.service.keepRecord(recordEvent({ teamId: 'other' }), 'team', 'peer', 500_000, f.session);
  await f.service.keepRecord(recordEvent({ url: 'https://example.com/page?token=secret' }), 'team', 'peer', 500_000, f.session);
  await f.service.keepRecord(recordEvent({ emote: 'not-an-emote' }), 'team', 'peer', 500_000, f.session);
  await f.service.keepRecord(recordEvent({ asset: 'not an asset' }), 'team', 'peer', 500_000, f.session);
  assert.equal((f.runtime.state.signalRecords ?? []).length, 0);
  await f.service.keepRecord(recordEvent({ emote: 'gm' }), 'team', 'peer', 500_000, f.session);
  assert.equal(f.runtime.state.signalRecords[0].emote, 'gm');
});

test('records stay in time order within the limit of each squad, and pruning removes them from the cache too', async t => {
  const f = fixture(t);
  recording(f);
  for (const ts of [3_000, 1_000, 2_000]) await f.service.keepRecord(recordEvent({}, '$r' + ts, ts), 'team', 'peer', 500_000, f.session);
  assert.deepEqual(f.runtime.state.signalRecords.map(record => record.id), ['$r1000', '$r2000', '$r3000']);
  f.service.restoreRecords(Array.from({ length: SIGNAL_RECORD_LIMIT + 5 }, (_, index) => ({ id: '$old' + index, teamId: 'other', personId: 'peer', url: 'https://example.com/', kind: 'danger', target: { kind: 'page' }, timestamp: index, expiresAt: 500_000 })));
  assert.equal(f.runtime.state.signalRecords.filter(record => record.teamId === 'other').length, SIGNAL_RECORD_LIMIT);
  assert.equal(f.runtime.state.signalRecords.filter(record => record.teamId === 'team').length, 3, 'a busy squad does not push out another');
  assert.equal(await f.service.pruneRecords(record => record.teamId === 'team' && record.id !== '$r2000'), true);
  assert.deepEqual(f.runtime.state.signalRecords.map(record => record.id), ['$r1000', '$r3000']);
  assert.equal(f.runtime.storage.rows.has('self:cache:signal:$r2000'), false);
  assert.equal(await f.service.pruneRecords(() => true), false);
});

test('signals name the token of their page: from the sender on a pool page, from the address on a token page', () => {
  assert.equal(signalAsset({ url: 'https://example.com/', asset: TOKEN }), TOKEN);
  assert.equal(signalAsset({ url: 'https://example.com/' }), undefined);
  assert.equal(signalAsset({ url: 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112' }), TOKEN);
  const base = { id: '0123456789abcdef', teamId: 'team', url: 'https://example.com/', sentAt: 1, kind: 'danger', target: { kind: 'page' } };
  assert.equal(readSignal({ ...base, asset: TOKEN }, 1).asset, TOKEN);
  assert.equal(readSignal({ ...base, asset: 'Solana:nope' }, 1), undefined);
});

