import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenImageFailures } from '../apps/extension/src/features/palside/assets/token-image-failures.ts';

test('failed image memory suppresses remounts briefly and success clears the failure', () => {
  let now=100;const failures=new TokenImageFailures(()=>now);
  failures.remember('one');assert.equal(failures.has('one'),true);assert.equal(failures.has('another'),false);
  now+=60_000;assert.equal(failures.has('one'),false);
  failures.remember('one');failures.forget('one');assert.equal(failures.has('one'),false);
});
test('failed image memory is bounded and replacing an entry refreshes its order', () => {
  const failures=new TokenImageFailures(()=>0);
  for(let i=0;i<64;i++)failures.remember(String(i));
  failures.remember('0');failures.remember('64');
  assert.equal(failures.has('0'),true);assert.equal(failures.has('1'),false);assert.equal(failures.has('64'),true);
});
