import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { sealMnemonic, deriveIdentity } from '../packages/shared/src/identity.ts';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, hashMessage, keccak256 } from 'viem';
import { redPacketAbi } from '../packages/shared/src/chain/generated.ts';
import { orderCalls, orderFingerprint } from '../packages/shared/src/chain/orders.ts';
import { relayBatchAbi, relayOperationHash, verifyRelaySignatures } from '../packages/shared/src/chain/signing.ts';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/src/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { WalletKeys, deriveWalletAccount } = await import('../apps/extension/src/runtime/wallet/keys.ts');
const { createPacketInput } = await import('../apps/extension/src/runtime/wallet/packets.ts');
const { signWalletBinding, verifyWalletBinding } = await import('../apps/extension/src/runtime/wallet/binding.ts');
const { WalletLocalState } = await import('../apps/extension/src/runtime/wallet/local-state.ts');
const { unlockLocalMnemonic } = await import('../apps/extension/src/runtime/account/local-password.ts');
const { WalletController } = await import('../apps/extension/src/runtime/wallet/controller.ts');
const { parseCommand } = await import('../apps/extension/src/runtime/transport/command-map.ts');
const { walletHandlers } = await import('../apps/extension/src/runtime/wallet/command-handlers.ts');
const { WalletRuntime } = await import('../apps/extension/src/runtime/wallet/runtime.ts');
const { receiveRequest, checkTransferAddress } = await import('../apps/extension/src/runtime/wallet/receive.ts');
const { parsePals } = await import('../apps/extension/src/domain/wallet/model.ts');
const { walletDeadlines } = await import('../apps/extension/src/features/palside/wallet/clock.ts');
const { recoveryLabel } = await import('../apps/extension/src/features/palside/wallet/recovery-state.ts');
hooks.deregister();
const mnemonic = 'test test test test test test test test test test test junk'; // Public viem/anvil fixture only.
const address = deriveWalletAccount(mnemonic).address;
const recipient = '0x1111111111111111111111111111111111111111';
const deployment = { chainId: 4663, token: '0x2222222222222222222222222222222222222222', packetContract: '0x4444444444444444444444444444444444444444', decimals: 18 };
const unit = 10n ** 18n;
function host() {
  const values = new Map(), tails = new Map();
  const storage = { async get(key) { return structuredClone(values.get(key)); }, async put(key, _account, _kind, value) { values.set(key, structuredClone(value)); } };
  const locks = { request(name, fn) { const result = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(fn); tails.set(name, result); return result; } };
  return { storage, locks, values };
}
const paymentOwner = f => ({ accountId: 'self', paymentId: f.controller.snapshot().payment.id });
function fixture(t) {
  const local = host(); let now = 1_800_000_000_000, signed = 0, submits = 0;
  const config = { enabled: true, version: 1, deployment, dailySponsoredLimit: 20, updatedAt: now };
  let order;
  const keys = { unlocked: true, async unlock(password) { if (password !== '123456') throw Object.assign(new Error('WRONG_PASSWORD'), { code: 'WRONG_PASSWORD' }); return address; }, async sign(_envelope, expectation) { assert.equal(expectation.account, address); signed++; return { requestId: 'request', signatures: [] }; }, dispose() {} };
  const api = {
    async config() { return structuredClone(config); },
    async price() { return null; },
    async balance() { return { token: deployment.token, chainId: deployment.chainId, address, balance: String(10_000n * unit), blockNumber: '1' }; },
    async records() { return { items: [], nextCursor: null }; },
    async recovery() { return { items: [], nextCursor: null }; },
    async quote(input) { order = { id: '0x' + 'a'.repeat(64), accountId: 'self', payer: address, recipient, kind: input.kind, status: 'quoted', amount: input.amount ?? input.packet.amounts.reduce((total, amount) => total + BigInt(amount), 0n).toString(), createdAt: now, expiresAt: now + 300000, confirmedAt: null, transactionHash: null, configVersion: 1, deployment, payload: input }; return structuredClone(order); },
    async order() { return structuredClone(order); },
    async prepare() { return { requestId: 'request', orderId: order.id, state: 'prepared', envelope: { fee: { mode: 'sponsored' }, orderAuthorization: {} }, transactionHash: null, error: null }; },
    async submit() { submits++; order.status = 'submitted'; return { requestId: 'request', orderId: order.id, state: 'submitted', envelope: null, transactionHash: null, error: null }; },
    async status() { return { requestId: 'request', orderId: order.id, state: 'submitted', envelope: null, transactionHash: null, error: null }; },
    async cancel() { return { requestId: 'request', orderId: order.id, state: 'cancelled', envelope: null, transactionHash: null, error: null }; },
  };
  const controller = new WalletController({ ...local, accountId: 'self', address, api, keys, now: () => now, check() {}, validateRecipient: async () => {} });
  t.after(() => controller.dispose());
  return { ...local, controller, api, keys, config, counts: () => ({ signed, submits }), order: () => order, advance(ms) { now += ms; } };
}
test('wallet derives the public standard Ethereum fixture, distinct from NIP-06 identity', () => {
  assert.equal(address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(parsePals('250.000000000000000001', 18), 250n * unit + 1n);
  assert.throws(() => parsePals('1e3', 18));
  assert.throws(() => parsePals('0.0000000000000000001', 18));
});
test('receive URI uses the current PALS chain and transfer recipients exclude self and contracts', () => {
  assert.equal(receiveRequest(address), address);
  assert.equal(receiveRequest(address, deployment, String(2n * unit)), `ethereum:${deployment.token}@${deployment.chainId}/transfer?address=${address}&uint256=${2n * unit}`);
  assert.doesNotThrow(() => checkTransferAddress(recipient, address, deployment));
  assert.throws(() => checkTransferAddress(address, address, deployment), /SELF_TRANSFER/);
  assert.throws(() => checkTransferAddress(deployment.token, address, deployment), /CONTRACT_RECIPIENT/);
  assert.throws(() => checkTransferAddress(deployment.packetContract, address, deployment), /CONTRACT_RECIPIENT/);
});
test('small payments default off and atomic reservations cap concurrent windows at 1000 PALS', async () => {
  const h = host(), a = new WalletLocalState(h.storage, 'self', () => {}, h.locks), b = new WalletLocalState(h.storage, 'self', () => {}, h.locks);
  assert.equal(await a.canSkip({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) }, unit, 18), false);
  await a.setPreferences({ smallPayments: true });
  assert.equal(await a.reserve('address', { kind: 'transfer', recipient, amount: String(unit) }, unit, 18), false);
  assert.equal(await a.reserve('large', { kind: 'tip', messageId: 'message', amount: String(250n * unit + 1n) }, 250n * unit + 1n, 18), false);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).reserve(String(i), { kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(250n * unit) }, 250n * unit, 18)));
  assert.equal(results.filter(Boolean).length, 4);
  assert.equal(await b.reserve('0', { kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(250n * unit) }, 250n * unit, 18), false);
  await a.release('0');
  assert.equal(await b.reserve('new', { kind: 'tip', messageId: 'message', amount: String(250n * unit) }, 250n * unit, 18), true);
});
test('local password failures are shared, persisted, and lock for fifteen minutes', async () => {
  const h = host(); let now = 1000;
  await h.storage.put('vault', 'self', 'vault', await sealMnemonic(mnemonic, '123456'));
  const unlock = password => unlockLocalMnemonic({ ...h, accountId: 'self', password, check() {}, now: () => now });
  for (let i = 0; i < 4; i++) await assert.rejects(unlock('000000'), { code: 'WRONG_PASSWORD' });
  await assert.rejects(unlock('000000'), { code: 'PASSWORD_LOCKED', lockedUntil: 901000 });
  await assert.rejects(unlock('123456'), { code: 'PASSWORD_LOCKED' });
  now = 901001;
  assert.equal(await unlock('123456'), mnemonic);
});
test('private-key reveal belongs to one window and expires after thirty seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const h = host(); await h.storage.put('vault', 'self', 'vault', await sealMnemonic(mnemonic, '123456'));
  const keys = new WalletKeys({ ...h, accountId: 'self', check() {} });
  t.after(() => keys.dispose());
  const reveal = await keys.reveal('123456', 'window-a');
  assert.equal(reveal.privateKey.length, 66);
  assert.equal(reveal.expiresAt, 31000);
  keys.hide('window-b');
  assert.equal(keys.exported.key, reveal.privateKey);
  t.mock.timers.tick(29999);
  assert.equal(keys.exported.key, reveal.privateKey);
  t.mock.timers.tick(1);
  assert.equal(keys.exported, undefined);
  assert.equal(keys.timer, undefined);
  assert.equal(keys.exposureOwner, undefined);
  keys.dispose(); assert.equal(keys.unlocked, false);
});
test('address transfer always asks password even with enabled small payments', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.setSmallPayments(true, '123456');
  const reviewed = await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  assert.equal(reviewed.passwordRequired, true);
  assert.equal((await f.controller.confirm(paymentOwner(f))).phase, 'password');
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
  await f.controller.confirm(paymentOwner(f), '123456');
  assert.deepEqual(f.counts(), { signed: 1, submits: 1 });
});
test('submit timeout remains pending and is reconciled without duplicate signing', async t => {
  const f = fixture(t); await f.controller.start();
  f.api.submit = async () => { f.order().status = 'submitted'; throw Object.assign(new Error('RESULT_UNKNOWN'), { code: 'RESULT_UNKNOWN' }); };
  await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  assert.equal((await f.controller.confirm(paymentOwner(f), '123456')).phase, 'pending');
  await assert.rejects(f.controller.confirm(paymentOwner(f), '123456'), /PAYMENT_BUSY/);
  f.order().status = 'confirmed';
  assert.equal((await f.controller.reconcile()).phase, 'confirmed');
  assert.equal(f.counts().signed, 1);
});
test('a successful receipt finishes the payment for the payer while the order still waits for the index', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  assert.equal((await f.controller.confirm(paymentOwner(f), '123456')).phase, 'pending');
  f.api.status = async () => ({ requestId: 'request', orderId: f.order().id, state: 'included', envelope: null, transactionHash: '0x' + 'c'.repeat(64), error: null });
  const done = await f.controller.reconcile();
  assert.equal(done.phase, 'confirmed'); assert.equal(done.order.status, 'submitted');
  assert.equal(recoveryLabel({ order: { status: 'submitted' }, relay: { state: 'included' } }), 'recoveryIndexing');
  // A later index confirmation does not reopen or alter the finished payment.
  f.order().status = 'confirmed'; assert.equal((await f.controller.reconcile()).phase, 'confirmed');
});
test('changed quote amount, payout address, or account is rejected before signing', async t => {
  for (const tamper of [order => order.amount = String(2n * unit), order => order.recipient = deployment.token, order => order.accountId = 'other']) {
    const f = fixture(t); await f.controller.start();
    const quote = f.api.quote;
    f.api.quote = async (...args) => { const order = await quote(...args); tamper(order); return order; };
    await assert.rejects(f.controller.review({ kind: 'transfer', recipient, amount: String(unit) }));
    assert.equal(f.counts().signed, 0);
  }
});
test('emergency disable during prepare prevents signature and submission', async t => {
  const f = fixture(t); await f.controller.start();
  const prepare = f.api.prepare;
  f.api.prepare = async () => { await f.controller.applyConfig({ ...f.config, enabled: false, version: 2 }); return prepare(); };
  await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  await assert.rejects(f.controller.confirm(paymentOwner(f), '123456'), /CHAIN_DISABLED/);
  assert.equal(f.counts().signed, 0);
});
test('closed wallet opens once across windows and ignores stale config events', async t => {
  const f = fixture(t); f.config.enabled = false; await f.controller.start();
  assert.equal(f.controller.snapshot().availability, 'closed');
  await f.controller.applyConfig({ ...f.config, enabled: true, version: 2 });
  assert.equal(f.controller.snapshot().openedNotice, true);
  f.controller.acknowledgeOpened();
  await f.controller.applyConfig({ ...f.config, enabled: false, version: 1 });
  assert.equal(f.controller.snapshot().config.enabled, true);
  await f.controller.applyConfig({ ...f.config, enabled: true, version: 3 });
  assert.equal(f.controller.snapshot().openedNotice, false);
});
test('failed refresh retains last verified balance and disables spending', async t => {
  const f = fixture(t); await f.controller.start();
  const balance = f.controller.snapshot().balance;
  f.api.balance = async () => { throw new Error('INDEX_UNAVAILABLE'); };
  await f.controller.refresh();
  assert.deepEqual(f.controller.snapshot().balance, balance);
  assert.equal(f.controller.snapshot().availability, 'offline');
  await assert.rejects(f.controller.review({ kind: 'transfer', recipient, amount: String(unit) }), /CHAIN_DISABLED/);
});
test('USD fraction remains exact and missing price does not disable PALS balances', async t => {
  const f = fixture(t);
  const price = { numerator: '900719925474099312345', denominator: '1000000000000000000', currency: 'USD', source: 'pool', blockNumber: '1', updatedAt: Date.now() };
  f.api.price = async () => price;
  await f.controller.start(); assert.deepEqual(f.controller.snapshot().price, price);
  f.api.price = async () => { throw new Error('PRICE_UNAVAILABLE'); };
  await f.controller.refresh();
  assert.equal(f.controller.snapshot().price, null); assert.equal(f.controller.snapshot().availability, 'ready');
});
test('a late balance response cannot re-enable an emergency-disabled wallet', async t => {
  const f = fixture(t); await f.controller.start();
  let resolve;
  const balance = await f.api.balance(); f.api.balance = () => new Promise(done => { resolve = done; });
  const refreshing = f.controller.refresh();
  while (!resolve) await Promise.resolve();
  await f.controller.applyConfig({ ...f.config, enabled: false, version: 2 });
  resolve(balance); await refreshing;
  assert.equal(f.controller.snapshot().availability, 'closed');
});
test('panel disconnect during PIN decryption cancels private-key exposure', async () => {
  const h = host(); await h.storage.put('vault', 'self', 'vault', await sealMnemonic(mnemonic, '123456'));
  const keys = new WalletKeys({ ...h, accountId: 'self', check() {} });
  const revealing = keys.reveal('123456', 'window'); keys.hide('window');
  await assert.rejects(revealing, /PRIVATE_KEY_EXPOSURE_CANCELLED/); keys.dispose();
});
test('wallet startup respects owner-bound private-key cancellation', async t => {
  for (const action of ['disconnect', 'hide', 'offline', 'reset', 'other-window', 'none']) {
    await t.test(action, async t => {
      const h = host(), entered = Promise.withResolvers(), released = Promise.withResolvers();
      const get = h.storage.get;
      h.storage.get = async key => {
        if (key === 'self:wallet-address') { entered.resolve(); await released.promise; return address; }
        return get(key);
      };
      const runtime = { storage: h.storage, auth: { session: { account: { id: 'self' } }, scope: () => ({ check() {} }) }, state: { data: { people: [] } }, emit() {}, api: { request: async name => {
        if (name === 'chain.config') return { enabled: false, version: 1, deployment: null };
        if (name === 'chain.recovery') return { items: [], nextCursor: null };
        throw new Error(`Unexpected request: ${name}`);
      } } };
      const wallet = new WalletRuntime(runtime); runtime.wallet = wallet;
      t.after(() => wallet.reset());
      const exposure = { id: 'exposure', expiresAt: 31000, privateKey: 'synthetic-key' };
      const reveal = t.mock.method(WalletKeys.prototype, 'reveal', async () => exposure);
      const revealing = wallet.reveal('123456', 'window-a');
      const cancelled = ['disconnect', 'hide', 'offline', 'reset'].includes(action);
      const result = cancelled ? assert.rejects(revealing, action === 'reset' ? /WALLET_SESSION_CHANGED/ : /PRIVATE_KEY_EXPOSURE_CANCELLED/) : revealing;
      await entered.promise;
      if (action === 'disconnect') await walletHandlers['wallet-panel-drop'].call({ runtime }, { payload: { owner: 'window-a' } });
      if (action === 'hide') wallet.hide();
      if (action === 'offline') await wallet.offline();
      if (action === 'reset') wallet.reset();
      if (action === 'other-window') wallet.hide('window-b');
      released.resolve();
      const value = await result;
      assert.equal(reveal.mock.callCount(), cancelled ? 0 : 1);
      if (!cancelled) assert.deepEqual(value, exposure);
    });
  }
});
test('config disable during balance persistence cannot publish ready availability', async t => {
  const f = fixture(t); await f.controller.start();
  const entered = Promise.withResolvers(), released = Promise.withResolvers(), states = [];
  const put = f.storage.put;
  f.storage.put = async (...args) => {
    if (args[2] === 'wallet-balance') { entered.resolve(); await released.promise; }
    return put(...args);
  };
  f.controller.options.onChange = state => states.push(state);
  const refreshing = f.controller.refresh();
  await entered.promise;
  states.length = 0;
  await f.controller.handleEvent({ type: 'config', config: { ...f.config, enabled: false, version: 2 } });
  released.resolve(); await refreshing;
  assert.equal(f.controller.snapshot().availability, 'closed');
  assert.ok(states.length > 0);
  assert.ok(states.every(state => state.availability === 'closed'));
});
test('newer refresh wins when an older balance write finishes last', async t => {
  const f = fixture(t); await f.controller.start();
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  const put = f.storage.put; let first = true;
  f.storage.put = async (...args) => {
    if (args[2] === 'wallet-balance' && first) { first = false; entered.resolve(); await released.promise; }
    return put(...args);
  };
  const refreshing = f.controller.refresh();
  await entered.promise;
  const balance = { ...await f.api.balance(), balance: String(9000n * unit), blockNumber: '2' };
  f.api.balance = async () => balance;
  await f.controller.refresh();
  released.resolve(); await refreshing;
  assert.deepEqual(f.controller.snapshot().balance, balance);
});
test('SSE cannot replace the amount or destination of the reviewed order', async t => {
  const f = fixture(t); await f.controller.start();
  const payment = await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(5n * unit) });
  await assert.rejects(f.controller.handleEvent({ type: 'order', accountId: 'self', order: { ...payment.order, amount: String(500n * unit) } }), /ORDER_MISMATCH/);
  assert.equal(f.controller.snapshot().payment.order.amount, String(5n * unit));
});
test('storage failure after a signature never releases small-payment allowance', async t => {
  const f = fixture(t); await f.controller.start(); await f.controller.setSmallPayments(true, '123456');
  const payment = await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(250n * unit) });
  const put = f.storage.put; let failed = false;
  f.storage.put = async (...args) => { if (args[3]?.phase === 'submitting' && !failed) { failed = true; throw new Error('STORAGE_FAILED'); } return put(...args); };
  await assert.rejects(f.controller.confirm(paymentOwner(f)), /STORAGE_FAILED/);
  assert.equal(f.counts().signed, 1);
  assert.equal(f.values.get('self:wallet-local').reservations[payment.id].amount, String(250n * unit));
});
test('tips transfer the full displayed debit to the author', async t => {
  for (const input of [{ kind: 'tip', messageId: 'message', amount: String(50n * unit) }]) {
    const f = fixture(t); await f.controller.start();
    const payment = await f.controller.review(input);
    assert.equal(payment.total, String(50n * unit));
    const calls = orderCalls(payment.order, {});
    assert.equal(calls.length, 1); assert.equal(calls[0].to, deployment.token);
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: calls[0].data }), { functionName: 'transfer', args: [recipient, 50n * unit] });
    const original = f.api.prepare;
    f.api.prepare = async (id, key) => { assert.match(key, /^[A-Za-z0-9_-]{16,100}$/); return original(id, key); };
    await f.controller.confirm(paymentOwner(f), '123456');
    assert.equal(f.counts().signed, 1);
  }
});
function signingEnvelope(order, authorization = {}, operationCalls = orderCalls(order, authorization)) {
  const calls = orderCalls(order, authorization);
  const expected = { orderId: order.id, orderFingerprint: orderFingerprint(order, calls), account: address, chainId: deployment.chainId, calls };
  const request = { type: 'user-operation-v070', chainId: deployment.chainId, data: { sender: address, nonce: '0', callData: encodeFunctionData({ abi: relayBatchAbi, functionName: 'executeBatch', args: [operationCalls.map(call => ({ target: call.to, value: BigInt(call.value), data: call.data }))] }), callGasLimit: '100000', verificationGasLimit: '100000', preVerificationGas: '100000', maxFeePerGas: '1', maxPriorityFeePerGas: '1', paymaster: recipient, paymasterData: '0x', paymasterVerificationGasLimit: '100000', paymasterPostOpGasLimit: '100000' }, signatureRequest: { type: 'personal_sign' } };
  const hash = relayOperationHash(request); request.signatureRequest = { type: 'personal_sign', rawPayload: hashMessage({ raw: hash }), data: { raw: hash } };
  return { expected, envelope: { requestId: 'request', ...expected, expiresAt: Date.now() + 60000, requests: [request], fee: { mode: 'sponsored' }, authorizationNonce: null, orderAuthorization: authorization } };
}
for (const input of [
  { kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) },
  { kind: 'transfer', recipient, amount: String(unit) },
  { kind: 'tip', messageId: 'message', amount: String(unit) },
  createPacketInput({ kind: 'team', scope: 'team', count: 2, distribution: 'equal', total: String(2n * unit) }),
  createPacketInput({ kind: 'room', scope: 'room', count: 2, distribution: 'random', total: String(3n * unit) }),
]) test(`production signing accepts only reconstructed ${input.kind} calls (${input.packet?.distribution ?? input.recipient ?? 'default'})`, async t => {
  const f = fixture(t); await f.controller.start();
  const authorization = { packetSalt: '0x' + 'c'.repeat(64) };
  if (input.kind === 'packet') {
    const quote = f.api.quote;
    f.api.quote = async (...args) => { await quote(...args); f.order().id = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [address, authorization.packetSalt])); return structuredClone(f.order()); };
  }
  const payment = await f.controller.review(input), calls = orderCalls(payment.order, authorization);
  if (input.kind === 'transfer' || input.kind === 'tip') {
    assert.equal(calls.length, 1); assert.equal(calls[0].to, deployment.token);
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: calls[0].data }), { functionName: 'transfer', args: [recipient, unit] });
  } else if (input.kind === 'packet') {
    assert.equal(calls.length, 2); assert.equal(calls[0].to, deployment.token); assert.equal(calls[1].to, deployment.packetContract);
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: calls[0].data }), { functionName: 'approve', args: [deployment.packetContract, BigInt(payment.total)] });
    const packet = decodeFunctionData({ abi: redPacketAbi, data: calls[1].data });
    assert.equal(packet.functionName, 'createPacket'); assert.equal(packet.args[0], deployment.token); assert.equal(packet.args[1], authorization.packetSalt);
  }
  const { envelope, expected } = signingEnvelope(payment.order, authorization);
  const keys = new WalletKeys({ ...host(), accountId: 'fixture', check() {} }); keys.initialize(mnemonic); t.after(() => keys.dispose());
  const signed = await keys.sign(envelope, expected); await verifyRelaySignatures(envelope, signed.signatures);
  const approval = { to: deployment.token, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [recipient, unit] }) };
  for (const altered of [[], [...calls, approval], [{ ...calls[0], to: recipient }, ...calls.slice(1)], [{ ...calls[0], value: '1' }, ...calls.slice(1)], [approval, ...calls.slice(1)]]) {
    const tampered = signingEnvelope(payment.order, authorization, altered).envelope;
    await assert.rejects(keys.sign(tampered, expected));
    await assert.rejects(keys.sign({ ...tampered, calls: altered }, expected));
  }
  await assert.rejects(keys.sign({ ...envelope, fee: { mode: 'pals' } }, expected), /INVALID_GAS_QUOTE/);
  f.api.prepare = async () => ({ requestId: 'request', orderId: payment.id, state: 'prepared', envelope });
  f.keys.sign = (prepared, reconstructed) => keys.sign(prepared, reconstructed);
  await f.controller.confirm(paymentOwner(f), '123456'); assert.equal(f.counts().submits, 1);
});
test('paid gas is rejected before signature and releases the small-payment reservation', async t => {
  const f = fixture(t); await f.controller.start(); await f.controller.setSmallPayments(true, '123456');
  const original = f.api.prepare;
  f.api.prepare = async () => { const result = await original(); result.envelope.fee = { mode: 'pals', token: deployment.token, spender: recipient, maxAmount: String(2n * unit) }; return result; };
  const payment = await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(249n * unit) });
  await assert.rejects(f.controller.confirm(paymentOwner(f)), /INVALID_GAS_QUOTE/);
  assert.equal(f.controller.snapshot().payment.total, String(249n * unit));
  assert.equal(f.values.get('self:wallet-local').reservations[payment.id], undefined);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});
