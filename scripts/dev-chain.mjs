import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isMain } from './lib/release-files.mjs';
import { localDeployment, requireDependencies, root, tool } from './chain/tools.mjs';

export const LOCAL_RPC = 'http://127.0.0.1:8545';
export const LOCAL_TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const LOCAL_PACKETS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
export const LOCAL_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const LOCAL_SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const LOCAL_INDEX_CONFIG = JSON.stringify({ chainId: 31337, token: LOCAL_TOKEN, packets: LOCAL_PACKETS, startBlock: 0, schema: 'palside_index_local' });
export function privateDirectory(args, command) {
  if (args.length > 1 || args.some(arg => !arg || arg.startsWith('-'))) throw new Error(`Usage: node scripts/${command}.mjs [private-root]`);
  return resolve(args[0] ?? resolve(root, '.local'));
}
export function localRpc(value = LOCAL_RPC) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Only an unauthenticated loopback HTTP RPC is allowed');
  return url.href;
}
export async function rpcCall(rpc, method, params = []) {
  const response = await fetch(localRpc(rpc), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error(`Local RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || payload.result === undefined) throw new Error(`Local RPC ${method} failed`);
  return payload.result;
}
export async function requireLocalChain(rpc) {
  if (await rpcCall(rpc, 'eth_chainId') !== '0x7a69') throw new Error('Expected local Anvil chain 31337');
}
async function main() {
  const privateRoot = privateDirectory(process.argv.slice(2), 'dev-chain');
  for (const key of ['PALSIDE_CHAIN_RPC_URL', 'PALSIDE_CHAIN_RPC']) if (process.env[key] && localRpc(process.env[key]) !== localRpc(LOCAL_RPC)) throw new Error(`${key} must be ${LOCAL_RPC}`);
  requireDependencies();
  const probe = createServer();
  const available = await new Promise((accept, reject) => { probe.once('error', error => error.code === 'EADDRINUSE' ? accept(false) : reject(error)); probe.listen(8545, '127.0.0.1', () => probe.close(() => accept(true))); });
  if (!available) {
    await requireLocalChain(LOCAL_RPC).catch(() => { throw new Error('Port 8545 is occupied by something other than a local chain 31337; refusing to start'); });
    throw new Error('Local chain 31337 already occupies port 8545; stop it before starting this persisted Anvil');
  }
  const stateRoot = resolve(privateRoot, 'anvil');
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const anvil = spawn(tool('anvil'), ['--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337', '--hardfork', 'prague', '--slots-in-an-epoch', '1', '--block-time', '1', '--state', resolve(stateRoot, 'state.json'), '--silent'], { cwd: root, stdio: 'inherit' });
  const exited = new Promise((accept, reject) => { anvil.once('error', reject); anvil.once('exit', (code, signal) => accept({ code, signal })); });
  exited.catch(() => {});
  let stopping = false, deploy;
  const stop = signal => { stopping = true; deploy?.kill(signal); anvil.kill(signal); };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    await Promise.race([exited.then(() => { throw new Error('Anvil stopped before becoming ready'); }), (async () => {
      for (let i = 0; ; i++) {
        try { await requireLocalChain(LOCAL_RPC); break; }
        catch (error) { if (i === 99 || stopping) throw error; await delay(100); }
      }
    })()]);
    if (await rpcCall(LOCAL_RPC, 'eth_getCode', [LOCAL_PACKETS, 'latest']) === '0x') {
      console.log('Deploying local MockPALS and red packet contracts...');
      deploy = spawn(process.execPath, [resolve(root, 'scripts/chain/deploy.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, PALSIDE_CHAIN_RPC: LOCAL_RPC } });
      await new Promise((accept, reject) => { deploy.once('error', reject); deploy.once('exit', code => code === 0 ? accept() : reject(new Error(`Local deployment failed (${code}); use a fresh private root if this chain has prior deployments`))); });
      const result = localDeployment();
      if (result.chainId !== 31337 || result.token?.toLowerCase() !== LOCAL_TOKEN.toLowerCase() || result.redPacket?.toLowerCase() !== LOCAL_PACKETS.toLowerCase() || result.signer?.toLowerCase() !== LOCAL_SIGNER.toLowerCase()) throw new Error('Deployment addresses differ from the deterministic local addresses; stop and use a fresh private root');
    } else console.log('Reusing persisted contracts; no deployment needed.');
    for (const address of [LOCAL_TOKEN, LOCAL_PACKETS]) if (await rpcCall(LOCAL_RPC, 'eth_getCode', [address, 'latest']) === '0x') throw new Error(`Expected deployed contract missing at ${address}; use a fresh private root`);
    if (!stopping) console.log(`Local chain ready\nRPC: ${LOCAL_RPC}\nToken: ${LOCAL_TOKEN}\nRed packet: ${LOCAL_PACKETS}\nSigner: ${LOCAL_SIGNER}\nAdmin chain page: network = 31337; token = ${LOCAL_TOKEN}; red packet contract = ${LOCAL_PACKETS}`);
    const { code, signal } = await exited;
    if (!stopping && (code !== 0 || signal)) throw new Error(`Anvil stopped unexpectedly (${signal ?? code})`);
  } finally {
    if (anvil.exitCode === null && anvil.signalCode === null) anvil.kill('SIGINT');
    await exited.catch(() => {});
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}
if (isMain(import.meta.url)) await main().catch(error => { console.error(error.message); process.exitCode = 1; });
