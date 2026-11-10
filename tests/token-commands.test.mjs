import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';

const load = productionModules();
const { tokenHandlers } = load('apps/extension/src/runtime/viewing/token-commands.ts');
const { PageResolver } = load('apps/extension/src/runtime/viewing/page-resolver.ts');
const { TokenProfiles } = load('apps/extension/src/runtime/viewing/token-profiles.ts');
const { TokenDirectoryClient } = load('apps/extension/src/runtime/viewing/token-directory.ts');

const evm = '0x41c45e2b9a7f03dd4c8e8e1f6a2b11c0e17c9e2a';
const entry = (chain, symbol = 'PONS') => ({ chain, address: evm, name: 'Pons', symbol, decimals: 18, logo: null, logoPending: false });

function runtime(answer) {
  const calls = [];
  const rt = {
    calls, emits: 0,
    auth: { session: { token: 't', account: { id: 'self' } } },
    state: { preferences: {} },
    tokens: new TokenProfiles(() => {}, () => 0, 'https://api.test'),
    pages: new PageResolver(async () => undefined, () => {}),
    api: { request: async (id, input) => { calls.push([id, input]); return answer(id, input); } },
    emit() { rt.emits++; },
  };
  rt.directory = new TokenDirectoryClient(async items => (await rt.api.request('tokens.resolve', { body: { items }, token: 't' })).items,
    answers => { for (const [asset, value] of answers) rt.tokens.putDirectory(asset, value); }, asset => rt.tokens.answered(asset));
  return rt;
}
const plain = value => JSON.parse(JSON.stringify(value));
const run = (rt, name, payload) => tokenHandlers[name].call({ runtime: rt }, { name, payload });

test('a pasted address becomes a token card on the preferred chain, links to the default token site and lists every chain', async () => {
  const rt = runtime(() => ({ items: [{ address: evm, status: 'choice', tokens: [entry('ethereum'), entry('base', 'PBASE')] }] }));
  const result = await run(rt, 'token-card', { address: evm });
  assert.deepEqual(plain(rt.calls[0]), ['tokens.resolve', { body: { items: [{ address: evm }] }, token: 't' }]);
  assert.deepEqual(plain(result.candidates), [`Base:${evm}`, `Ethereum:${evm}`]);
  assert.equal(result.attachment.kind, 'asset');
  assert.equal(result.attachment.assetId, result.attachment.view.id);
  assert.equal(result.attachment.view.name, 'PBASE');
  assert.equal(result.attachment.view.chain, 'Base');
  assert.match(result.attachment.view.url, /^https:\/\/gmgn\.ai\//);
  await rt.directory.ensure(`Base:${evm}`); await rt.directory.ensure(`Ethereum:${evm}`);
  assert.equal(rt.calls.length, 1, 'the card answer serves the token directory too');
  const picked = await run(rt, 'token-card', { address: evm, asset: `Ethereum:${evm}` });
  assert.equal(picked.attachment.view.chain, 'Ethereum');
  assert.deepEqual(plain(picked.candidates), [`Ethereum:${evm}`, `Base:${evm}`], 'the pick is remembered for the address');
  assert.equal(rt.calls.length, 1, 'switching chain reuses the resolved address');
});

test('no card for text that is not an address, a non-token, a failed lookup or a signed-out runtime', async () => {
  const missing = runtime(() => ({ items: [{ address: evm, status: 'missing', tokens: [] }] }));
  assert.deepEqual(plain(await run(missing, 'token-card', { address: evm })), { candidates: [] });
  const words = runtime(() => { throw new Error('must not ask'); });
  assert.deepEqual(plain(await run(words, 'token-card', { address: 'hello world' })), { candidates: [] });
  const down = runtime(() => { throw new Error('offline'); });
  assert.deepEqual(plain(await run(down, 'token-card', { address: evm })), { candidates: [] });
  const out = runtime(() => { throw new Error('must not ask'); }); out.auth.session = undefined;
  assert.deepEqual(plain(await run(out, 'token-card', { address: evm })), { candidates: [] });
});

test('热门 search sends the query, keeps the rows as token records for panel state, and an empty query clears them', async () => {
  const rt = runtime(() => ({ rows: [entry('base'), entry('robinhood')] }));
  const { assets } = await run(rt, 'token-search', { q: ' pon ' });
  assert.deepEqual(plain(rt.calls[0]), ['tokens.search', { query: { q: 'pon' }, token: 't' }]);
  assert.deepEqual(plain(assets), [`Base:${evm}`, `Robinhood:${evm}`], 'name matches keep the server order');
  assert.deepEqual(plain(rt.state.searchAssets), assets);
  assert.equal(rt.tokens.get(`Base:${evm}`)?.name, 'PONS');
  const byAddress = await run(rt, 'token-search', { q: evm });
  assert.deepEqual(plain(byAddress.assets), [`Robinhood:${evm}`, `Base:${evm}`], 'an address answers in chain order');
  await run(rt, 'token-search', { q: '' });
  assert.equal(rt.state.searchAssets, undefined);
});
