import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageSessionBroker } from '../apps/extension/src/runtime/media/image-sessions.ts';
import { IMAGE_LIMIT } from '../apps/extension/src/domain/images/image-policy.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=';
const result = 'data:image/webp;base64,UklGRgAAAAA=';
const input = { accountId: 'alice', teamId: 'team-a', source: { src: png, name: 'image.png' }, mode: 'edit', draftRevision: 7 };
const error = code => ({ name: 'ImageSessionError', code });
function fixture(options = {}) {
  let account = 'alice', clock = 1000, id = 0;
  const broker = new ImageSessionBroker({ currentAccount: () => account, now: () => clock, createId: () => `session-${++id}`, ...options });
  return { broker, account: value => { account = value; }, clock: value => { clock = value; } };
}

test('session identity does not expose image bytes and snapshots cannot mutate stored state', () => {
  const { broker } = fixture();
  const opened = broker.open(input);
  assert.equal(opened.id, 'session-1');
  assert.equal(opened.revision, 0);
  assert.equal(opened.draftRevision, 7);
  opened.source.src = result;
  opened.teamId = 'other-team';
  const read = broker.read(opened.id, 'alice');
  assert.equal(read.source.src, png);
  assert.equal(read.teamId, 'team-a');
  assert.equal(read.status, 'open');
});

test('two editors exchange bounded document state using compare-and-set revisions', () => {
  const { broker } = fixture();
  const opened = broker.open(input);
  const doc = { crop: { x: 2, y: 3, width: 80, height: 60 }, ops: [{ kind: 'arrow', x: 1, y: 2 }] };
  const first = broker.update(opened.id, 'alice', 0, doc);
  doc.ops[0].x = 900;
  first.document.ops[0].y = 800;
  const popup = broker.read(opened.id, 'alice');
  assert.equal(popup.revision, 1);
  assert.equal(popup.document.ops[0].x, 1);
  assert.equal(popup.document.ops[0].y, 2);
  assert.throws(() => broker.update(opened.id, 'alice', 0, null), error('IMAGE_SESSION_CONFLICT'));
  assert.throws(() => broker.save(opened.id, 'alice', 0, result), error('IMAGE_SESSION_CONFLICT'));
  assert.throws(() => broker.cancel(opened.id, 'alice', 0), error('IMAGE_SESSION_CONFLICT'));
  assert.deepEqual(broker.read(opened.id, 'alice'), popup);
});

test('save produces one terminal result and keeps original team/source/draft revision', () => {
  const { broker } = fixture();
  const opened = broker.open(input);
  const saved = broker.save(opened.id, 'alice', 0, result);
  assert.equal(saved.src, result);
  assert.equal(saved.snapshot.status, 'saved');
  assert.equal(saved.snapshot.revision, 1);
  assert.equal(saved.snapshot.source.src, png);
  assert.equal(saved.snapshot.teamId, 'team-a');
  assert.equal(saved.snapshot.draftRevision, 7);
  assert.throws(() => broker.save(opened.id, 'alice', 1, png), error('IMAGE_SESSION_CLOSED'));
  assert.throws(() => broker.update(opened.id, 'alice', 1, {}), error('IMAGE_SESSION_CLOSED'));
});

test('cancellation and expiry reject delayed updates and exports', () => {
  const { broker, clock } = fixture({ ttlMs: 500 });
  const opened = broker.open(input);
  const cancelled = broker.cancel(opened.id, 'alice', 0);
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => broker.save(opened.id, 'alice', 0, result), error('IMAGE_SESSION_UNAVAILABLE'));
  const second = broker.open(input);
  clock(1500);
  assert.throws(() => broker.read(second.id, 'alice'), error('IMAGE_SESSION_UNAVAILABLE'));
  assert.throws(() => broker.save(second.id, 'alice', 0, result), error('IMAGE_SESSION_UNAVAILABLE'));
});

test('account mismatch and logout clear all sessions including same-account re-login', () => {
  const { broker, account } = fixture();
  const opened = broker.open(input);
  assert.throws(() => broker.read(opened.id, 'bob'), error('IMAGE_SESSION_UNAVAILABLE'));
  account('bob');
  assert.throws(() => broker.read(opened.id, 'alice'), error('IMAGE_SESSION_UNAVAILABLE'));
  account('alice');
  assert.throws(() => broker.read(opened.id, 'alice'), error('IMAGE_SESSION_UNAVAILABLE'));
  const next = broker.open(input);
  account(undefined); broker.clear(); account('alice');
  assert.throws(() => broker.save(next.id, 'alice', 0, result), error('IMAGE_SESSION_UNAVAILABLE'));
});

