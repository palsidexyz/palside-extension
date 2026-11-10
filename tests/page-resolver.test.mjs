import test from 'node:test';
import assert from 'node:assert/strict';
import { PageResolver, PAGE_RETRY_MS, PAGE_TOKEN_TTL_MS } from '../apps/extension/src/runtime/viewing/page-resolver.ts';
import { pageView, validateView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { TOKEN_MISSING_RECHECK_MS } from '../packages/shared/src/rules/tokens.ts';

const evm = '0x1111111111111111111111111111111111111111';
const page = { kind: 'address', site: 'okx', host: 'web3.okx.com', url: `https://web3.okx.com/token/${evm}`, address: evm, id: evm };
const pool = { kind: 'pool', site: 'dexscreener', host: 'dexscreener.com', url: 'https://dexscreener.com/base/0x2222222222222222222222222222222222222222', chain: 'Base', pool: '0x2222222222222222222222222222222222222222', id: 'pool' };
const entry = chain => ({ chain, address: evm, symbol: 'TKN' });

test('several chains pick Robinhood first and keep every candidate; answers are cached for days', async () => {
  let now = 0, calls = 0; const answered = [];
  const resolver = new PageResolver(async () => { calls++; return { address: evm, status: 'choice', tokens: [entry('ethereum'), entry('base'), entry('robinhood')] }; }, asset => answered.push(asset), () => {}, () => now);
  assert.equal(await resolver.resolve(page), `Robinhood:${evm}`);
  assert.deepEqual(resolver.candidates(page.url), [`Robinhood:${evm}`, `Base:${evm}`, `Ethereum:${evm}`]);
  assert.equal(answered.length, 3);
  now = PAGE_TOKEN_TTL_MS - 1; await resolver.resolve(page); assert.equal(calls, 1);
  now = PAGE_TOKEN_TTL_MS; assert.equal(resolver.get(page.url), undefined); await resolver.resolve(page); assert.equal(calls, 2);
});

test('a chosen chain moves every page with that address onto it, is remembered for later lookups, and clears with the account', async () => {
  let changes = 0;
  const other = { ...page, url: `https://gmgn.ai/token/${evm}`, site: 'gmgn', host: 'gmgn.ai' };
  const resolver = new PageResolver(async () => ({ address: evm, status: 'choice', tokens: [entry('ethereum'), entry('base'), entry('robinhood')] }), () => {}, () => { changes++; });
  await resolver.resolve(page);
  assert.deepEqual(resolver.choices(), { [page.url]: [`Robinhood:${evm}`, `Base:${evm}`, `Ethereum:${evm}`] });
  assert.equal(resolver.choose(`Base:${evm}`), true);
  assert.equal(resolver.get(page.url), `Base:${evm}`);
  assert.deepEqual(resolver.choices()[page.url], [`Base:${evm}`, `Robinhood:${evm}`, `Ethereum:${evm}`], 'the current chain leads the picker');
  assert.ok(changes >= 2, 'a pick republishes page answers');
  assert.equal(await resolver.resolve(other), `Base:${evm}`, 'another page with the same address starts on the picked chain');
  assert.deepEqual(resolver.prefer([`Ethereum:${evm}`, `Robinhood:${evm}`, `Base:${evm}`]), [`Base:${evm}`, `Robinhood:${evm}`, `Ethereum:${evm}`]);
  assert.equal(resolver.choose(`Solana:${evm}`), false, 'only a candidate can be picked');
  resolver.clear();
  assert.deepEqual(resolver.prefer([`Ethereum:${evm}`, `Base:${evm}`, `Robinhood:${evm}`]), [`Robinhood:${evm}`, `Base:${evm}`, `Ethereum:${evm}`]);
});

test('missing is rechecked after ten minutes, unavailable after thirty seconds, signed out is not remembered', async () => {
  let now = 0, answer = { pool: pool.pool, status: 'missing', tokens: [] }; const items = [];
  const resolver = new PageResolver(async item => { items.push(item); return answer; }, () => {}, () => {}, () => now);
  assert.equal(await resolver.resolve(pool), null);
  assert.deepEqual(items[0], { pool: pool.pool, chain: 'base' });
  assert.deepEqual(resolver.pick(), { [pool.url]: null });
  now = TOKEN_MISSING_RECHECK_MS; answer = { pool: pool.pool, status: 'unavailable', tokens: [] };
  assert.equal(await resolver.resolve(pool), undefined); assert.deepEqual(resolver.pick(), {});
  now += PAGE_RETRY_MS - 1; await resolver.resolve(pool); assert.equal(items.length, 2);
  now += 1; answer = undefined; assert.equal(await resolver.resolve(pool), undefined); assert.equal(items.length, 3);
  await resolver.resolve(pool); assert.equal(items.length, 4);
});

test('concurrent asks share one lookup and clear drops answers still in flight', async () => {
  let release; let calls = 0;
  const resolver = new PageResolver(() => { calls++; return new Promise(done => { release = done; }); }, () => {});
  const a = resolver.resolve(page), b = resolver.resolve(page); assert.equal(calls, 1);
  resolver.clear(); release({ address: evm, status: 'token', tokens: [entry('base')] });
  assert.equal(await a, undefined); assert.equal(await b, undefined); assert.equal(resolver.get(page.url), undefined);
});

test('a shared view from a pool or contract page carries how its token was found and must match the page', () => {
  const asset = { kind: 'asset', chain: 'Base', address: evm, id: `Base:${evm}` };
  const fromPool = pageView({ ...asset, site: 'dexscreener', host: pool.host, url: pool.url }, { name: 'TKN' }, 'pool');
  assert.equal(validateView(fromPool)?.via, 'pool');
  assert.equal(validateView({ ...fromPool, chain: 'Solana', address: 'So11111111111111111111111111111111111111112' }), undefined);
  const fromAddress = pageView({ ...asset, site: 'okx', host: page.host, url: page.url }, { name: 'TKN' }, 'address');
  assert.equal(validateView(fromAddress)?.via, 'address');
  assert.equal(validateView({ ...fromAddress, address: '0x3333333333333333333333333333333333333333', id: 'Base:0x3333333333333333333333333333333333333333' }), undefined);
});

test('a partly read address shows the chains read so far and asks again soon, so an unread chain can join the choice', async () => {
  let now = 0, answer = { address: evm, status: 'unavailable', tokens: [entry('base')] }; const items = [];
  const resolver = new PageResolver(async item => { items.push(item); return answer; }, () => {}, () => {}, () => now);
  assert.equal(await resolver.resolve(page), `Base:${evm}`);
  now += PAGE_RETRY_MS - 1; await resolver.resolve(page); assert.equal(items.length, 1);
  now += 1; answer = { address: evm, status: 'choice', tokens: [entry('base'), entry('bnb')] };
  await resolver.resolve(page);
  assert.deepEqual(resolver.candidates(page.url), [`Base:${evm}`, `BNB Chain:${evm}`]);
});
