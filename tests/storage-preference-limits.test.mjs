import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
const { readPreferencePatch } = productionModules()('apps/extension/src/runtime/composition/state.ts');
test('hidden stickies and forgotten squads keep the latest 500 distinct entries', () => {
  const values = [...Array.from({ length: 501 }, (_, i) => String(i)), '0'];
  for (const field of ['hiddenStickies', 'forgottenTeams']) {
    const actual = [...readPreferencePatch({ [field]: values })[field]];
    assert.equal(actual.length, 500); assert.equal(actual[0], '2'); assert.equal(actual.at(-1), '0');
    assert.equal(readPreferencePatch({ [field]: [1] }), undefined);
  }
});
