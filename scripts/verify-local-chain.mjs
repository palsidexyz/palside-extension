// Run: node --env-file=.local/server.env scripts/verify-local-chain.mjs
// Disposable accounts and local token movements persist; no service or clock is reset.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { encodeFunctionData, erc20Abi } from 'viem';
import { faucetArguments } from './chain/faucet.mjs';
import { LOCAL_DEPLOYER, LOCAL_TOKEN, LOCAL_PACKETS, LOCAL_RPC, localRpc, requireLocalChain, rpcCall } from './dev-chain.mjs';
import { isMain } from './lib/release-files.mjs';

const BASE = 'http://127.0.0.1:8787';
const TIMEOUT = 180_000;
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
function requireCheck(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }

export function verificationArguments(args, env) {
  requireCheck(args.length === 0, 'NO_ARGUMENTS_ALLOWED');
  requireCheck(env.PALSIDE_ENV === 'development', 'DEVELOPMENT_REQUIRED');
  requireCheck(env.PALSIDE_CHAIN_LOCAL_RELAY === 'true', 'LOCAL_RELAY_REQUIRED');
  let rpc;
  try {
    for (const key of ['PALSIDE_CHAIN_RPC_URL', 'PALSIDE_CHAIN_RPC']) {
      if (env[key]) requireCheck(localRpc(env[key]) === localRpc(LOCAL_RPC), 'LOCAL_RPC_REQUIRED');
    }
    rpc = localRpc(env.PALSIDE_CHAIN_RPC_URL ?? env.PALSIDE_CHAIN_RPC ?? LOCAL_RPC);
  } catch { throw Object.assign(new Error('LOCAL_RPC_REQUIRED'), { code: 'LOCAL_RPC_REQUIRED' }); }
  return { rpc };
}

// Never print exception messages/objects: assertions, HTTP clients and schema errors can contain secrets.
export function failureCode(error) {
  const candidate = error?.serverCode ?? error?.code;
  return typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : 'CHECK_FAILED';
}