test('view-only sessions cannot mutate documents or save but can close', () => {
  const { broker } = fixture();
  const opened = broker.open({ ...input, mode: 'view' });
  assert.throws(() => broker.update(opened.id, 'alice', 0, {}), error('IMAGE_SESSION_READ_ONLY'));
  assert.throws(() => broker.save(opened.id, 'alice', 0, result), error('IMAGE_SESSION_READ_ONLY'));
  assert.equal(broker.cancel(opened.id, 'alice', 0).status, 'cancelled');
});

test('only bounded image data URLs are accepted and failed exports do not consume the session', () => {
  const { broker } = fixture();
  const tooLarge = `data:image/png;base64,${Buffer.alloc(IMAGE_LIMIT.maxBytes + 1).toString('base64')}`;
  for (const src of ['blob:https://example.com/id', 'https://example.com/image.png', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,', 'data:image/png;base64,AA!', 'data:image/png;base64,A===', tooLarge]) {
    assert.throws(() => broker.open({ ...input, source: { src, name: 'test' } }), error('IMAGE_SESSION_INVALID'));
  }
  const opened = broker.open(input);
  assert.throws(() => broker.save(opened.id, 'alice', 0, tooLarge), error('IMAGE_SESSION_INVALID'));
  assert.equal(broker.read(opened.id, 'alice').status, 'open');
  assert.equal(broker.save(opened.id, 'alice', 0, result).snapshot.status, 'saved');
});

test('editor JSON is bounded, cloned, cycle-safe and never invokes custom getters or serializers', () => {
  const { broker } = fixture();
  const opened = broker.open(input);
  const cyclic = {}; cyclic.self = cyclic;
  let called = 0;
  const getter = Object.defineProperty({}, 'ops', { enumerable: true, get() { called++; return []; } });
  const serializer = { toJSON() { called++; return {}; } };
  const poison = JSON.parse('{"__proto__":{"polluted":true}}');
  let deep = {}; for (let i = 0; i < 40; i++) deep = { child: deep };
  for (const doc of [cyclic, getter, serializer, poison, deep, { points: Array(50_001).fill(0) }, { text: 'a'.repeat(256 * 1024) }, { value: NaN }, { value: undefined }]) {
    assert.throws(() => broker.update(opened.id, 'alice', 0, doc), error('IMAGE_SESSION_INVALID'));
    assert.equal(broker.read(opened.id, 'alice').revision, 0);
  }
  assert.equal(called, 0);
  const clean = Object.create(null); clean.ops = [];
  assert.deepEqual(broker.update(opened.id, 'alice', 0, clean).document, { ops: [] });
});

test('memory limit is explicit and inactive expired sessions can be reclaimed', () => {
  const { broker, clock } = fixture({ ttlMs: 100, maxSessions: 1 });
  broker.open(input);
  assert.throws(() => broker.open(input), error('IMAGE_SESSION_LIMIT'));
  clock(1100);
  assert.equal(broker.open(input).status, 'open');
});

test('saved sessions are reclaimed before capacity limits block another edit', () => {
  const { broker } = fixture({ maxSessions: 1 });
  const opened = broker.open(input);
  broker.save(opened.id, 'alice', 0, result);
  assert.equal(broker.open(input).status, 'open');
  assert.throws(() => broker.save(opened.id, 'alice', 0, result), error('IMAGE_SESSION_UNAVAILABLE'));
});

test('invalid revisions and session identifiers cannot mutate a live session', () => {
  const { broker } = fixture();
  for (const draftRevision of [-1, 1.2, NaN, Infinity]) assert.throws(() => broker.open({ ...input, draftRevision }), error('IMAGE_SESSION_INVALID'));
  const opened = broker.open(input);
  for (const revision of [-1, 1.2, NaN, Infinity, 100]) assert.throws(() => broker.update(opened.id, 'alice', revision, {}), error('IMAGE_SESSION_CONFLICT'));
  assert.equal(broker.read(opened.id, 'alice').revision, 0);
  assert.throws(() => broker.read('missing', 'alice'), error('IMAGE_SESSION_UNAVAILABLE'));
  assert.throws(() => new ImageSessionBroker({ currentAccount: () => 'alice', maxSessions: 0 }), error('IMAGE_SESSION_INVALID'));
});
