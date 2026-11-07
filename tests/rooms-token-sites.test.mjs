import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTokenSite, tokenSites, HOT_CHAIN_ORDER } from '../apps/extension/src/runtime/rooms/token-sites.ts';

const token = { chain: 'Ethereum', address: '0x39dbed3a2bd333467115de45665cc57f813c4571' };
test('default token site uses last choice, participant majority, then GMGN, skipping sites without that chain', () => {
  assert.equal(defaultTokenSite(token, 'birdeye', 'gmgn').id, 'birdeye');
  assert.equal(defaultTokenSite(token, 'axiom', 'bullx').id, 'axiom');
  assert.equal(defaultTokenSite(token, 'unknown', 'bullx').id, 'bullx');
  assert.equal(defaultTokenSite(token, undefined, 'unknown').id, 'gmgn');
  const robinhood = { ...token, chain: 'Robinhood' };
  assert.deepEqual(tokenSites(robinhood).map(site => site.id), ['gmgn', 'axiom', 'dexscreener', 'fomo']);
  assert.equal(tokenSites(robinhood).find(site => site.id === 'axiom').url, `https://axiom.trade/token/${token.address}?chain=robinhood`);
  assert.equal(tokenSites(robinhood).find(site => site.id === 'dexscreener').url, `https://dexscreener.com/robinhood/${token.address}`);
  assert.equal(defaultTokenSite(robinhood, 'bullx', 'fomo').id, 'fomo');
  assert.equal(defaultTokenSite(robinhood, 'birdeye', 'bullx').id, 'gmgn');
  assert.ok(tokenSites(token).every(site => site.url.startsWith('https://')));
  assert.deepEqual(HOT_CHAIN_ORDER, [null, 'Robinhood', 'Solana', 'BNB Chain', 'Base', 'Ethereum']);
});
