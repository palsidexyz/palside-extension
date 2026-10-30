import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { contractsRoot, requireDependencies, run } from './tools.mjs';

// This automation is deliberately local-only. Public deployments require a separately
// reviewed invocation of DeployMainnet with user authorization.
const rpc = new URL(process.env.PALSIDE_CHAIN_RPC ?? 'http://127.0.0.1:8545');
if (!['127.0.0.1', '[::1]', 'localhost'].includes(rpc.hostname) || rpc.protocol !== 'http:' || rpc.username || rpc.password) throw new Error('Only an unauthenticated loopback anvil RPC is allowed');
requireDependencies();
const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
const result = await response.json();
if (result.result !== '0x7a69') throw new Error('Expected local anvil chain 31337');
await mkdir(path.join(contractsRoot, 'deployments'), { recursive: true });
const accountsResponse = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_accounts', params: [] }) });
const { result: accounts } = await accountsResponse.json();
if (!Array.isArray(accounts) || accounts.length < 2) throw new Error('Anvil must expose two unlocked fixture accounts');
run('forge', ['script', 'script/Deploy.s.sol:DeployLocal', '--rpc-url', rpc.href, '--broadcast', '--unlocked', '--sender', accounts[0]], {
  env: { ...process.env, NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(','), no_proxy: [process.env.no_proxy, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(','), PALSIDE_DEPLOYER: accounts[0], PALSIDE_VOUCHER_SIGNER: accounts[1] },
});
