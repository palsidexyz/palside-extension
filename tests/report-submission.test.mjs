import test from 'node:test';
import assert from 'node:assert/strict';
import { submitReport } from '../apps/extension/src/runtime/storage/report-submission.ts';
import { messageReportPreview } from '../apps/extension/src/features/palside/feedback/report-preview.ts';

const key = 'report-operation-test-0001';
const body = { kind: 'message', targetId: 'selected-event', reason: 'spam', note: '', snapshot: 'selected text' };
function memory() {
  const rows = new Map();
  return { rows, async get(id) { return rows.get(id); }, async put(id, _account, _kind, value) { rows.set(id, structuredClone(value)); }, async removeIfValue(id, expected) { if (rows.get(id) !== expected) return false; rows.delete(id); return true; } };
}

test('a lost report acknowledgement is reconciled without another submission', async () => {
  const storage = memory(); let submissions = 0;
  const api = { async request(path, options) {
    if (path === 'reports.submit') { submissions++; assert.equal(options.key, key); throw new Error('response lost after commit'); }
    assert.equal(path, 'operations.read'); assert.equal(options.query.id, key);
    return { status: 'complete', result: { submitted: true } };
  } };
  assert.deepEqual(await submitReport(api, storage, 'account', key, async () => body, () => {}), { submitted: true, recovered: true });
  assert.equal(submissions, 1); assert.equal(storage.rows.size, 0);
});

test('manual retry freezes the original selected content and does not upload a new selection', async () => {
  const storage = memory(); let offline = true; let created = 0; let selections = 0;
  const api = { async request(path, options) {
    if (offline) throw new Error('offline');
    if (path === 'operations.read') return { status: 'not-submitted' };
    assert.deepEqual(options.body, body); assert.equal(options.key, key); created++; return { submitted: true };
  } };
  assert.deepEqual(await submitReport(api, storage, 'account', key, async () => { selections++; return body; }, () => {}), { pending: true });
  offline = false;
  assert.deepEqual(await submitReport(api, storage, 'account', key, async () => { selections++; return { ...body, snapshot: 'later edit' }; }, () => {}), { submitted: true });
  assert.equal(selections, 1); assert.equal(created, 1); assert.equal(storage.rows.size, 0);
});

test('account change stops a report before persistence and submission', async () => {
  const storage = memory(); let current = true; let requests = 0;
  await assert.rejects(submitReport({ async request() { requests++; } }, storage, 'account', key, async () => { current = false; return body; }, () => { if (!current) throw new Error('account changed'); }), /account changed/);
  assert.equal(requests, 0); assert.equal(storage.rows.size, 0);
});

test('reopening the same report target reconciles its prior key before accepting new content', async () => {
  const storage = memory(); let lookupAvailable = false; let submissions = 0;
  const api = { async request(path, options) {
    if (path === 'reports.submit') { submissions++; assert.equal(options.key, key); throw new Error('response lost after commit'); }
    assert.equal(path, 'operations.read'); assert.equal(options.query.id, key);
    if (!lookupAvailable) throw new Error('offline');
    return { status: 'complete', result: { submitted: true } };
  } };
  assert.deepEqual(await submitReport(api, storage, 'account', key, async () => body, () => {}, 'same-target'), { pending: true });
  lookupAvailable = true;
  assert.deepEqual(await submitReport(api, storage, 'account', 'new-form-key-0000001', async () => { throw new Error('must not collect new content'); }, () => {}, 'same-target'), { submitted: true, recovered: true });
  assert.equal(submissions, 1); assert.equal(storage.rows.size, 0);
});

test('a definitive report rejection clears its pending snapshot and remains an error', async () => {
  const storage = memory(); const forbidden = Object.assign(new Error('target unavailable'), { status: 403 });
  await assert.rejects(submitReport({ async request() { throw forbidden; } }, storage, 'account', key, async () => body, () => {}), /target unavailable/);
  assert.equal(storage.rows.size, 0);
});

test('report preview includes the selected asset, not the automatic marker or reply source', () => {
  const view = { id: 'asset', name: 'TOKEN', chain: 'Base', address: '0x123', source: 'GMGN', url: 'https://gmgn.ai/base/token/0x123' };
  const message = { text: 'selected caption', attachment: { kind: 'asset', assetId: 'asset', view }, replyTo: 'other-message' };
  const preview = messageReportPreview(message);
  for (const part of ['selected caption', 'TOKEN', 'Base', '0x123', 'GMGN', 'https://gmgn.ai/base/token/0x123']) assert.ok(preview.includes(part));
  assert.ok(!preview.includes('PRIVATE')); assert.ok(!preview.includes('other-message'));
});

