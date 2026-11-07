import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAddress, identifyPage } from '../packages/shared/src/navigation.ts';
import { pageView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { TokenProfiles, tokenNamed, directoryLogo, TOKEN_PROFILE_TTL_MS, TOKEN_PROFILE_LIMIT, TOKEN_PROFILE_EXPOSED } from '../apps/extension/src/runtime/viewing/token-profiles.ts';

const address = '0x0000000000000000000000000000000000000001';
const asset = `Ethereum:${address}`;
const identity = identifyPage(`https://gmgn.ai/eth/token/${address}`, ['gmgn.ai']);
const origin = 'https://api.palside.test';
const entry = (fields = {}) => ({ chain: 'ethereum', address, name: 'Pons Token', symbol: 'PONS', decimals: 18, logo: null, logoPending: false, ...fields });
const cache = (now = { at: 0 }) => { const published = []; const tokens = new TokenProfiles(() => published.push(tokens.pick([asset])), () => now.at, origin); return { tokens, published, now }; };

test('the address placeholder is never a name, and websites are always named', () => {
  assert.equal(tokenNamed(pageView(identity)), false);
  assert.equal(pageView(identity).name, shortAddress(address));
  assert.equal(tokenNamed(pageView(identity, { name: 'PONS' })), true);
  assert.equal(tokenNamed({ kind: 'website', name: 'Example', address: undefined }), true);
  const { tokens } = cache();
  assert.equal(tokens.put(asset, { name: shortAddress(address) }), false);
  assert.equal(tokens.put(asset, { name: '$0.001' }), false);
  assert.equal(tokens.get(asset), undefined);
});

test('the directory answer replaces snapshot names, which then cannot rename it', () => {
  const { tokens, published } = cache();
  assert.equal(tokens.put(asset, { name: 'FAKE' }), true);
  assert.equal(tokens.answered(asset), false);
  assert.equal(tokens.putDirectory(asset, entry()), true);
  assert.deepEqual(tokens.get(asset), { name: 'PONS' }, 'symbol first');
  assert.equal(tokens.answered(asset), true);
  assert.equal(tokens.put(asset, { name: 'FAKE' }), false);
  assert.equal(tokens.put(asset, { name: 'FAKE', site: 'gmgn' }), true, 'a snapshot may add the usual site');
  assert.deepEqual(tokens.get(asset), { name: 'PONS', site: 'gmgn' });
  assert.equal(tokens.putDirectory(asset, entry()), false, 'identical answers do not republish');
  assert.equal(published.length, 3);
  assert.equal(tokens.putDirectory(asset, null), false, 'a missing answer keeps what is known');
});

test('directory names fall back to the full name, then the short address when the operator hid them', () => {
  const { tokens } = cache();
  tokens.putDirectory(asset, entry({ symbol: null }));
  assert.equal(tokens.get(asset).name, 'Pons Token');
  tokens.putDirectory(asset, entry({ symbol: '$0.001', name: null }));
  assert.equal(tokens.get(asset).name, shortAddress(address));
  assert.equal(tokenNamed(tokens.apply(pageView(identity, { name: 'FAKE' }))), false, 'a hidden name hides snapshot names too');
});

test('token icons come only from the directory, on the API origin with the stored version', () => {
  const { tokens } = cache();
  tokens.putDirectory(asset, entry({ logo: 3 }));
  const logo = `${origin}/tokens/logo/ethereum/${address}?v=3`;
  assert.equal(directoryLogo(origin, 'Ethereum', address, 3), logo);
  assert.deepEqual(tokens.get(asset), { name: 'PONS', logo });
  const snapshot = { ...pageView(identity, { name: 'OLD' }), id: 'message-card', logo: 'https://cdn.dexscreener.com/cms/images/old.png' };
  const card = tokens.apply(snapshot);
  assert.equal(card.name, 'PONS'); assert.equal(card.logo, logo); assert.equal(card.id, 'message-card'); assert.equal(card.url, snapshot.url);
  tokens.putDirectory(asset, entry({ logo: null }));
  assert.equal(tokens.apply(snapshot).logo, undefined, 'a snapshot icon is never shown');
  const website = { ...pageView(identity), kind: 'website' };
  assert.equal(tokens.apply(website), website);
  assert.equal(tokens.remember(pageView(identity)), false, 'placeholders are never learned');
});

test('entries expire after their lifetime and the cache keeps a bounded recent window', () => {
  const { tokens, now } = cache();
  tokens.putDirectory(asset, entry());
  now.at = TOKEN_PROFILE_TTL_MS + 1;
  assert.equal(tokens.get(asset), undefined);
  assert.equal(tokens.answered(asset), false);
  assert.equal(tokens.put(asset, { name: 'PONS' }), true, 'an expired directory answer does not block a snapshot');
  const key = n => `Ethereum:0x${n.toString(16).padStart(40, '0')}`;
  for (let n = 2; n < TOKEN_PROFILE_LIMIT + 10; n++) tokens.put(key(n), { name: `T${n}` });
  assert.equal(tokens.get(asset), undefined, 'the oldest entry leaves first');
  const wanted = Array.from({ length: TOKEN_PROFILE_LIMIT + 8 }, (_, n) => key(n + 2));
  assert.equal(Object.keys(tokens.pick(wanted)).length, TOKEN_PROFILE_EXPOSED);
  assert.deepEqual(Object.keys(tokens.pick([key(TOKEN_PROFILE_LIMIT + 9), key(1)])), [key(TOKEN_PROFILE_LIMIT + 9)], 'only requested, stored tokens travel');
});

test('clearing empties the cache and what the panel sees', () => {
  const { tokens, published } = cache();
  tokens.put(asset, { name: 'PONS' });
  tokens.clear();
  assert.equal(tokens.get(asset), undefined);
  assert.deepEqual(published.at(-1), {});
});

test('a directory answer still fetching its icon is marked pending until the icon or a settled answer replaces it', () => {
  const { tokens, published } = cache();
  assert.equal(tokens.putDirectory(asset, entry({ logoPending: true })), true);
  assert.equal(tokens.get(asset).logoPending, true, 'the panel draws the face as waiting, not as an initial');
  assert.equal(tokens.putDirectory(asset, entry({ logo: 3, logoPending: false })), true, 'the pushed icon republishes');
  assert.deepEqual([tokens.get(asset).logoPending, tokens.get(asset).logo], [undefined, directoryLogo(origin, 'Ethereum', address, 3)]);
  assert.equal(tokens.putDirectory(asset, entry({ logo: 3, logoPending: true })), false, 'an icon in hand is never pending');
  assert.equal(tokens.putDirectory(asset, entry({ logoPending: false })), true);
  assert.equal(tokens.get(asset).logoPending, undefined, 'a settled answer without an icon falls back to the initial');
  assert.ok(published.length >= 3);
});