test('sponsor quota exhaustion surfaces as an ordinary payment error without signing', async t => {
  const f = fixture(t); await f.controller.start(); await f.controller.setSmallPayments(true, '123456');
  f.api.prepare = async () => { throw Object.assign(new Error('quota'), { code: 'CHAIN_SPONSOR_LIMIT' }); };
  const payment = await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  await assert.rejects(f.controller.confirm(paymentOwner(f)), { code: 'CHAIN_SPONSOR_LIMIT' });
  assert.equal(f.controller.snapshot().payment.error, 'CHAIN_SPONSOR_LIMIT');
  assert.equal(f.controller.snapshot().payment.phase, 'password');
  assert.equal(f.values.get('self:wallet-local').reservations[payment.id], undefined);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});
test('a grab is one idempotent request with no payment order or password, and refreshes the balance', async t => {
  const f = fixture(t); await f.controller.start();
  const packetId = '0x' + 'b'.repeat(64), requests = [], claim = { packetId, status: 'issued', index: 0, amount: String(unit) };
  const runtime = { api: { request: async (...args) => { requests.push(args); return claim; } }, wallet: { start: async () => f.controller } };
  assert.deepEqual(await walletHandlers['wallet-claim'].call({ runtime }, { payload: { packetId } }), claim);
  assert.deepEqual(requests, [['chain.claim', { params: { id: packetId }, key: `claim:${packetId}` }]]);
  assert.equal(f.controller.snapshot().payment, undefined); assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});
