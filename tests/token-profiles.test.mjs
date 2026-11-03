import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAddress, identifyPage } from '../packages/shared/src/navigation.ts';
import { pageView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { TokenProfiles, tokenNamed, TOKEN_PROFILE_TTL_MS, TOKEN_PROFILE_LIMIT, TOKEN_PROFILE_EXPOSED } from '../apps/extension/src/runtime/viewing/token-profiles.ts';

const address = '0x0000000000000000000000000000000000000001';
const asset = `Ethereum:${address}`;
const identity = identifyPage(`https://gmgn.ai/eth/token/${address}`, ['gmgn.ai']);
const logo = 'https://gmgn.ai/external-res/abc.png';
const cache = (now = { at: 0 }) => { const published = []; const tokens = new TokenProfiles(() => published.push(tokens.pick([asset])), () => now.at); return { tokens, published, now }; };

test('the address placeholder is never a name, and websites are always named', () => {
  assert.equal(tokenNamed(pageView(identity)), false);
  assert.equal(pageView(identity).name, shortAddress(address));
  assert.equal(tokenNamed(pageView(identity, { name: 'PONS' })), true);
  assert.equal(tokenNamed({ kind: 'website', name: 'Example', address: undefined }), true);
  const { tokens } = cache();
  assert.equal(tokens.put(asset, { name: shortAddress(address) }, 'page'), false);
  assert.equal(tokens.put(asset, { name: '$0.001' }, 'page'), false);
  assert.equal(tokens.get(asset), undefined);
});

test('a page read outranks teammates and the service, which may still supply a missing icon', () => {
  const { tokens, published } = cache();
  assert.equal(tokens.put(asset, { name: 'PONS' }, 'page'), true);
  assert.equal(tokens.put(asset, { name: 'FAKE', logo }, 'room'), false);
  assert.deepEqual(tokens.get(asset), { name: 'PONS' });
  assert.equal(tokens.put(asset, { name: 'PONS', logo }, 'room'), true);
  assert.deepEqual(tokens.get(asset), { name: 'PONS', logo });
  assert.equal(tokens.put(asset, { name: 'RENAMED' }, 'page'), true);
  assert.deepEqual(tokens.get(asset), { name: 'RENAMED' }, 'a new name never keeps the old name\'s icon');
  assert.equal(published.length, 3);
  assert.equal(tokens.put(asset, { name: 'RENAMED' }, 'page'), false, 'identical reads do not republish');
  assert.equal(published.length, 3);
});

test('entries expire after their lifetime and the cache keeps a bounded recent window', () => {
  const { tokens, now } = cache();
  tokens.put(asset, { name: 'PONS' }, 'view');
  now.at = TOKEN_PROFILE_TTL_MS + 1;
  assert.equal(tokens.get(asset), undefined);
  assert.equal(tokens.put(asset, { name: 'PONS' }, 'room'), true, 'an expired stronger source does not block a weaker one');
  const key = n => `Ethereum:0x${n.toString(16).padStart(40, '0')}`;
  for (let n = 2; n < TOKEN_PROFILE_LIMIT + 10; n++) tokens.put(key(n), { name: `T${n}` }, 'view');
  assert.equal(tokens.get(asset), undefined, 'the oldest entry leaves first');
  const wanted = Array.from({ length: TOKEN_PROFILE_LIMIT + 8 }, (_, n) => key(n + 2));
  assert.equal(Object.keys(tokens.pick(wanted)).length, TOKEN_PROFILE_EXPOSED);
  assert.deepEqual(Object.keys(tokens.pick([key(TOKEN_PROFILE_LIMIT + 9), key(1)])), [key(TOKEN_PROFILE_LIMIT + 9)], 'only requested, stored tokens travel');
});

test('every view of a token draws the one record, keeping its own identity', () => {
  const { tokens } = cache();
  tokens.put(asset, { name: 'PONS', logo, site: 'gmgn' }, 'page');
  assert.deepEqual(tokens.get(asset), { name: 'PONS', logo, site: 'gmgn' });
  const filled = tokens.apply(pageView(identity));
  assert.equal(filled.name, 'PONS'); assert.equal(filled.logo, logo); assert.equal(filled.glyph, 'P');
  const snapshot = { ...pageView(identity, { name: 'OLD NAME', logo: 'https://gmgn.ai/external-res/old.png' }), id: 'message-card' };
  const card = tokens.apply(snapshot);
  assert.equal(card.name, 'PONS'); assert.equal(card.logo, logo); assert.equal(card.id, 'message-card'); assert.equal(card.url, snapshot.url);
  const same = pageView(identity, { name: 'PONS', logo });
  assert.equal(tokens.apply(same), same, 'an already matching view is returned unchanged');
  const website = { ...pageView(identity), kind: 'website' };
  assert.equal(tokens.apply(website), website);
  assert.equal(tokens.remember(pageView(identity)), false, 'placeholders are never learned');
});

test('clearing empties the cache and what the panel sees', () => {
  const { tokens, published } = cache();
  tokens.put(asset, { name: 'PONS' }, 'page');
  tokens.clear();
  assert.equal(tokens.get(asset), undefined);
  assert.deepEqual(published.at(-1), {});
});
