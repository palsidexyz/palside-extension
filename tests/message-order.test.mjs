import assert from 'node:assert/strict';
import test from 'node:test';
import { interleaveTimed, orderMessages } from '../apps/extension/src/domain/chat/order.ts';

// A confirmed row carries its service time; a pending row carries the time it was written.
const row = (id, status, timestamp, clientId) => ({ id, clientId, teamId: 't', author: 'me', text: id, time: '', timestamp, status });
const ids = list => list.map(m => m.id);
const keys = list => list.map(m => m.clientId ?? m.id);

test('pending sends stay after confirmed messages in writing order, whatever the clocks say', () => {
  // The service clock runs ahead of this device: confirmed 1 carries a later time than pending 2 and 3 were written at.
  const messages = [row('c3', 'sending', 1_300), row('$1', 'sent', 5_000), row('c2', 'waiting', 1_200), row('$0', 'sent', 900)];
  assert.deepEqual(ids(orderMessages(messages)), ['$0', '$1', 'c2', 'c3']);
});

test('failed and uncertain sends keep their writing order with the rest of the pending sends', () => {
  const messages = [row('c2', 'failed', 2_000), row('c1', 'uncertain', 1_000), row('c3', 'sending', 3_000)];
  assert.deepEqual(ids(orderMessages(messages)), ['c1', 'c2', 'c3']);
});

test('a burst of sends keeps its typed order on screen through every confirmation', () => {
  // A, B, C are written within 200 ms; each confirms later with a service time after all three were written.
  let messages = [row('a', 'sending', 1_000), row('b', 'sending', 1_100), row('c', 'sending', 1_200)];
  const payments = [{ id: 'p', timestamp: 500 }];
  const shown = () => interleaveTimed(orderMessages(messages), payments).map(entry => 'entry' in entry ? entry.entry.id : entry.message.clientId ?? entry.message.id);
  assert.deepEqual(shown(), ['p', 'a', 'b', 'c']);
  for (const [clientId, eventId, at] of [['a', '$a', 3_000], ['b', '$b', 3_400], ['c', '$c', 3_800]]) {
    messages = [...messages.filter(m => m.id !== clientId), row(eventId, 'sent', at, clientId)];
    assert.deepEqual(shown(), ['p', 'a', 'b', 'c'], `after ${clientId} confirmed`);
  }
  assert.deepEqual(keys(messages), ['a', 'b', 'c']);
});

test('timed entries join confirmed messages by time and never split the pending sends', () => {
  const messages = orderMessages([row('$1', 'sent', 1_000), row('$2', 'sent', 3_000), row('c1', 'sending', 1_500), row('c2', 'sending', 1_600)]);
  const entries = [{ id: 'late', timestamp: 9_000 }, { id: 'mid', timestamp: 2_000 }, { id: 'tie', timestamp: 3_000 }];
  const shown = interleaveTimed(messages, entries).map(entry => 'entry' in entry ? entry.entry.id : entry.message.id);
  assert.deepEqual(shown, ['$1', 'mid', '$2', 'tie', 'late', 'c1', 'c2']);
});

test('timed entries alone, or after every message, keep their own time order', () => {
  assert.deepEqual(interleaveTimed([], [{ id: 'b', timestamp: 2 }, { id: 'a', timestamp: 1 }]).map(entry => entry.entry.id), ['a', 'b']);
  const shown = interleaveTimed([row('$1', 'sent', 1)], [{ id: 'x', timestamp: 5 }]).map(entry => 'entry' in entry ? entry.entry.id : entry.message.id);
  assert.deepEqual(shown, ['$1', 'x']);
});

test('sends in one team reach the service in the order they were made, and a refused send hands its turn on', async () => {
  const { SendLanes } = await import('../apps/extension/src/runtime/chat/send-pacer.ts');
  const lanes = new SendLanes();
  const first = lanes.take('t'), second = lanes.take('t'), other = lanes.take('u');
  const order = [];
  void second.ready.then(() => order.push('second'));
  void other.ready.then(() => order.push('other team'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['other team']);
  first.release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['other team', 'second']);
});