test('dismissal after a rejected gas quote cancels prepared server request and clears pending state', async t => {
  const f = fixture(t); await f.controller.start();
  const original = f.api.prepare; let cancelled = 0;
  f.api.prepare = async () => { const result = await original(); result.envelope.fee = { mode: 'pals', token: deployment.token, spender: recipient, maxAmount: '1' }; return result; };
  const cancel = f.api.cancel; f.api.cancel = async (...args) => { cancelled++; return cancel(...args); };
  await f.controller.review({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  await assert.rejects(f.controller.confirm(paymentOwner(f), '123456'), /INVALID_GAS_QUOTE/);
  await f.controller.dismiss(paymentOwner(f));
  assert.equal(cancelled, 1); assert.equal(f.controller.snapshot().payment, undefined);
});
test('random packet allocation conserves bigint amount and uses independent commitments', () => {
  const result = createPacketInput({ kind: 'room', scope: 'room', count: 20, distribution: 'random', total: String(100n * unit) });
  assert.equal(result.packet.amounts.reduce((sum, amount) => sum + BigInt(amount), 0n), 100n * unit);
  assert.ok(result.packet.amounts.every(amount => BigInt(amount) >= unit));
  assert.equal(new Set(result.packet.allocationSalts).size, 20);
  assert.throws(() => createPacketInput({ kind: 'invitation', scope: 'team', count: 3, distribution: 'equal', total: String(10n * unit) }));
});
test('binding is signed by both local wallet and identity and rejects server substitutions', async () => {
  const accountId = deriveIdentity(mnemonic).publicKey, now = Date.now();
  const challenge = { id: '0x' + 'a'.repeat(64), accountId, chainId: 4663, address, nonce: '0x' + 'b'.repeat(64), expiresAt: now + 120000 };
  const signed = await signWalletBinding(mnemonic, challenge, { accountId, address, chainId: 4663 }, now);
  const binding = { accountId, chainId: 4663, address, proof: signed.proof, boundAt: now };
  assert.equal(verifyWalletBinding(binding, accountId, 4663, address), true);
  assert.equal(verifyWalletBinding({ ...binding, address: recipient }, accountId, 4663, recipient), false);
  await assert.rejects(signWalletBinding(mnemonic, { ...challenge, chainId: 31337 }, { accountId, address, chainId: 4663 }, now), /MISMATCH/);
});
test('public person projection verifies wallets and clears removed wallet bindings', async () => {
  const accountId = deriveIdentity(mnemonic).publicKey, now = Date.now();
  const challenge = { id: '0x' + 'a'.repeat(64), accountId, chainId: 4663, address, nonce: '0x' + 'b'.repeat(64), expiresAt: now + 120000 };
  const signed = await signWalletBinding(mnemonic, challenge, { accountId, address, chainId: 4663 }, now);
  const wallet = { accountId, chainId: 4663, address, proof: signed.proof, boundAt: now };
  let result = { wallet }, current = true, emissions = 0;
  const peer = { id: 'other', name: 'Other' };
  const runtime = {
    state: { data: { people: [{ id: accountId, name: 'Person' }, peer] } },
    auth: { scope: () => ({ check() { if (!current) throw new Error('SESSION_CHANGED'); } }) },
    api: { async request(endpoint, options) { assert.equal(endpoint, 'chain.person'); assert.deepEqual(options, { params: { id: accountId } }); return result; } },
    emit() { emissions++; },
  };
  const service = new WalletRuntime(runtime);
  assert.equal(await service.person(accountId), result);
  assert.deepEqual(runtime.state.data.people[0], { id: accountId, name: 'Person', walletAddress: address, walletVerified: true });
  assert.equal(runtime.state.data.people[1], peer);
  const known = runtime.state.data.people;
  result = { wallet: { ...wallet, address: recipient } };
  await assert.rejects(service.person(accountId), /WALLET_BINDING_MISMATCH/);
  assert.equal(runtime.state.data.people, known); assert.equal(emissions, 1);
  result = { wallet: null };
  await service.person(accountId);
  assert.equal(runtime.state.data.people[0].walletAddress, undefined);
  assert.equal(runtime.state.data.people[0].walletVerified, false);
  runtime.state.data.people = [peer]; result = { wallet };
  assert.equal(await service.person(accountId), result);
  assert.deepEqual(runtime.state.data.people, [peer]);
  result = { wallet: { ...wallet, accountId: 'someone-else' } };
  await assert.rejects(service.person(accountId), /WALLET_BINDING_MISMATCH/);
  result = { wallet }; current = false;
  await assert.rejects(service.person(accountId), /SESSION_CHANGED/);
  assert.deepEqual(runtime.state.data.people, [peer]); assert.equal(emissions, 3);
});

test('config errors reload configuration without replacing the reviewed quote or its expiry', async t => {
  const f = fixture(t); await f.controller.start();
  const payment = await f.controller.review({ kind: 'transfer', recipient, amount: String(50n * unit) });
  const prepare = f.api.prepare;
  f.config.version++; f.config.dailySponsoredLimit = 10;
  f.api.prepare = async () => { throw Object.assign(new Error('changed'), { code: 'CHAIN_CONFIG_CHANGED' }); };
  await assert.rejects(f.controller.confirm(paymentOwner(f), '123456'), { code: 'CHAIN_CONFIG_CHANGED' });
  assert.equal(f.controller.snapshot().config.version, 2);
  assert.deepEqual(f.controller.snapshot().payment.order, payment.order);
  f.api.prepare = prepare; f.advance(299999);
  await f.controller.confirm(paymentOwner(f), '123456');
  assert.equal(f.counts().signed, 1); assert.equal(f.controller.snapshot().payment.total, String(50n * unit));
  const expired = fixture(t); await expired.controller.start();
  await expired.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  expired.advance(300000);
  await assert.rejects(expired.controller.confirm(paymentOwner(expired), '123456'), /ORDER_EXPIRED/);
  assert.equal(expired.counts().signed, 0);
});

for (const errorCode of ['CHAIN_CONFIG_CHANGED', 'CHAIN_DISABLED']) test(`${errorCode} after submission keeps signed pending payment and reconciles while closed`, async t => {
  const f = fixture(t); await f.controller.start();
  const payment = await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  f.api.submit = async () => { f.order().status = 'submitted'; f.config.enabled = false; f.config.version++; throw Object.assign(new Error(errorCode), { code: errorCode }); };
  const pending = await f.controller.confirm(paymentOwner(f), '123456');
  assert.equal(f.controller.snapshot().availability, 'closed');
  assert.equal(pending.phase, 'pending'); assert.equal(pending.signed, true);
  assert.equal(pending.requestId, 'request'); assert.equal(pending.order.id, payment.id);
  assert.equal(f.values.get('self:wallet-payment').phase, 'pending');
  f.order().status = 'confirmed';
  assert.equal((await f.controller.reconcile()).phase, 'confirmed');
  assert.equal(f.counts().signed, 1);
});

test('SSE disable and deployment changes retain pending signatures and allow final confirmation', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  await f.controller.confirm(paymentOwner(f), '123456');
  const pending = f.controller.snapshot().payment;
  await f.controller.handleEvent({ type: 'config', config: { ...f.config, enabled: false, version: 2, deployment: { ...deployment, token: recipient } } });
  assert.equal(f.controller.snapshot().availability, 'closed');
  assert.deepEqual(f.controller.snapshot().payment, pending);
  f.order().status = 'confirmed';
  await f.controller.handleEvent({ type: 'order', accountId: 'self', order: structuredClone(f.order()) });
  assert.equal(f.controller.snapshot().payment.phase, 'confirmed');
  assert.equal(f.controller.snapshot().payment.signed, true);
});

test('a configuration error while quoting refreshes config and retains the existing review', async t => {
  const f = fixture(t); await f.controller.start();
  const payment = await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  f.config.enabled = false; f.config.version++;
  f.api.quote = async () => { throw Object.assign(new Error('changed'), { code: 'CHAIN_CONFIG_CHANGED' }); };
  await assert.rejects(f.controller.review({ kind: 'transfer', recipient, amount: String(2n * unit) }), { code: 'CHAIN_CONFIG_CHANGED' });
  assert.equal(f.controller.snapshot().availability, 'closed');
  assert.deepEqual(f.controller.snapshot().payment, payment);
});

test('config errors during reconciliation refresh the gate without losing the pending order', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  await f.controller.confirm(paymentOwner(f), '123456');
  const payment = f.controller.snapshot().payment;
  f.config.enabled = false; f.config.version++;
  f.api.status = async () => { throw Object.assign(new Error('changed'), { code: 'CHAIN_CONFIG_CHANGED' }); };
  const reconciled = await f.controller.reconcile();
  assert.equal(f.controller.snapshot().availability, 'closed');
  assert.equal(reconciled.phase, 'pending'); assert.equal(reconciled.signed, true);
  assert.deepEqual(reconciled.order, payment.order); assert.equal(reconciled.requestId, payment.requestId);
});

