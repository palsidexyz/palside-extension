import { productionModules } from './helpers/production-module.mjs';
import { REACTION_TTL_MS } from '../packages/shared/src/contracts/limits.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as social from '../apps/extension/src/domain/annotations/social.ts';
import { messageExpiry } from '../apps/extension/src/runtime/chat/message-expiry.ts';
import { upsertTeamItem } from '../apps/extension/src/runtime/annotations/team-items.ts';
import { commandError } from '../apps/extension/src/runtime/composition/commands.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { requireEncryptedSend, teamSendGuard } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { encryptedRoom, installEncryptedRoom } from './helpers/encrypted-room.mjs';

const context = { requireEncryptedSend, teamSendGuard, ...languageGlobals, REACTION_TTL_MS, ...social, messageExpiry, upsertTeamItem, commandError, text: value => typeof value === 'string' ? value : '', Date, Intl, JSON, TextEncoder, Uint8Array, crypto, setTimeout, clearTimeout };
const load = productionModules(context);
const Service = load('apps/extension/src/runtime/annotations/interactions.ts').TeamInteractions;
context.RuntimeCommands = load('apps/extension/src/runtime/composition/dispatch.ts').RuntimeCommands;
const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
const base = () => ({ operationId: crypto.randomUUID(), text: '', asset, url: 'https://example.com/token', site: 'example.com', target: { kind: 'quote', exact: 'Public text', prefix: '', suffix: '' }, caption: 'Public text' });
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const records = new Map(); const events = new Map(); const sent = []; const cached = []; const redacted = [];
  let sendHook; let cacheHook; let putHook; let removeHook;
  const runtime = {
    state: { data: { teams: [] }, remoteTeams: ['one', 'two'].map(id => ({ id, roomId: `!${id}`, joined: true, retentionDays: 2, memberIds: ['alice'], people: [{ id: 'alice', matrixId: '@alice' }] })), items: social.emptyItems() },
    auth: { session: { account: { id: 'alice' } }, requireConnection() {}, scope: () => ({ check() {}, wait: value => value }), client: { async sendEvent(room, type, content, txn) { sent.push({ room, type, content, txn }); if (!events.has(txn)) events.set(txn, `$${events.size + 1}`); await sendHook?.(); return { event_id: events.get(txn) }; } } },
    cache: { evictCachedContent() {} },
    timeline: { redactions: new Map() },
    initialise: async () => {},
    storage: {
      async remove(key) { await removeHook?.(); records.delete(key); },
      async get(key) { return records.has(key) ? clone(records.get(key).value) : undefined; },
      async put(key, account, kind, value, expiresAt) { await putHook?.(); records.set(key, clone({ account, kind, value, expiresAt })); },
      async cache(account, id, value, expiresAt) { await cacheHook?.(); cached.push(clone({ account, id, value, expiresAt })); return []; },
    }, emit() {},
  };
  installEncryptedRoom(runtime.auth.client);
  const interactions = new Service(runtime);
  runtime.interactions = interactions;
  runtime.auth.client.redactEvent = async (_room, id) => { redacted.push(id); };
  const dispatch = new context.RuntimeCommands(runtime);
  return { runtime, interactions, dispatch, records, events, sent, cached, redacted, send(fn) { sendHook = fn; }, cache(fn) { cacheHook = fn; }, put(fn) { putHook = fn; }, remove(fn) { removeHook = fn; } };
}

test('dispatch preserves the operation id through remote-accepted response loss and retry', async () => {
  const f = fixture(); const payload = { ...base(), teamId: 'one', kind: 'sticky', text: '' }; let first = true;
  f.send(() => { if (first) { first = false; throw Error('accepted but response lost'); } });
  await assert.rejects(f.dispatch.execute({ name: 'team-event', payload }));
  const result = await f.dispatch.execute({ name: 'team-event', payload });
  assert.equal(result.id, '$1'); assert.equal(result.revision, '$1');
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0].txn, f.sent[1].txn); assert.equal(f.events.size, 1);
  assert.equal(f.runtime.state.items.stickies.length, 1);
});

test('reselecting the same exact source and quote opens one saved mark without changing its comment', async () => {
  const f = fixture(); const payload = { ...base(), asset: undefined, text: '' };
  const created = await f.interactions.teamEvent('one', 'sticky', payload);
  const again = await f.interactions.teamEvent('one', 'sticky', { ...payload, text: 'Not an implicit overwrite', operationId: crypto.randomUUID() });
  assert.equal(again.id, created.id); assert.equal(again.existing, true); assert.equal(f.sent.length, 1);
  assert.equal(f.runtime.state.items.stickies[0].text, '');
  await f.interactions.teamEvent('one', 'sticky', { ...payload, url: `${payload.url}?other=1`, operationId: crypto.randomUUID() });
  assert.equal(f.sent.length, 2);
});