async function main() {
  let step = 'guards', passed = 0;
  const wallets = [];
  const accounts = [];
  const started = Date.now();
  const run = async (name, action) => { step = name; const result = await action(); passed++; console.log(`PASS ${name}`); return result; };
  try {
    const { rpc } = verificationArguments(process.argv.slice(2), process.env);
    await run('guards: development, loopback Anvil 31337, local relay, deployed contracts', async () => {
      await requireLocalChain(rpc);
      requireCheck((await rpcCall(rpc, 'web3_clientVersion')).toLowerCase().includes('anvil'), 'ANVIL_REQUIRED');
      for (const address of [LOCAL_TOKEN, LOCAL_PACKETS]) requireCheck(await rpcCall(rpc, 'eth_getCode', [address, 'latest']) !== '0x', 'DEPLOYMENT_MISSING');
      requireCheck(BigInt((await rpcCall(rpc, 'eth_getBlockByNumber', ['finalized', false])).number) > 0n, 'FINALITY_REQUIRED');
    });
    const { createServiceApi, createServiceAccounts } = await import('./lib/service-accounts.mjs');
    const { endpointsById, pathFor } = await import('../packages/shared/src/contracts/endpoints.ts');
    const { sealMnemonic, generateMnemonic, PIN_LENGTH } = await import('../packages/shared/src/identity.ts');
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/src/')) return next(specifier + '.ts', context);
      return next(specifier, context);
    } });
    let modules;
    try {
      modules = await Promise.all([
        import('../apps/extension/src/runtime/wallet/keys.ts'),
        import('../apps/extension/src/runtime/wallet/binding.ts'),
        import('../apps/extension/src/runtime/wallet/controller.ts'),
        import('../apps/extension/src/runtime/wallet/packets.ts'),
        import('../apps/extension/src/runtime/wallet/api.ts'),
        import('../apps/extension/src/runtime/wallet/runtime.ts'),
      ]);
    } finally { hooks.deregister(); }
    const [{ WalletKeys, deriveWalletAccount }, { signWalletBinding, verifyWalletBinding }, { WalletController }, { createPacketInput }, { walletApi }, { WalletRuntime }] = modules;
    const api = createServiceApi({ base: BASE, fetcher: async (url, init) => {
      const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const result = await response.clone().json().catch(() => ({}));
        const serverCode = result.error ?? result.errcode;
        throw Object.assign(new Error('HTTP_ERROR'), { serverCode, code: typeof serverCode === 'string' ? serverCode : `HTTP_${response.status}`, retryAfterMs: result.retryAfterMs });
      }
      return response;
    } });
    const { createAccount } = createServiceAccounts({ api });
    const post = (path, session, body) => api(path, { method: 'POST', session, body, key: randomUUID() });
    const read = (path, session) => api(path, { session });
    async function poll(check) {
      const deadline = Date.now() + TIMEOUT;
      do {
        const result = await check();
        if (result) return result;
        requireCheck(Date.now() < deadline, 'FINALITY_TIMEOUT');
        await delay(1000);
      } while (true);
    }
    const balance = async address => BigInt(await rpcCall(rpc, 'eth_call', [{ to: LOCAL_TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [address] }) }, 'latest']));
    async function join(owner, peer, teamId) {
      const invite = await read(`/teams/${teamId}/invite`, owner);
      requireCheck(invite.active && invite.url, 'INVITE_LINK_UNAVAILABLE');
      await post('/join', peer, { invite: new URL(invite.url).pathname.split('/').at(-1) });
      for (const account of [owner, peer]) {
        const team = (await read('/me', account)).teams.find(item => item.id === teamId);
        requireCheck(team?.joined && [owner, peer].every(item => team.memberIds.includes(item.account.id)), 'SQUAD_MEMBERSHIP_MISMATCH');
        const membership = await read(`/_matrix/client/v3/rooms/${encodeURIComponent(team.roomId)}/state/m.room.member/${encodeURIComponent(account.matrix.userId)}`, account);
        requireCheck(membership.membership === 'join', 'SYNAPSE_MEMBERSHIP_MISMATCH');
      }
    }
    const teamId = await run('accounts: two fresh accounts, one squad, real Synapse memberships', async () => {
      for (const name of ['chain-payer', 'chain-teammate']) {
        let account;
        for (;;) {
          try { account = await createAccount(name); break; }
          catch (error) {
            if (error.serverCode !== 'RATE_LIMITED' || !Number.isFinite(error.retryAfterMs) || error.retryAfterMs <= 0 || error.retryAfterMs > 86_400_000) throw error;
            // Respect the running service's signup quota. Never rotate proxy identities or reset limits.
            const until = Date.now() + error.retryAfterMs + 1000;
            while (Date.now() < until) {
              console.log(`WAIT accounts: RATE_LIMITED; retry in ${Math.ceil((until - Date.now()) / 1000)}s`);
              await delay(Math.min(45_000, until - Date.now()));
            }
          }
        }
        accounts.push(account);
        await api('/me', { method: 'PATCH', session: account, body: { nickname: name } });
      }
      const { teamId } = await post('/teams', accounts[0], { name: '本地链上验收' });
      await join(accounts[0], accounts[1], teamId);
      return teamId;
    });
    const [payer, peer] = accounts;
    await run('wallets: production derivation and dual signatures bind both accounts', async () => {
      for (const account of accounts) {
        const config = await read('/chain/config', account);
        requireCheck(config.enabled && config.deployment?.chainId === 31337 && same(config.deployment.token, LOCAL_TOKEN) && same(config.deployment.packetContract, LOCAL_PACKETS) && config.deployment.decimals === 18, 'CHAIN_CONFIG_MISMATCH');
        account.address = deriveWalletAccount(account.mnemonic).address;
        const challenge = await post('/chain/wallet/challenge', account, { address: account.address });
        const signed = await signWalletBinding(account.mnemonic, challenge, { accountId: account.account.id, address: account.address, chainId: 31337 });
        const binding = await post('/chain/wallet/bind', account, signed);
        requireCheck(verifyWalletBinding(binding, account.account.id, 31337, account.address), 'WALLET_BINDING_MISMATCH');
        assert.deepEqual(await read('/chain/wallet', account), binding);
      }
    });
    await run('faucet: Anvil account #0 funds payer; indexed balance agrees', async () => {
      const { address, units } = faucetArguments([payer.address, '1000']);
      const before = await balance(address);
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, units] });
      const hash = await rpcCall(rpc, 'eth_sendTransaction', [{ from: LOCAL_DEPLOYER, to: LOCAL_TOKEN, data }]);
      const receipt = await poll(() => rpcCall(rpc, 'eth_getTransactionReceipt', [hash]));
      requireCheck(receipt.status === '0x1', 'FAUCET_REVERTED');
      assert.equal(await balance(address), before + units);
      await poll(async () => BigInt((await read('/chain/balance', payer)).balance) === before + units);
    });
    async function wallet(account) {
      const values = new Map(), tails = new Map();
      const storage = { async get(key) { return structuredClone(values.get(key)); }, async put(key, _account, _kind, value) { values.set(key, structuredClone(value)); } };
      const locks = { request(name, callback) { const pending = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(callback); tails.set(name, pending); return pending; } };
      const password = Array.from({ length: PIN_LENGTH }, () => randomInt(10)).join('');
      await storage.put('vault', account.account.id, 'vault', await sealMnemonic(account.mnemonic, password));
      const keys = new WalletKeys({ storage, locks, accountId: account.account.id, check() {} });
      keys.initialize(account.mnemonic);
      const transport = { request(id, { params = {}, query = {}, body, key } = {}) {
        const endpoint = endpointsById[id];
        return api(pathFor(endpoint, params, query), { method: endpoint.method, session: account, body, key });
      } };
      // Supply the headless host with fresh business state; recipient rules stay in production code.
      const recipientHost = { accountId: account.account.id, recipients: new Map(), runtime: { state: { remoteTeams: [], rooms: { blocked: [] } }, api: transport, auth: { scope: () => ({ check() {} }) } } };
      const controller = new WalletController({ storage, locks, keys, accountId: account.account.id, address: account.address, api: walletApi(transport), check() {},
        validateRecipient: async (input, order) => {
          recipientHost.runtime.state.remoteTeams = (await read('/me', account)).teams;
          await WalletRuntime.prototype.validateRecipient.call(recipientHost, input, order);
        },
      });
      const owned = { controller, keys, password, values };
      wallets.push(owned);
      await controller.start();
      requireCheck(controller.snapshot().availability === 'ready', 'WALLET_NOT_READY');
      return owned;
    }
    // The peer only needs a bound wallet: grabs are settled by the service, never signed by the receiver.
    const payerWallet = await wallet(payer); await wallet(peer);
    async function pay(account, owned, input) {
      await owned.controller.refresh();
      const reviewed = await owned.controller.review(input);
      const submitted = await owned.controller.confirm(owned.password);
      requireCheck(['pending', 'confirmed'].includes(submitted.phase), submitted.error ?? 'PAYMENT_NOT_SUBMITTED');
      const order = await poll(async () => {
        const result = await read(`/chain/orders/${reviewed.id}`, account);
        requireCheck(!['failed', 'expired'].includes(result.status), 'ORDER_FAILED');
        const payment = await owned.controller.reconcile();
        requireCheck(!['failed', 'expired'].includes(payment?.phase), payment?.error ?? 'RELAY_FAILED');
        return result.status === 'confirmed' && payment?.phase === 'confirmed' && result;
      });
      requireCheck(order.transactionHash && order.confirmedAt, 'CONFIRMATION_MISSING');
      return order;
    }
    async function record(account, order, kind, amount, from, to, packetId = null) {
      return poll(async () => {
        let cursor;
        do {
          const page = await read(`/chain/records?direction=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, account);
          const item = page.items.find(row => row.transactionHash === order.transactionHash && row.kind === kind && row.packetId === packetId && same(row.from, from) && same(row.to, to));
          if (item) {
            assert.equal(item.status, 'confirmed'); assert.equal(item.amount, amount);
            if (order.id) assert.equal(item.orderId, order.id);
            return item;
          }
          cursor = page.nextCursor;
        } while (cursor);
        return false;
      });
    }
    await run('teammate transfer: signed relay, indexed order, balances and both records/feeds', async () => {
      const amount = '7000000000000000000', before = await balance(peer.address);
      const order = await pay(payer, payerWallet, { kind: 'transfer', teamId, recipientId: peer.account.id, amount });
      assert.equal(await balance(peer.address), before + BigInt(amount));
      for (const account of accounts) {
        await record(account, order, 'transfer', amount, payer.address, peer.address);
        const feed = await read(`/chain/teams/${teamId}/feed`, account);
        requireCheck(feed.transfers.some(item => item.id === order.id && item.status === 'confirmed' && item.transactionHash === order.transactionHash), 'TRANSFER_FEED_MISMATCH');
      }
    });
    await run('address transfer: production review/signing, indexed order, exact recipient balance', async () => {
      const recipient = deriveWalletAccount(generateMnemonic()).address, amount = '5000000000000000000';
      assert.equal(await balance(recipient), 0n);
      const order = await pay(payer, payerWallet, { kind: 'transfer', recipient, amount });
      assert.equal(await balance(recipient), BigInt(amount));
      await record(payer, order, 'transfer', amount, payer.address, recipient);
    });
    const packet = await run('squad red packet: two random shares (a two-member squad, sender included), signed create, indexed 发红包 record', async () => {
      const input = createPacketInput({ kind: 'team', scope: teamId, count: 2, distribution: 'random', total: '30000000000000000000', blessing: '本地联调' });
      const order = await pay(payer, payerWallet, input);
      const detail = await read(`/chain/packets/${order.id}`, peer);
      assert.equal(detail.packet.status, 'active'); assert.equal(detail.packet.count, 2); assert.equal(detail.packet.claimedCount, 0);
      assert.equal(detail.distribution, 'random'); assert.equal(detail.eligibility, 'eligible');
      await record(payer, order, 'packet', order.amount, payer.address, LOCAL_PACKETS, order.id);
      return order;
    });
    await run('squad grabs: no signature, both shares assigned in order, batch settlement, best share and 领取 records', async () => {
      const before = { payer: await balance(payer.address), peer: await balance(peer.address) };
      const mine = await post(`/chain/packets/${packet.id}/claim`, peer), own = await post(`/chain/packets/${packet.id}/claim`, payer);
      requireCheck(mine.status === 'issued' && mine.index === 0 && own.index === 1, 'GRAB_ORDER_MISMATCH');
      assert.deepEqual(await post(`/chain/packets/${packet.id}/claim`, peer), mine);
      const detail = await poll(async () => { const result = await read(`/chain/packets/${packet.id}`, peer); return result.claims.every(claim => claim.status === 'confirmed') && result.claims.length === 2 && result; });
      assert.equal(detail.packet.status, 'exhausted'); assert.equal(detail.packet.claimedCount, 2); assert.equal(detail.claims.filter(claim => claim.best).length, 1);
      assert.equal(await balance(peer.address), before.peer + BigInt(mine.amount));
      assert.equal(await balance(payer.address), before.payer + BigInt(own.amount));
      await record(peer, detail.myClaim, 'claim', mine.amount, LOCAL_PACKETS, peer.address, packet.id);
    });
    await run('invitation packet: invited squad join triggers automatic indexed claim', async () => {
      const { teamId: invitationTeam } = await post('/teams', payer, { name: '邀请红包验收' });
      const input = createPacketInput({ kind: 'invitation', scope: invitationTeam, count: 1, distribution: 'equal', total: '4000000000000000000' });
      const order = await pay(payer, payerWallet, input);
      await record(payer, order, 'packet', order.amount, payer.address, LOCAL_PACKETS, order.id);
      const before = await balance(peer.address);
      await join(payer, peer, invitationTeam);
      const detail = await poll(async () => { const result = await read(`/chain/packets/${order.id}`, peer); return result.myClaim?.status === 'confirmed' && result; });
      assert.equal(detail.packet.claimedCount, 1); assert.equal(detail.packet.status, 'exhausted');
      assert.equal(detail.myClaim.amount, order.amount); assert.equal(await balance(peer.address), before + BigInt(order.amount));
      await record(peer, detail.myClaim, 'claim', order.amount, LOCAL_PACKETS, peer.address, order.id);
    });
    console.log(`SUMMARY PASS ${passed}/${passed} steps; real HTTP, Synapse, Anvil, Ponder index evidence and local relay (${Math.round((Date.now() - started) / 1000)}s)`);
    console.log('NOT COVERED browser UI, real EIP-7702/EntryPoint/Alchemy sponsorship, tips, room packets, expiry/refunds, fault recovery');
  } catch (error) {
    console.error(`FAIL ${step}: ${failureCode(error)}`);
    console.error(`SUMMARY FAIL ${passed} steps passed; no services restarted or databases reset`);
    process.exitCode = 1;
  } finally {
    for (const owned of wallets) { owned.controller.dispose(); owned.keys.dispose(); owned.values.clear(); }
    for (const account of accounts) { account.identity.secretKey.fill(0); account.identity.secretStorageKey.fill(0); account.mnemonic = undefined; account.token = undefined; }
  }
}

if (isMain(import.meta.url)) {
  if (!process.execArgv.includes('--experimental-strip-types')) {
    const child = spawnSync(process.execPath, [...process.execArgv, '--experimental-strip-types', process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
    process.exitCode = child.status ?? 1;
  } else await main();
}
