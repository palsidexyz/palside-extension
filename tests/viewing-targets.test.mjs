import test from 'node:test';
import assert from 'node:assert/strict';
import { viewingTargets, trustedDeviceMessages } from '../apps/extension/src/runtime/viewing/viewing-targets.ts';
import { encryptedCrypto } from './helpers/encrypted-room.mjs';

const self = { userId: 'alice', deviceId: 'phone' };
function fixture() {
  const devices = new Map([
    ['alice', new Map([['phone', {}], ['desktop', {}]])],
    ['bob', new Map([['signed', {}], ['unsigned', {}], ['locally-trusted', {}], ['missing', {}]])],
    ['stranger', new Map([['signed', {}]])],
  ]);
  const api = encryptedCrypto({
    getUserDeviceInfo: async () => devices,
    getDeviceVerificationStatus: async (_user, device) => device === 'missing' ? null : ({ signedByOwner: !['unsigned', 'locally-trusted'].includes(device), localVerified: device === 'locally-trusted', crossSigningVerified: false }),
  });
  return { api, devices };
}

test('Olm recipients require owner signature, accept unchanged TOFU identities, retain own other devices and exclude outsiders', async () => {
  const { api } = fixture();
  assert.deepEqual(await viewingTargets(api, ['alice', 'bob'], self, () => {}), [
    { userId: 'alice', deviceId: 'desktop' }, { userId: 'bob', deviceId: 'signed' },
  ]);
  assert.deepEqual(await viewingTargets(api, [], self, () => {}), []);
});
for (const status of [
  { needsUserApproval: true },
  { wasCrossSigningVerified: () => true, isCrossSigningVerified: () => false },
]) test('identity change / verification withdrawal blocks direct device encryption', async () => {
  const { api } = fixture(); let encrypted = false;
  api.getUserVerificationStatus = async () => ({ needsUserApproval: false, ...status });
  api.encryptToDeviceMessages = async () => { encrypted = true; };
  await assert.rejects(trustedDeviceMessages(api, ['bob'], self, 'event', { secret: true }, () => {}), error => error.code === 'IDENTITY_CHANGED');
  assert.equal(encrypted, false);
});

test('a signature withdrawn during encryption prevents ciphertext relay', async () => {
  const { api } = fixture();
  api.encryptToDeviceMessages = async (_type, targets) => {
    api.getDeviceVerificationStatus = async () => ({ signedByOwner: false });
    return { batch: targets.map(target => ({ ...target, payload: {} })) };
  };
  await assert.rejects(trustedDeviceMessages(api, ['bob'], self, 'event', {}, () => {}));
});

test('session/member changes during discovery stop before encryption', async () => {
  const { api } = fixture(); let current = true, encrypted = false;
  const query = api.getUserDeviceInfo;
  api.getUserDeviceInfo = async () => { current = false; return query(); };
  api.encryptToDeviceMessages = async () => { encrypted = true; };
  await assert.rejects(trustedDeviceMessages(api, ['bob'], self, 'event', {}, () => { if (!current) throw Error('changed'); }), /changed/);
  assert.equal(encrypted, false);
});

test('relay includes only the verified target set even if a backend returns extra entries', async () => {
  const { api } = fixture();
  api.encryptToDeviceMessages = async (_type, targets) => ({ batch: [...targets, { userId: 'stranger', deviceId: 'signed' }].map(target => ({ ...target, payload: { ciphertext: true } })) });
  assert.deepEqual(await trustedDeviceMessages(api, ['bob'], self, 'event', {}, () => {}), { bob: { signed: { ciphertext: true } } });
});