test('record pagination removes zero-value poison entries and duplicate logs', async t => {
  const f = fixture(t); await f.controller.start();
  const record = { id: 'event', from: recipient, to: address, amount: '10', transactionHash: '0x1', blockNumber: '1', transactionIndex: 0, logIndex: 0, occurredAt: 1, kind: 'transfer', status: 'confirmed', orderId: null, packetId: null, orderAmount: null, part: 'transfer' };
  f.api.records = async () => ({ items: [record, { ...record, id: 'zero', amount: '0' }], nextCursor: 'cursor' });
  await f.controller.records('all');
  const page = await f.controller.records('all', true);
  assert.deepEqual(page.items, [record]);
});

test('wallet initialization retries all local restoration after a storage failure', async t => {
  const f = fixture(t); await f.controller.start();
  const payment = await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  f.values.set('self:wallet-address', address);
  let fail = true, paymentReads = 0;
  const get = f.storage.get;
  f.storage.get = async key => {
    if (key === 'self:wallet-payment') { paymentReads++; if (fail) { fail = false; throw new Error('STORAGE_UNAVAILABLE'); } }
    return get(key);
  };
  const runtime = { storage: f.storage, auth: { session: { account: { id: 'self' } }, scope: () => ({ check() {} }) }, state: { data: { people: [] } }, emit() {}, api: { request: async name => name === 'chain.config' ? { ...f.config, enabled: false } : null } };
  const wallet = new WalletRuntime(runtime); t.after(() => wallet.reset());
  await assert.rejects(wallet.start(), /STORAGE_UNAVAILABLE/);
  const restored = await wallet.start();
  assert.equal(paymentReads, 2);
  assert.equal(restored.snapshot().payment.id, payment.id);
  assert.equal(await wallet.start(), restored);
});

