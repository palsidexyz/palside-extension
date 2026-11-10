import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import { event, events } from '../packages/shared/src/contracts/events.ts';

test('presence pushes carry the three-state account status', () => {
  assert.deepEqual(decodeContract(event, { event: 'presence', data: { account: 'alice', state: 'away' } }), { event: 'presence', data: { account: 'alice', state: 'away' } });
  assert.throws(() => decodeContract(event, { event: 'presence', data: { account: 'alice', state: 'online' } }));
});

test('room pushes carry a single hot ranking and reject the removed two-board shape', () => {
  const row = { key: `token:sol:${'a'.repeat(32)}`, count: 5, site: null, faces: [], rise: 3 };
  const payload = { type: 'hot', rooms: { rows: [row] } };
  assert.deepEqual(decodeContract(events.room, JSON.parse(JSON.stringify(payload))), payload);
  const face = { id: 'peer', nickname: 'Peer', avatarId: null };
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, faces: [face, face, face, face] }] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: Array.from({ length: 21 }, () => row) } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, viewers: 5 }] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rising: [], top: [] } }));
  assert.throws(() => decodeContract(events.room, { type: 'hot', rooms: { rows: [{ ...row, rise: 2 }] } }));
});
