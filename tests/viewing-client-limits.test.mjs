import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenName } from '../apps/extension/src/runtime/viewing/token-page.ts';
import { tokenLogo } from '../apps/extension/src/runtime/viewing/token-logo.ts';
import { productionModules } from './helpers/production-module.mjs';
import { VIEWING_TTL_MS, VIEWING_CLOCK_SKEW_MS } from '@palside/shared/rules/interactions';
import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import { olmEnvelope } from '../packages/shared/src/contracts/viewing.ts';
import { EVENT_ID_LENGTH } from '@palside/shared/rules/messages';

test('token names collapse whitespace and count graphemes', () => {
  assert.equal(tokenName('  A\n B  '), 'A B');
  assert.equal(tokenName('é'.repeat(64)), 'é'.repeat(64));
  assert.equal(tokenName('é'.repeat(65)), undefined);
  for (const value of ['100%', '<script>', '↑100', '\u202eToken']) assert.equal(tokenName(value), undefined);
});
function png(size = 45, width = 48, height = 48, signature = 137) {
  const bytes = new Uint8Array(size); bytes.set([signature, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer); header.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12); header.setUint32(16, width); header.setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
test('the shared logo validator enforces PNG signature, byte size, and dimensions', () => {
  const accepted = png(8000); assert.equal(tokenLogo(accepted), accepted);
  for (const invalid of [png(8001), png(45, 49), png(45, 48, 49), png(45, 0), png(45, 48, 48, 0)]) assert.equal(tokenLogo(invalid), undefined);
});
test('viewing receive tolerance is the lease TTL plus clock skew', async () => {
  let reads = 0;
  const { SharingRuntime } = productionModules({ readView: async () => { reads++; return { id: 'page' }; }, Date })('apps/extension/src/runtime/viewing/sharing.ts');
  const now = Date.now(); const person = { id: 'peer', matrixId: '@peer' }, team = { id: 'one', joined: true, people: [person], memberIds: ['peer'] };
  const session = {};
  const runtime = { auth: { session, scope: () => ({ wait: p => p }) }, state: { preferences: { current: 'one' }, remoteTeams: [team] }, cache: { upsertView() {} } };
  const sharing = new SharingRuntime(runtime); sharing.expireViewing = () => {};
  sharing.activeViewing.set('peer', { teamId: 'one', order: 1, sequence: 1, expiresAt: now + VIEWING_TTL_MS });
  const event = expiresAt => ({ isEncrypted: () => true, isDecryptionFailure: () => false, getType: () => 'com.palside.viewing', getSender: () => '@peer', getContent: () => ({ teamId: 'one', order: 1, sequence: 1, expiresAt, view: {} }) });
  await sharing.consumeViewing(event(now + VIEWING_TTL_MS + VIEWING_CLOCK_SKEW_MS + 10_000), session); assert.equal(reads, 0);
  await sharing.consumeViewing(event(now + VIEWING_TTL_MS + VIEWING_CLOCK_SKEW_MS), session); assert.equal(reads, 1); assert.equal(sharing.peerViewing.get('peer').expiresAt, now + VIEWING_TTL_MS);
});
test('Olm message IDs use the shared event ID cap', () => {
  const envelope = { algorithm: 'm.olm.v1.curve25519-aes-sha2', sender_key: 'key', ciphertext: {}, 'org.matrix.msgid': 'a'.repeat(EVENT_ID_LENGTH) };
  assert.equal(decodeContract(olmEnvelope, envelope)['org.matrix.msgid'].length, EVENT_ID_LENGTH);
  assert.throws(() => decodeContract(olmEnvelope, { ...envelope, 'org.matrix.msgid': 'a'.repeat(EVENT_ID_LENGTH + 1) }));
});
