import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../apps/extension/src/runtime/transport/state-patch.ts';
import { createPatchSliceCache, diffState } from '../apps/extension/src/runtime/transport/state-diff.ts';

function state(overrides = {}) {
  return {
    revision: 1,
    ready: true,
    authenticated: true,
    connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
    account: { id: 'self', nickname: 'Self', avatarId: null, matrixId: '@self', revision: 1 },
    preferences: { web: { share: true, interact: true }, current: 'team', notifications: 'off' },
    toggles: { share: false, interact: false },
    remoteTeams: [],
    data: { self: 'self', people: [], views: [], teams: [], messages: [], requests: [] },
    drafts: {},
    config: { websiteUrl: '', signupDifficulty: 0 },
    invitations: {},
    items: { danmaku: [], notes: [], stances: [] },
    ...overrides,
  };
}

test('patches update top-level and data slices with structural sharing', () => {
  const previous = state({ revision: 4, data: { self: 'self', people: [{ id: 'p' }], views: [], teams: [], messages: [], requests: [] } });
  const next = { ...previous, revision: 5, drafts: { team: { revision: 1, value: { text: 'draft' }, updatedAt: 1 } }, data: { ...previous.data, messages: [{ id: 'm' }] } };
  const patch = diffState(previous, next);
  assert.deepEqual(patch, { base: 4, revision: 5, set: { 'drafts/team': next.drafts.team }, entities: { 'data/messages': { upsert: [['m', next.data.messages[0]]], remove: [], splice: [0, 0, 'm'] } } });
  const applied = applyPatch(previous, patch);
  assert.deepEqual(applied, next);
  assert.equal(applied.data.people, previous.data.people);
  assert.equal(applied.preferences, previous.preferences);
});

test('a missing base produces a full snapshot patch', () => {
  const next = state({ revision: 9 });
  const patch = diffState(undefined, next);
  assert.equal('base' in patch, false);
  assert.deepEqual(applyPatch(undefined, patch), next);
});

test('draft-only changes stay below 2 KB with 2,000 messages', () => {
  const messages = Array.from({ length: 2000 }, (_, index) => ({ id: `message-${index}`, text: `message ${index}`, author: 'person', teamId: 'team', timestamp: index }));
  const previous = state({ revision: 10, data: { self: 'self', people: [], views: [], teams: [], messages, requests: [] } });
  const next = { ...previous, revision: 11, drafts: { team: { revision: 2, value: { text: 'hello' }, updatedAt: 2 } } };
  const patch = diffState(previous, next, createPatchSliceCache());
  const bytes = Buffer.byteLength(JSON.stringify(patch));
  assert.ok(bytes < 2048, `patch was ${bytes} bytes`);
});

test('a nested slice mutated in place is still sent', () => {
  const cache = createPatchSliceCache();
  const connection = { service: 'ready', messaging: 'connecting' };
  const first = { revision: 1, connection, data: { messages: [] } };
  let panel = applyPatch(undefined, diffState(undefined, first, cache));
  connection.messaging = 'ready';
  const second = { ...first, revision: 2 };
  const patch = diffState(first, second, cache);
  assert.deepEqual(Object.keys(patch.set), ['connection/messaging']);
  panel = applyPatch(panel, patch);
  assert.equal(panel.connection.messaging, 'ready');
});

test('a top-level field first set by mutating the sent state still reaches the panel', () => {
  const cache = createPatchSliceCache();
  const state = { revision: 1, ready: true, data: { messages: [] } };
  diffState(undefined, state, cache);
  // The service sets the field on the object it already sent, then emits a copy.
  state.setup = 'password';
  const next = { ...state, revision: 2 };
  const patch = diffState(state, next, cache);
  assert.equal(patch.set.setup, 'password');
  const cleared = { ...next, setup: undefined, revision: 3 };
  assert.deepEqual(diffState(next, cleared, cache).unset, ['setup']);
});

test('a field cleared to undefined survives JSON messaging', () => {
  const cache = createPatchSliceCache();
  const first = { revision: 1, ready: true, setup: 'password', data: { messages: [] } };
  const panel = applyPatch(undefined, JSON.parse(JSON.stringify(diffState(undefined, first, cache))));
  assert.equal(panel.setup, 'password');
  const next = { ...first, setup: undefined, revision: 2 };
  const wire = JSON.parse(JSON.stringify(diffState(first, next, cache)));
  assert.deepEqual(wire.unset, ['setup']);
  assert.equal('setup' in applyPatch(panel, wire), false);
});

test('one message appended to 2000 sends only its entity and insertion', t => {
  const previous = state();
  previous.data.messages = Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, teamId: 'team', author: 'peer', text: 'x'.repeat(100), timestamp: i }));
  const message = { id: 'added', teamId: 'team', author: 'peer', text: 'y'.repeat(100), timestamp: 2000 };
  const next = { ...previous, revision: 2, data: { ...previous.data, messages: [...previous.data.messages, message] } };
  const patch = diffState(previous, next), wire = JSON.stringify(patch);
  t.diagnostic(JSON.stringify({ scenario: 'append-to-2000', bytes: Buffer.byteLength(wire) }));
  assert.ok(Buffer.byteLength(wire) < Buffer.byteLength(JSON.stringify(message)) + 200);
  assert.ok(!wire.includes('xxxxxxxxxx'));
  assert.deepEqual(applyPatch(previous, JSON.parse(wire)), next);
});
