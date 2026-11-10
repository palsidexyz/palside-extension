import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesced } from '../packages/shared/src/coalesce.ts';

test('a burst shares one follow-up run after the one in flight, and a failure does not block the next', async () => {
  const gates = []; let runs = 0;
  const read = coalesced(() => { runs++; const gate = Promise.withResolvers(); gates.push(gate); return gate.promise; });
  const first = read(), second = read(), third = read();
  assert.equal(runs, 1); assert.notEqual(first, second); assert.equal(second, third);
  gates[0].reject(new Error('offline'));
  await assert.rejects(first, /offline/);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(runs, 2);
  gates[1].resolve('fresh');
  assert.equal(await second, 'fresh'); assert.equal(await third, 'fresh');
  const later = read(); assert.equal(runs, 3); gates[2].resolve('later'); assert.equal(await later, 'later');
});
