import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenDirectoryClient, TOKEN_LOGO_POLL_MS, TOKEN_RETRY_MS, TOKEN_RETRY_MAX_MS } from '../apps/extension/src/runtime/viewing/token-directory.ts';
import { TOKEN_MISSING_RECHECK_MS, TOKEN_RESOLVE_LIMIT } from '../packages/shared/src/rules/tokens.ts';
import { MINUTE_MS } from '../packages/shared/src/units.ts';

const evm = n => `0x${n.toString(16).padStart(40, '0')}`;
const token = (chain, address, fields = {}) => ({ chain, address, name: 'Token', symbol: 'TKN', decimals: 18, logo: null, logoPending: false, ...fields });
const settle = () => new Promise(resolve => setImmediate(resolve));

/** A fake directory: every address is a token unless listed in `missing`, `pending` or `failing`. */
function setup({ missing = new Set(), pending = new Set(), failing = { on: false }, held = () => true, now = { at: 0 }, stream = { open: false } } = {}) {
  const requests = [], answers = new Map(), failed = [];
  const client = new TokenDirectoryClient(async items => {
    requests.push(items);
    if (failing.on) throw new Error('offline');
    return items.map(({ address, chain }) => missing.has(address) ? { address, chain, status: 'missing', tokens: [] }
      : { address, chain, status: 'token', tokens: [token(chain, address, pending.has(address) ? { logoPending: true } : { logo: 1 })] });
  }, batch => { for (const [asset, entry] of batch) answers.set(asset, entry); }, held, () => now.at, assets => failed.push(...assets), () => stream.open);
  return { client, requests, answers, now, failed };
}

test('shown assets are asked for once, in batches of at most the resolve limit, with the wire chain id', async () => {
  const { client, requests, answers } = setup();
  const assets = Array.from({ length: TOKEN_RESOLVE_LIMIT + 5 }, (_, n) => `Robinhood:${evm(n + 1)}`);
  client.show(assets); client.show(assets);
  await Promise.all(assets.map(asset => client.ensure(asset)));
  assert.deepEqual(requests.map(batch => batch.length), [TOKEN_RESOLVE_LIMIT, 5]);
  assert.equal(requests[0][0].chain, 'robinhood');
  assert.equal(answers.size, assets.length);
  client.show(assets); await settle();
  assert.equal(requests.length, 2, 'known answers are not asked again');
  client.show(['Solana:So11111111111111111111111111111111111111112', 'not-an-asset']); await settle();
  assert.deepEqual(requests.at(-1), [{ address: 'So11111111111111111111111111111111111111112', chain: 'solana' }]);
});

test('an icon still being stored is asked for again at 3, 10 and 30 seconds while shown, then left', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const address = evm(1), asset = `Base:${address}`;
  const { client, requests } = setup({ pending: new Set([address]) });
  client.show([asset]); await client.ensure(asset);
  for (const delay of TOKEN_LOGO_POLL_MS) { t.mock.timers.tick(delay); await settle(); await settle(); }
  assert.equal(requests.length, 1 + TOKEN_LOGO_POLL_MS.length);
  t.mock.timers.tick(MINUTE_MS); await settle();
  assert.equal(requests.length, 1 + TOKEN_LOGO_POLL_MS.length);
  const hidden = setup({ pending: new Set([address]) });
  hidden.client.show([asset]); await hidden.client.ensure(asset); hidden.client.show([]);
  t.mock.timers.tick(TOKEN_LOGO_POLL_MS[0]); await settle();
  assert.equal(hidden.requests.length, 1, 'a token that left the screen is not polled');
});

test('not-a-token answers wait for the recheck window; failures retry while shown and keep snapshot names', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const address = evm(2), asset = `Ethereum:${address}`;
  const missing = setup({ missing: new Set([address]) });
  missing.client.show([asset]); await missing.client.ensure(asset);
  assert.equal(missing.answers.get(asset), null);
  missing.client.show([]); missing.client.show([asset]); await settle();
  assert.equal(missing.requests.length, 1);
  missing.now.at = TOKEN_MISSING_RECHECK_MS + 1; missing.client.show([]); missing.client.show([asset]); await missing.client.ensure(asset);
  assert.equal(missing.requests.length, 2);

  const failing = { on: true };
  const offline = setup({ failing });
  offline.client.show([asset]); await offline.client.ensure(asset);
  assert.equal(offline.answers.size, 0, 'a failure answers nothing, so the snapshot name stays');
  failing.on = false; t.mock.timers.tick(TOKEN_RETRY_MS * 1.2); await settle(); await settle();
  assert.equal(offline.requests.length, 2);
  assert.ok(offline.answers.get(asset));
});

