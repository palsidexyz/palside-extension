import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAWING_RUN, mergeSignalRuns } from '../apps/extension/src/domain/annotations/signal-runs.ts';

const signal = (id, person, page, kind, day = 'd1') => ({ id, signal: { person, page, kind, day } });
const rows = entries => mergeSignalRuns(entries, entry => entry.signal).map(row => [row.entry.id, row.latest.id, row.counts.map(item => `${item.kind}${item.count}`).join()]);

test('the same person on the same page merges by kind, in the order the kinds first appeared', () => {
  assert.deepEqual(rows([signal('a', 'kai', 'sol', 'question'), signal('b', 'kai', 'sol', 'question'), signal('c', 'kai', 'sol', 'attention'), signal('d', 'kai', 'sol', 'question')]), [['a', 'd', 'question3,attention1']]);
});

test('another person, another page, a new day or anything in between starts another row', () => {
  assert.deepEqual(rows([signal('a', 'kai', 'sol', 'question'), signal('b', 'mia', 'sol', 'question')]).map(row => row[0]), ['a', 'b']);
  assert.deepEqual(rows([signal('a', 'kai', 'sol', 'question'), signal('b', 'kai', 'pons', 'question')]).map(row => row[0]), ['a', 'b']);
  assert.deepEqual(rows([signal('a', 'kai', 'sol', 'question'), signal('b', 'kai', 'sol', 'question', 'd2')]).map(row => row[0]), ['a', 'b']);
  assert.deepEqual(rows([signal('a', 'kai', 'sol', 'question'), { id: 'message' }, signal('b', 'kai', 'sol', 'question')]).map(row => row[0]), ['a', 'message', 'b']);
});

test('an entry that is not a signal stays its own row with no counts', () => {
  assert.deepEqual(rows([{ id: 'one' }, { id: 'two' }]), [['one', 'one', ''], ['two', 'two', '']]);
});

test('drawings count in the same row as the same person signals on that page', () => {
  assert.deepEqual(rows([signal('a', 'mia', 'bonk', 'attention'), signal('b', 'mia', 'bonk', DRAWING_RUN), signal('c', 'mia', 'bonk', DRAWING_RUN)]), [['a', 'c', 'attention1,drawing2']]);
  assert.deepEqual(rows([signal('a', 'mia', 'bonk', DRAWING_RUN), { id: 'message' }, signal('b', 'mia', 'bonk', DRAWING_RUN)]).map(row => row[2]), ['drawing1', '', 'drawing1']);
});