test('late initialization failure cannot clear a replacement wallet in the same session', async t => {
  const h = host(); h.values.set('self:wallet-address', address);
  let rejectOld, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const get = h.storage.get;
  let first = true;
  h.storage.get = async key => {
    if (key === 'self:wallet-payment' && first) { first = false; entered(); return new Promise((_, reject) => { rejectOld = reject; }); }
    return get(key);
  };
  const runtime = { storage: h.storage, auth: { session: { account: { id: 'self' } }, scope: () => ({ check() {} }) }, state: { data: { people: [] } }, emit() {}, api: { request: async () => ({ enabled: false, version: 1, deployment: null }) } };
  const wallet = new WalletRuntime(runtime); t.after(() => wallet.reset());
  const old = wallet.start(); const rejected = assert.rejects(old, /STORAGE_UNAVAILABLE/);
  await waiting; wallet.reset();
  const replacement = await wallet.start();
  rejectOld(new Error('STORAGE_UNAVAILABLE')); await rejected;
  assert.equal(await wallet.start(), replacement);
  assert.equal(runtime.state.wallet.availability, 'closed');
  await replacement.refresh();
});

test('tip cannot reuse a cached author after the target message disappears', async () => {
  const runtime = { state: { rooms: { current: { messages: [] }, blocked: [] } } };
  const wallet = new WalletRuntime(runtime);
  wallet.recipients.set('order', 'peer');
  await assert.rejects(wallet.validateRecipient({ kind: 'tip', messageId: 'gone', amount: '1' }, { id: 'order' }), /TIP_MESSAGE_UNAVAILABLE/);
});