test('clearing drops answers in flight, and an evicted answer is asked for again', async () => {
  const address = evm(3), asset = `BNB Chain:${address}`;
  const { client, requests, answers } = setup();
  client.show([asset]); const pending = client.ensure(asset); client.clear(); await pending; await settle();
  assert.equal(answers.size, 0);
  let reply; const late = [];
  const slow = new TokenDirectoryClient(items => new Promise(resolve => { reply = () => resolve(items.map(({ address, chain }) => ({ address, chain, status: 'token', tokens: [token(chain, address)] }))); }), batch => late.push(batch), () => true);
  slow.show([asset]); await settle(); slow.clear(); reply(); await settle();
  assert.equal(late.length, 0, 'an answer arriving after clear is dropped');
  let held = true;
  const evicting = setup({ held: () => held });
  evicting.client.show([asset]); await evicting.client.ensure(asset);
  evicting.client.show([asset]); await settle();
  assert.equal(evicting.requests.length, 1);
  held = false; evicting.client.show([asset]); await evicting.client.ensure(asset);
  assert.equal(evicting.requests.length, 2);
  assert.equal(requests.length, 0, 'cleared before the batch was sent');
});

test('signed out: nothing is remembered or retried, and the next show after sign-in asks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], answers = new Map(), session = { on: false };
  const client = new TokenDirectoryClient(async items => {
    requests.push(items);
    if (!session.on) return undefined;
    return items.map(({ address, chain }) => ({ address, chain, status: 'token', tokens: [token(chain, address, { logo: 1 })] }));
  }, batch => { for (const [asset, entry] of batch) answers.set(asset, entry); }, () => answers.size > 0, () => 0);
  const asset = `Base:${evm(1)}`;
  client.show([asset]); await client.ensure(asset);
  assert.equal(requests.length, 1); assert.equal(answers.size, 0);
  t.mock.timers.tick(TOKEN_RETRY_MS * 4); await settle();
  assert.equal(requests.length, 1, 'no retry timer while signed out');
  session.on = true; client.show([asset]); await client.ensure(asset);
  assert.equal(requests.length, 2); assert.equal(answers.size, 1);
});

test('a logo the server pushed while an older ask was out is not undone by that ask', async () => {
  const address = evm(7), asset = `Base:${address}`, answers = new Map();
  let reply;
  const client = new TokenDirectoryClient(items => new Promise(resolve => { reply = () => resolve(items.map(({ address, chain }) => ({ address, chain, status: 'token', tokens: [token(chain, address, { logoPending: true })] }))); }), batch => { for (const [key, entry] of batch) answers.set(key, entry); }, () => true);
  const done = client.ensure(asset); await settle();
  client.push([token('base', address, { logo: 1 })]);
  reply(); await done; await settle();
  assert.equal(answers.get(asset).logo, 1);
  assert.equal(answers.get(asset).logoPending, false);
});

test('only a failed ask or an unreadable address reports the asset as unknown; a missing answer is an answer', async () => {
  const failing = { on: true }, gone = evm(2);
  const { client, answers, failed } = setup({ failing, missing: new Set([gone]) });
  const asset = `Base:${evm(1)}`;
  client.show([asset, 'not-an-asset']); await client.ensure(asset); await settle();
  assert.deepEqual(failed.sort(), [asset, 'not-an-asset'].sort());
  failing.on = false; failed.length = 0;
  client.show([`Base:${gone}`]); await client.ensure(`Base:${gone}`);
  assert.equal(answers.get(`Base:${gone}`), null);
  assert.deepEqual(failed, []);
});

test('with the event stream open a pending icon waits for its push; a reopened stream asks once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const address = evm(7), asset = `Base:${address}`, stream = { open: true };
  const { client, requests } = setup({ pending: new Set([address]), stream });
  client.show([asset]); await client.ensure(asset);
  for (const delay of TOKEN_LOGO_POLL_MS) { t.mock.timers.tick(delay); await settle(); }
  assert.equal(requests.length, 1, 'no polling while pushes can arrive');
  client.resume(); await settle(); await settle();
  assert.equal(requests.length, 2, 'the stream came back: pushes sent meanwhile are asked for once');
  client.push([token('base', address, { logo: 1 })]); client.resume(); await settle();
  assert.equal(requests.length, 2, 'a pushed icon is not pending');
});

test('a failed batch is retried as one request with growing waits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failing = { on: true };
  const { client, requests } = setup({ failing });
  const assets = [1, 2, 3].map(n => `Base:${evm(100 + n)}`);
  client.show(assets); await Promise.all(assets.map(asset => client.ensure(asset)));
  assert.equal(requests.length, 1);
  t.mock.timers.tick(TOKEN_RETRY_MS * 1.2); await settle(); await settle();
  assert.deepEqual(requests.map(batch => batch.length), [3, 3], 'the retry asks for the whole batch at once');
  t.mock.timers.tick(TOKEN_RETRY_MS * 1.2); await settle();
  assert.equal(requests.length, 2, 'the second wait is longer than the first');
  t.mock.timers.tick(TOKEN_RETRY_MAX_MS); await settle(); await settle();
  assert.equal(requests.length, 3);
});