test('image report preview does not include image bytes or silently invent missing assets', () => {
  assert.equal(messageReportPreview({ text: '', attachment: { kind: 'image', src: 'private-image-bytes' } }), '[Image message]');
  assert.equal(messageReportPreview({ text: 'caption', attachment: { kind: 'asset', assetId: 'missing' } }), 'caption\n\n[Token details unavailable]');
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('two panels reserve one frozen report and share one server submission', async () => {
  const storage = memory(); const preparing = deferred(); const prepared = deferred();
  const sending = deferred(); const sent = deferred();
  let selections = 0; let submissions = 0;
  const selected = { ...body };
  const api = { async request(path, options) {
    assert.equal(path, 'reports.submit'); submissions++;
    assert.equal(options.key, key);
    assert.deepEqual(options.body, body);
    const reservation = JSON.parse(storage.rows.get('account:report-submit:same-target'));
    assert.deepEqual(reservation, { key, body });
    sending.resolve(); await sent.promise;
    assert.deepEqual(options.body, body);
    return { submitted: true };
  } };
  const first = submitReport(api, storage, 'account', key, async () => {
    selections++; preparing.resolve(); await prepared.promise; return selected;
  }, () => {}, 'same-target');
  await preparing.promise;
  const second = submitReport(api, storage, 'account', 'second-panel-key-0001', async () => {
    selections++; return { ...body, snapshot: 'other selection' };
  }, () => {}, 'same-target');
  prepared.resolve(); await sending.promise;
  selected.snapshot = 'edited while sending'; sent.resolve();
  assert.deepEqual(await Promise.all([first, second]), [{ submitted: true }, { submitted: true }]);
  assert.equal(selections, 1); assert.equal(submissions, 1); assert.equal(storage.rows.size, 0);
});

for (const outcome of ['submitted', 'recovered', 'cancelled', 'rejected']) {
  test(`${outcome} cleanup preserves a replacement reservation`, async () => {
    const storage = memory(); const record = 'account:report-submit:same-target';
    const original = JSON.stringify({ key, body });
    const replacement = JSON.stringify({ key: 'other-report-key-0001', body: { ...body, snapshot: 'other selection' } });
    if (outcome === 'recovered' || outcome === 'cancelled') storage.rows.set(record, original);
    const api = { async request(path) {
      storage.rows.set(record, replacement);
      if (outcome === 'recovered') {
        assert.equal(path, 'operations.read');
        return { status: 'complete', result: { submitted: true } };
      }
      if (outcome === 'cancelled') return { status: 'cancelled' };
      if (outcome === 'rejected') throw Object.assign(new Error('forbidden'), { status: 403 });
      return { submitted: true };
    } };
    const result = submitReport(api, storage, 'account', key, async () => body, () => {}, 'same-target');
    if (outcome === 'cancelled' || outcome === 'rejected') await assert.rejects(result);
    else assert.equal((await result).submitted, true);
    assert.equal(storage.rows.get(record), replacement);
  });
}

test('a stalled report does not block another account or target', async () => {
  const storage = memory(); const started = deferred(); const finish = deferred();
  const first = submitReport({ async request() {
    started.resolve(); await finish.promise; return { submitted: true };
  } }, storage, 'account', key, async () => body, () => {}, 'same-target');
  await started.promise;
  const api = { async request() { return { submitted: true }; } };
  try {
    for (const [account, target] of [['other-account', 'same-target'], ['account', 'other-target']]) {
      assert.deepEqual(await submitReport(api, storage, account, key, async () => body, () => {}, target), { submitted: true });
    }
    assert.equal(storage.rows.size, 1);
  } finally { finish.resolve(); await first; }
});

test('a failed reservation releases the slot for a manual retry', async () => {
  const storage = memory(); const put = storage.put; let submissions = 0;
  storage.put = async () => { throw new Error('storage unavailable'); };
  const api = { async request() { submissions++; return { submitted: true }; } };
  await assert.rejects(submitReport(api, storage, 'account', key, async () => body, () => {}), /storage unavailable/);
  assert.equal(submissions, 0);
  storage.put = put;
  assert.deepEqual(await submitReport(api, storage, 'account', key, async () => body, () => {}), { submitted: true });
  assert.equal(submissions, 1);
});
