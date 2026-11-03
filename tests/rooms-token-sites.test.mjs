import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTokenSite, tokenSites, HOT_CHAIN_ORDER } from '../apps/extension/src/runtime/rooms/token-sites.ts';

const token = { chain: 'Ethereum', address: '0x39dbed3a2bd333467115de45665cc57f813c4571' };
test('default token site uses last choice, participant majority, then GMGN, skipping unsupported chains', () => {
  assert.equal(defaultTokenSite(token, 'birdeye', 'gmgn').id, 'birdeye');
  assert.equal(defaultTokenSite(token, 'axiom', 'bullx').id, 'bullx');
  assert.equal(defaultTokenSite(token, undefined, 'unknown').id, 'gmgn');
  const robinhood = { ...token, chain: 'Robinhood' };
  assert.deepEqual(tokenSites(robinhood).map(site => site.id), ['gmgn', 'fomo']);
  assert.equal(defaultTokenSite(robinhood, 'bullx', 'fomo').id, 'fomo');
  assert.equal(defaultTokenSite(robinhood, 'birdeye', 'bullx').id, 'gmgn');
  assert.ok(tokenSites(token).every(site => site.url.startsWith('https://')));
  assert.deepEqual(HOT_CHAIN_ORDER, [null, 'Robinhood', 'Solana', 'BNB Chain', 'Base', 'Ethereum']);
});
