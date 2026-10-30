import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { encryptedCrypto } from './helpers/encrypted-room.mjs';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts') && /\/runtime\/annotations\/(?:signal-service|signals)\.ts$/.test(context.parentURL ?? '')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { SignalService } = await import('../apps/extension/src/runtime/annotations/signal-service.ts');
const { SIGNAL_EVENT, SIGNAL_TTL } = await import('../apps/extension/src/runtime/annotations/signals.ts');
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
  await assert.rejects(f.service.send('team', payload()));
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
  for (const event of [f.event({}, '@peer', false), f.event({}, '@self'), f.event({}, '@outsider'), f.event({ teamId: 'other' }), f.event({ sentAt: Date.now() - SIGNAL_TTL })]) f.service.consume(event, f.session);
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

test('expiry follows original timestamp even as later signals arrive', t => {
  const f = fixture(t);
  f.service.consume(f.event({ sentAt: Date.now() - 4_000 }), f.session);
  t.mock.timers.tick(500);
  f.service.consume(f.event({ id: 'fedcba9876543210' }), f.session);
  t.mock.timers.tick(500);
  assert.deepEqual(f.runtime.state.signals.map(item => item.id), ['fedcba9876543210']);
  t.mock.timers.tick(4_500);
  assert.equal(f.runtime.state.signals.length, 0);
});

test('receive bounds both state and dedupe, preserving replay protection at capacity', t => {
  const f = fixture(t);
  for (let i = 0; i < 600; i++) f.service.consume(f.event({ id: String(i).padStart(16, '0') }), f.session);
  assert.equal(f.runtime.state.signals.length, 128);
  const emits = f.emits();
  f.service.consume(f.event({ id: '0000000000000000' }), f.session);
  assert.equal(f.emits(), emits);
  t.mock.timers.tick(SIGNAL_TTL);
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