test('rejected gas quote cancellation failure preserves the original payment and never signs', async t => {
  const f = fixture(t); await f.controller.start();
  const prepare = f.api.prepare;
  f.api.prepare = async () => { const result = await prepare(); result.envelope.fee = { mode: 'pals', token: deployment.token, spender: recipient, maxAmount: String(unit) }; return result; };
  await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  await assert.rejects(f.controller.confirm(paymentOwner(f), '123456'), /INVALID_GAS_QUOTE/);
  const payment = f.controller.snapshot().payment;
  const cancel = f.api.cancel;
  f.api.cancel = async () => { throw new Error('OFFLINE'); };
  await assert.rejects(f.controller.dismiss(paymentOwner(f)), /OFFLINE/);
  assert.deepEqual(f.controller.snapshot().payment, payment);
  f.api.cancel = cancel; await f.controller.dismiss(paymentOwner(f));
  assert.equal(f.controller.snapshot().payment, undefined);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});

test('failed initial balance request remains unknown rather than becoming zero', async t => {
  const f = fixture(t); f.api.balance = async () => { throw new Error('OFFLINE'); };
  await f.controller.start();
  assert.equal(f.controller.snapshot().availability, 'offline');
  assert.equal(f.controller.snapshot().balance, undefined);
});

test('wallet clock sleeps when idle', () => {
  assert.deepEqual(walletDeadlines({ data: { people: [] }, rooms: {} }, 1000, true), []);
});

test('wallet clock includes packet expiry and reviewed payment deadlines', () => {
  const state = { data: { people: [] }, rooms: {}, chainRoom: { packets: [{ expiresAt: 5000 }] }, chainTeam: { packets: [{ packet: { expiresAt: 6000 } }] }, wallet: { payment: { order: { expiresAt: 4000 } } } };
  const deadlines = walletDeadlines(state, 1000, false);
  for (const at of [4000, 5000, 6000, 605000]) assert.ok(deadlines.includes(at));
  assert.deepEqual(walletDeadlines(state, 605000, false), []);
});

test('submitted tip reconciliation does not recheck an unavailable target', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'tip', messageId: 'message', amount: String(unit) });
  await f.controller.confirm(paymentOwner(f), '123456');
  f.controller.options.validateRecipient = async () => { throw new Error('TIP_MESSAGE_UNAVAILABLE'); };
  f.order().status = 'confirmed';
  assert.equal((await f.controller.reconcile()).phase, 'confirmed');
  assert.deepEqual(f.counts(), { signed: 1, submits: 1 });
});

