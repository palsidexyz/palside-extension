import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatArrivals, captureReadingPosition, parseReadingPosition, readingTop } from '../apps/extension/src/features/palside/chat/chat-reading.ts';

const message = (id, patch = {}) => ({ id, teamId: 'team', author: 'friend', status: 'sent', text: id, time: '12:00', ...patch });
test('initial unread, historical backfill and replay never become new arrivals', () => {
  const arrivals = new ChatArrivals();
  const initial = [message('old', { liveArrival: true })];
  arrivals.update(initial, 'self');
  arrivals.update([message('history'), ...initial, message('replayed')], 'self');
  assert.equal(arrivals.pending.size, 0);
  arrivals.update([...initial, message('new', { liveArrival: true })], 'self');
  assert.deepEqual([...arrivals.pending], ['new']);
  arrivals.clear();
  arrivals.update([...initial, message('new', { liveArrival: true, edited: true })], 'self');
  assert.equal(arrivals.pending.size, 0, 'going back up or receiving an edit cannot re-add cleared arrivals');
});
test('own sends, expired and recalled messages are excluded; visibility only removes displayed IDs', () => {
  const arrivals = new ChatArrivals(); arrivals.update([], 'self');
  const messages = [message('one', { liveArrival: true }), message('two', { liveArrival: true }), message('self', { author: 'self', liveArrival: true }), message('expired', { liveArrival: true, expiresAt: Date.now() - 1 }), message('failed', { liveArrival: true, status: 'failed' })];
  arrivals.update(messages, 'self');
  assert.deepEqual([...arrivals.pending], ['one', 'two']);
  arrivals.acknowledge(['two']);
  assert.deepEqual([...arrivals.pending], ['one']);
  arrivals.update(messages.map(m => m.id === 'one' ? { ...m, recalled: true } : m), 'self');
  assert.equal(arrivals.pending.size, 0);
});
test('separate windows own their arrivals independently of account-wide read state', () => {
  const a = new ChatArrivals(), b = new ChatArrivals();
  for (const state of [a, b]) { state.update([], 'self'); state.update([message('new', { liveArrival: true })], 'self'); }
  a.acknowledge(['new']);
  assert.equal(a.pending.size, 0); assert.equal(b.pending.size, 1);
  b.update([], 'self'); assert.equal(b.pending.size, 0);
});
test('history insertion and height changes preserve the same reading anchor', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), top: 14 + i * 100, height: 90 }));
  const position = captureReadingPosition(rows, 355, 280, false);
  assert.equal(position.anchors[0].id, '3');
  assert.equal(readingTop(position, rows.map(row => ({ ...row, top: row.top + 210 })), 1500), 565);
  assert.equal(readingTop(position, rows.filter(row => row.id !== '3').map(row => ({ ...row, top: row.top - (Number(row.id) > 3 ? 100 : 0) })), 1000), 255, 'deleting the first anchor falls back to its visible neighbour');
});
test('latest positions follow the tail, missing anchors clamp safely and malformed storage is ignored', () => {
  assert.equal(readingTop({ latest: true, top: 20, anchors: [] }, [], 1000), 1000);
  assert.equal(readingTop({ latest: false, top: 2000, anchors: [{ id: 'expired', offset: 4 }] }, [], 150), 150);
  assert.equal(parseReadingPosition('42'), undefined);
  assert.equal(parseReadingPosition('{"latest":false,"top":-3,"anchors":[]}'), undefined);
  const position = { latest: false, top: 50, anchors: [{ id: 'a', offset: -10 }] };
  assert.deepEqual(parseReadingPosition(JSON.stringify(position)), position);
});