test('two panels editing one revision serialize and reject the stale second edit', async () => {
  const f = fixture(); const payload = { ...base(), text: '' };
  const original = await f.interactions.teamEvent('one', 'sticky', payload);
  const edit = { teamId: 'one', kind: 'sticky', edits: original.id, baseRevision: original.revision, text: 'A', operationId: crypto.randomUUID() };
  const results = await Promise.allSettled([f.dispatch.execute({ name: 'team-event', payload: edit }), f.dispatch.execute({ name: 'team-event', payload: { ...edit, text: 'B', operationId: crypto.randomUUID() } })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'ANNOTATION_CONFLICT');
  assert.equal(f.runtime.state.items.stickies[0].text, 'A'); assert.equal(f.runtime.state.items.stickies[0].revision, '$2');
  const retry = await f.dispatch.execute({ name: 'team-event', payload: edit });
  assert.equal(retry.id, original.id); assert.equal(retry.revision, '$2'); assert.equal(f.sent.length, 2);
});

test('delete uses the displayed revision and a removed root cannot be edited', async () => {
  const f = fixture(); const original = await f.interactions.teamEvent('one', 'sticky', { ...base(), text: '' });
  await assert.rejects(f.dispatch.execute({ name: 'team-event-remove', payload: { teamId: 'one', kind: 'sticky', id: original.id, baseRevision: '$stale' } }), error => error.code === 'ANNOTATION_CONFLICT');
  assert.equal(f.redacted.length, 0);
  await f.dispatch.execute({ name: 'team-event-remove', payload: { teamId: 'one', kind: 'sticky', id: original.id, baseRevision: original.revision } });
  assert.deepEqual(f.redacted, [original.id]); assert.equal(f.runtime.state.items.stickies.length, 0);
  assert.equal(f.runtime.timeline.redactions.has(original.id), true);
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', { edits: original.id, baseRevision: original.revision, text: 'late', operationId: crypto.randomUUID() }), error => error.code === 'ANNOTATION_UNAVAILABLE');
});

test('a delete response lost after remote commit retries one stable transaction and then stays idempotent', async () => {
  const f = fixture(); const original = await f.interactions.teamEvent('one', 'sticky', { ...base(), text: '' });
  const txns = []; let lost = true;
  f.runtime.auth.client.redactEvent = async (_room, _id, txn) => { txns.push(txn); if (lost) { lost = false; throw Error('redaction accepted, response lost'); } };
  await assert.rejects(f.interactions.removeSticky('one', original.id, original.revision));
  assert.equal(f.runtime.state.items.stickies.length, 1, 'unknown result must not claim successful deletion');
  await f.interactions.removeSticky('one', original.id, original.revision);
  await f.interactions.removeSticky('one', original.id, original.revision);
  assert.equal(txns.length, 2); assert.equal(txns[0], txns[1]); assert.equal(f.runtime.state.items.stickies.length, 0);
  await assert.rejects(f.interactions.removeSticky('two', original.id, original.revision), error => error.code === 'ANNOTATION_CONFLICT');
  await assert.rejects(f.interactions.removeSticky('one', '$unknown', '$unknown'), error => error.code === 'ANNOTATION_UNAVAILABLE');
});

test('remote deletion and a failed cache removal cannot resurrect a mark after tombstone restore', async () => {
  const f = fixture(); const original = await f.interactions.teamEvent('one', 'sticky', { ...base(), text: '' });
  const stale = clone(f.interactions.stickyRecords[0]); let fail = true;
  f.remove(() => { if (fail) throw Error('IndexedDB removal failed'); });
  await assert.rejects(f.interactions.removeSticky('one', original.id, original.revision));
  assert.equal(f.runtime.state.items.stickies.length, 0);
  const key = `alice:annotation-deletion:${original.id}`;
  const receipt = f.records.get(key).value; assert.equal(receipt.status, 'committed');
  const restarted = new Service(f.runtime); restarted.annotationDeletions.set(receipt.id, receipt);
  restarted.upsertSticky(stale);
  restarted.upsertSticky({ ...stale, id: '$late', edits: stale.id, baseRevision: stale.id, text: 'Late edit' });
  assert.equal(restarted.stickyRecords.length, 0);
  fail = false;
  await restarted.removeSticky('one', original.id, original.revision);
  assert.deepEqual(f.redacted, [original.id], 'committed retry only repairs cache removal');
});

test('same operation shares in-flight work and completed receipt without adding another mark', async () => {
  const f = fixture(); const payload = base(); let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.send(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const first = f.interactions.teamEvent('one', 'sticky', payload); await started;
  const second = f.interactions.teamEvent('one', 'sticky', { ...payload });
  release(); const results = await Promise.all([first, second]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await f.interactions.teamEvent('one', 'sticky', payload)).id, results[0].id);
  assert.equal(f.sent.length, 1); assert.equal(f.runtime.state.items.stickies.length, 1);
  const durable = [...f.records.values()][0]; assert.equal(durable.kind, 'selection');
  assert.equal(JSON.stringify(durable).includes('Public text'), false); assert.equal(JSON.stringify(durable).includes('example.com'), false);
  assert.equal(durable.expiresAt - durable.value.timestamp, 86_400_000);
});

test('a reused operation id cannot change content, even after the runtime restarts', async () => {
  const f = fixture(); const payload = { ...base(), text: 'Shared note' };
  await f.interactions.teamEvent('one', 'sticky', payload);
  const restarted = new Service(f.runtime);
  await assert.rejects(restarted.teamEvent('one', 'sticky', { ...payload, text: 'Different note' }), error => error.code === 'SELECTION_OPERATION_CONFLICT');
  assert.equal(f.sent.length, 1);
  assert.equal((await restarted.teamEvent('one', 'sticky', payload)).id, '$1');
});

test('an unknown remote result retries with the same transaction and stable timestamp', async () => {
  const f = fixture(); const payload = base(); let failed = false;
  f.send(() => { if (!failed) { failed = true; throw Error('Response lost after server accepted'); } });
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', payload));
  const timestamp = [...f.records.values()][0].value.timestamp;
  const restarted = new Service(f.runtime);
  await restarted.teamEvent('one', 'sticky', payload);
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0].txn, f.sent[1].txn); assert.equal(f.events.size, 1);
  assert.equal(f.runtime.state.items.stickies[0].timestamp, timestamp);
});