test('fresh login discovers multiple server operations without creating a local payment', async t => {
  const f = fixture(t);
  const order = await f.api.quote({ kind: 'transfer', recipient, amount: String(unit) });
  const pending = { order: { ...order, status: 'submitted' }, relay: { requestId: 'original', state: 'uncertain', fundsReserved: true }, canResume: false };
  const reserved = { order: { ...order, id: '0x' + 'b'.repeat(64), status: 'expired' }, relay: { requestId: 'cancelled', state: 'cancelled', fundsReserved: true }, canResume: false };
  const quoted = { order: { ...order, id: '0x' + 'c'.repeat(64) }, relay: null, canResume: true };
  f.api.recovery = async query => query.cursor ? { items: [quoted], nextCursor: null } : { items: [pending, reserved], nextCursor: 'page-2' };
  await f.controller.start();
  assert.equal(f.controller.snapshot().payment, undefined);
  assert.equal(f.controller.snapshot().recovery.items.length, 2);
  await f.controller.recoveries(true);
  assert.equal(f.controller.snapshot().recovery.items.length, 3);
  assert.equal(f.controller.snapshot().recovery.items[1].relay.fundsReserved, true);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
  const fresh = new WalletController({ ...f, accountId: 'self', address, now: () => order.createdAt, check() {}, validateRecipient: async () => {} });
  t.after(() => fresh.dispose()); await fresh.start();
  assert.equal(fresh.snapshot().recovery.items.length, 2);
  assert.equal(fresh.snapshot().payment, undefined);
});

test('unknown and cancelled recoveries never prepare, sign, resubmit or overwrite the active payment', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  const active = f.controller.snapshot().payment;
  const item = { order: { ...active.order, id: '0x' + 'b'.repeat(64), status: 'submitted' }, relay: { requestId: 'original-request', state: 'uncertain', fundsReserved: true }, canResume: false };
  f.api.recovery = async () => ({ items: [structuredClone(item)], nextCursor: null });
  f.api.prepare = async () => { assert.fail('Recovery must not prepare'); };
  f.api.status = async id => { assert.equal(id, 'original-request'); return { state: 'confirmed' }; };
  f.api.order = async id => { assert.equal(id, item.order.id); return item.order; };
  await f.controller.recoveries(); await f.controller.checkRecovery(item.order.id);
  assert.deepEqual(f.controller.snapshot().payment, active);
  assert.equal(f.controller.snapshot().recovery.items[0].order.status, 'submitted');
  await assert.rejects(f.controller.resumeRecovery(item.order.id), /PAYMENT_BUSY/);
  await f.controller.dismiss(paymentOwner(f));
  await assert.rejects(f.controller.resumeRecovery(item.order.id), /PAYMENT_BUSY/);
  item.relay.state = 'cancelled'; item.order.status = 'expired';
  await f.controller.recoveries();
  await assert.rejects(f.controller.resumeRecovery(item.order.id), /PAYMENT_BUSY/);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});

test('prepared recovery explicitly reviews original order then requires confirmation and password', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.setSmallPayments(true, '123456');
  const order = await f.api.quote({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: String(unit) });
  const item = { order, relay: { requestId: 'request', state: 'prepared', fundsReserved: true }, canResume: true };
  f.api.recovery = async () => ({ items: [item], nextCursor: null });
  await f.controller.recoveries();
  assert.equal(f.controller.snapshot().payment, undefined);
  const payment = await f.controller.resumeRecovery(order.id);
  assert.equal(payment.order.id, order.id); assert.equal(payment.requestId, 'request'); assert.equal(payment.phase, 'review');
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
  assert.equal((await f.controller.confirm(paymentOwner(f))).phase, 'password');
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
  await f.controller.confirm(paymentOwner(f), '123456');
  assert.deepEqual(f.counts(), { signed: 1, submits: 1 });
});

test('recovery fetch failures retain existing entries and expose failure; foreign account rows are rejected', async t => {
  const f = fixture(t); const order = await f.api.quote({ kind: 'transfer', recipient, amount: String(unit) });
  const item = { order, relay: null, canResume: true };
  f.api.recovery = async () => ({ items: [item], nextCursor: null });
  await f.controller.start();
  f.api.recovery = async () => { throw new Error('OFFLINE'); };
  await f.controller.recoveries();
  assert.equal(f.controller.snapshot().recovery.error, 'OFFLINE');
  assert.deepEqual(f.controller.snapshot().recovery.items, [item]);
  f.api.recovery = async () => ({ items: [{ ...item, order: { ...order, accountId: 'other' } }], nextCursor: null });
  await f.controller.recoveries();
  assert.equal(f.controller.snapshot().recovery.error, 'ORDER_MISMATCH');
  await assert.rejects(f.controller.resumeRecovery(order.id), /ORDER_MISMATCH/);
  assert.equal(f.controller.snapshot().payment, undefined);
});

test('a different device submitting after recovery review changes to original-operation reconciliation', async t => {
  const f = fixture(t); await f.controller.start();
  const order = await f.api.quote({ kind: 'transfer', recipient, amount: String(unit) });
  f.api.recovery = async () => ({ items: [{ order, relay: { requestId: 'request', state: 'prepared' }, canResume: true }], nextCursor: null });
  await f.controller.resumeRecovery(order.id);
  f.order().status = 'submitted';
  f.api.prepare = async () => ({ orderId: order.id, requestId: 'request', state: 'submitted', envelope: null });
  assert.equal((await f.controller.confirm(paymentOwner(f), '123456')).phase, 'pending');
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});

test('recovery UI distinguishes relay inclusion from business completion and preserves unknown over quote expiry', () => {
  assert.equal(recoveryLabel({ order: { status: 'submitted' }, relay: { state: 'confirmed' } }), 'recoveryIndexing');
  assert.equal(recoveryLabel({ order: { status: 'confirmed' }, relay: { state: 'confirmed' } }), 'confirmed');
  assert.equal(recoveryLabel({ order: { status: 'expired' }, relay: { state: 'uncertain' } }), 'recoveryUnknown');
  assert.equal(recoveryLabel({ order: { status: 'expired' }, relay: { state: 'cancelled', fundsReserved: true } }), 'recoveryCancelled');
  assert.equal(recoveryLabel({ order: { status: 'failed' }, relay: { state: 'failed' } }), 'recoveryFailed');
});

test('recovery reviews the original still-valid amount after a sponsored quota change', async t => {
  const f = fixture(t); await f.controller.start();
  const order = await f.api.quote({ kind: 'transfer', recipient, amount: String(unit) });
  f.api.recovery = async () => ({ items: [{ order, relay: null, canResume: true }], nextCursor: null });
  f.config.version++; f.config.dailySponsoredLimit = 10; await f.controller.refresh();
  const restored = await f.controller.resumeRecovery(order.id);
  assert.equal(restored.order.amount, String(unit));
  assert.equal(restored.order.expiresAt, order.expiresAt);
  assert.equal(restored.total, String(unit));
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
});