test('cache failure after remote success retries local persistence without another send', async () => {
  const f = fixture(); const payload = { ...base(), text: 'Keep this note' }; let fail = true;
  f.cache(() => { if (fail) throw Error('Cache unavailable'); });
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', payload)); fail = false;
  await new Service(f.runtime).teamEvent('one', 'sticky', payload);
  assert.equal(f.sent.length, 1); assert.equal(f.cached.length, 1);
});

test('operation identities are isolated by account and team', async () => {
  const f = fixture(); const payload = base();
  await f.interactions.teamEvent('one', 'sticky', payload);
  await f.interactions.teamEvent('two', 'sticky', payload);
  f.runtime.auth.session = { account: { id: 'bob' } };
  f.runtime.state.remoteTeams[0].memberIds.push('bob');
  f.runtime.state.remoteTeams[0].people.push({ id: 'bob', matrixId: '@bob' });
  await f.interactions.teamEvent('one', 'sticky', payload);
  assert.equal(new Set(f.sent.map(item => item.txn)).size, 3);
});

test('invalid operation IDs fail before sending', async () => {
  const f = fixture();
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', { ...base(), operationId: 'bad' }), error => error.code === 'INVALID_SELECTION_OPERATION');
  assert.equal(f.sent.length, 0);
});

test('failed SDK local echo is resent instead of constructing a duplicate transaction', async () => {
  const f = fixture(); const payload = base(); let pending; let resend = 0;
  const room = encryptedRoom({ getEventForTxnId: txn => pending?.getTxnId() === txn ? pending : undefined });
  f.runtime.auth.client.getRoom = () => room;
  f.runtime.auth.client.sendEvent = async (_room, _type, _content, txn) => {
    assert.equal(pending, undefined, 'SDK would reject a second local echo with a known txn');
    pending = { status: 'not_sent', getTxnId: () => txn, getId: () => '~pending' };
    throw Error('Network disconnected');
  };
  f.runtime.auth.client.resendEvent = async (event, target) => { assert.equal(event, pending); assert.equal(target, room); resend++; return { event_id: '$recovered' }; };
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', payload));
  assert.equal((await f.interactions.teamEvent('one', 'sticky', payload)).id, '$recovered');
  assert.equal(resend, 1);
});

test('an SDK transaction still sending cannot start a second send', async () => {
  const f = fixture(); const payload = base();
  const room = encryptedRoom({ getEventForTxnId: () => ({ status: 'sending' }) });
  f.runtime.auth.client.getRoom = () => room;
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', payload), error => error.code === 'SELECTION_OPERATION_PENDING');
  assert.equal(f.sent.length, 0);
});

test('a durable remote receipt repairs cache even when the SDK echo is still updating', async () => {
  const f = fixture(); const payload = base(); let fail = true;
  f.cache(() => { if (fail) throw Error('Cache unavailable'); });
  await assert.rejects(f.interactions.teamEvent('one', 'sticky', payload)); fail = false;
  const room = encryptedRoom({ getEventForTxnId: () => ({ status: 'sending' }) });
  f.runtime.auth.client.getRoom = () => room;
  const result = await new Service(f.runtime).teamEvent('one', 'sticky', payload);
  assert.equal(result.id, '$1'); assert.equal(f.sent.length, 1); assert.equal(f.cached.length, 1);
});