test('wallet commands accept either transfer recipient form and reject mixed recipients', () => {
  for (const input of [{ kind: 'transfer', recipient, amount: '1' }, { kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: '1' }]) assert.deepEqual(parseCommand({ name: 'wallet-review', payload: { input } }).payload.input, input);
  assert.throws(() => parseCommand({ name: 'wallet-review', payload: { input: { kind: 'transfer', recipient, teamId: 'team', recipientId: 'peer', amount: '1' } } }));
});

test('address transfers bypass teammate lookup while teammate transfers still require membership', async () => {
  const wallet = new WalletRuntime({ state: { remoteTeams: [] } });
  await wallet.validateRecipient({ kind: 'transfer', recipient, amount: '1' }, { recipient });
  await assert.rejects(wallet.validateRecipient({ kind: 'transfer', teamId: 'team', recipientId: 'peer', amount: '1' }, { recipient }), /RECIPIENT_NOT_TEAMMATE/);
});

test('money arriving without my own order refreshes the balance: a teammate transfer to me, a squad packet, or a room packet I grabbed', async t => {
  const f = fixture(t); await f.controller.start();
  let balance = 10_000n, reads = 0;
  f.api.balance = async () => { reads++; return { token: deployment.token, chainId: deployment.chainId, address, balance: String(balance * unit), blockNumber: '2' }; };
  const incoming = { id: '0x' + 'd'.repeat(64), accountId: 'mate', payer: recipient, recipient: address, kind: 'transfer', status: 'confirmed', amount: String(10n * unit), createdAt: 1, expiresAt: 2, confirmedAt: 1, transactionHash: '0x' + 'e'.repeat(64), configVersion: 1, deployment, payload: { kind: 'transfer', teamId: 'squad', recipientId: 'self', amount: String(10n * unit) } };
  balance = 10_010n;
  await f.controller.handleEvent({ type: 'order', accountId: 'mate', order: incoming });
  assert.equal(reads, 1); assert.equal(f.controller.snapshot().balance.balance, String(10_010n * unit));
  await f.controller.handleEvent({ type: 'order', accountId: 'mate', order: { ...incoming, recipient } });
  await f.controller.handleEvent({ type: 'order', accountId: 'mate', order: { ...incoming, status: 'submitted' } });
  assert.equal(reads, 1);
  await f.controller.handleEvent({ type: 'packet', packetId: '0x' + 'c'.repeat(64), scope: 'squad' });
  assert.equal(reads, 2);
  const room = { type: 'packet', packetId: '0x' + 'f'.repeat(64), scope: 'token:Robinhood:0x1111111111111111111111111111111111111111' };
  await f.controller.handleEvent(room);
  assert.equal(reads, 2);
  f.controller.noteGrab(room.packetId); await new Promise(resolve => setTimeout(resolve, 0)); reads = 2;
  await f.controller.handleEvent(room);
  assert.equal(reads, 3);
});


test('confirmation and dismissal require the displayed account and quote before unlocking', async t => {
  const f = fixture(t); await f.controller.start();
  await f.controller.review({ kind: 'transfer', recipient, amount: String(unit) });
  const original = paymentOwner(f);
  let unlocks = 0;
  f.keys.unlock = async () => { unlocks++; return address; };
  for (const expected of [{ ...original, accountId: 'other' }, { ...original, paymentId: 'other' }, undefined]) {
    await assert.rejects(f.controller.confirm(expected, '123456'), /WALLET_SESSION_CHANGED|ORDER_MISMATCH/);
    await assert.rejects(f.controller.dismiss(expected), /WALLET_SESSION_CHANGED|ORDER_MISMATCH/);
  }
  const quote = f.api.quote;
  f.api.quote = async (...args) => ({ ...await quote(...args), id: '0x' + 'b'.repeat(64) });
  const replacement = await f.controller.review({ kind: 'transfer', recipient, amount: String(2n * unit) });
  await assert.rejects(f.controller.confirm(original, '123456'), /ORDER_MISMATCH/);
  await assert.rejects(f.controller.dismiss(original), /ORDER_MISMATCH/);
  assert.equal(f.controller.snapshot().payment.id, replacement.id);
  assert.equal(unlocks, 0);
  assert.deepEqual(f.counts(), { signed: 0, submits: 0 });
  await f.controller.dismiss(paymentOwner(f));
  assert.equal(f.controller.snapshot().payment, undefined);
});

test('confirm and dismiss wire payloads require account and payment ids', () => {
  for (const name of ['wallet-confirm', 'wallet-dismiss']) {
    for (const payload of [{}, { accountId: 'self' }, { paymentId: 'quote' }]) assert.throws(() => parseCommand({ name, payload }));
    const payload = { accountId: 'self', paymentId: 'quote' };
    assert.deepEqual(parseCommand({ name, payload }).payload, payload);
  }
});

test('runtime payment commands reject another account before starting and recheck after startup', async () => {
  const session = { account: { id: 'self' } };
  const runtime = { auth: { session } }, wallet = new WalletRuntime(runtime);
  let starts = 0, confirms = 0, dismisses = 0;
  wallet.start = async () => { starts++; return { confirm: () => { confirms++; }, dismiss: () => { dismisses++; } }; };
  for (const name of ['confirm', 'dismiss']) await assert.rejects(wallet[name]({ accountId: 'other', paymentId: 'quote' }), /WALLET_SESSION_CHANGED/);
  assert.equal(starts, 0);
  const expected = { accountId: 'self', paymentId: 'quote' };
  await wallet.confirm(expected); await wallet.dismiss(expected);
  assert.equal(confirms, 1); assert.equal(dismisses, 1);
  let release;
  wallet.start = () => new Promise(resolve => { release = resolve; });
  const pending = wallet.confirm(expected);
  runtime.auth.session = { account: { id: 'self' } };
  release({ confirm: () => { confirms++; } });
  await assert.rejects(pending, /WALLET_SESSION_CHANGED/);
  assert.equal(confirms, 1);
});

test('wallet handlers forward full ownership payloads through the account-scoped runtime', async () => {
  const calls = [], payment = { id: 'quote' };
  const runtime = { wallet: {
    confirm: async payload => { calls.push(['confirm', payload]); return payment; },
    dismiss: async payload => { calls.push(['dismiss', payload]); },
    start: () => { throw new Error('Handler bypassed account ownership'); },
  } };
  const confirm = { accountId: 'self', paymentId: 'quote', password: '123456' };
  const dismiss = { accountId: 'self', paymentId: 'quote' };
  assert.equal(await walletHandlers['wallet-confirm'].call({ runtime }, { payload: confirm }), payment);
  await walletHandlers['wallet-dismiss'].call({ runtime }, { payload: dismiss });
  assert.deepEqual(calls, [['confirm', confirm], ['dismiss', dismiss]]);
});

test('preference commands require the initiating account at the transport boundary', () => {
  assert.throws(() => parseCommand({ name: 'preferences', payload: { current: 'team' } }));
  const payload = { accountId: 'self', current: 'team' };
  assert.deepEqual(parseCommand({ name: 'preferences', payload }).payload, payload);
});
