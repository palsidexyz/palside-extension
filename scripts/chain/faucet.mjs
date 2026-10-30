import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits, zeroAddress } from 'viem';
import { setTimeout as delay } from 'node:timers/promises';
import { isMain } from '../lib/release-files.mjs';
import { LOCAL_DEPLOYER, LOCAL_TOKEN, localRpc, requireLocalChain, rpcCall } from '../dev-chain.mjs';

export function faucetArguments(args) {
  const [address, amount = '1000'] = args;
  if (args.length < 1 || args.length > 2 || !isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) throw new Error('Usage: node scripts/chain/faucet.mjs <nonzero address> [amount=1000]');
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw new Error('Amount must be a positive decimal with at most 18 fractional digits');
  const units = parseUnits(amount, 18);
  if (units <= 0n || units >= 2n ** 256n) throw new Error('Amount must be a positive uint256 token amount');
  return { address, units };
}
async function main() {
  const { address, units } = faucetArguments(process.argv.slice(2));
  for (const key of ['PALSIDE_CHAIN_RPC_URL', 'PALSIDE_CHAIN_RPC']) if (process.env[key]) localRpc(process.env[key]);
  const rpc = localRpc(process.env.PALSIDE_CHAIN_RPC_URL ?? process.env.PALSIDE_CHAIN_RPC);
  await requireLocalChain(rpc);
  if (await rpcCall(rpc, 'eth_getCode', [LOCAL_TOKEN, 'latest']) === '0x') throw new Error('MockPALS is not deployed; start dev-chain first');
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, units] });
  const hash = await rpcCall(rpc, 'eth_sendTransaction', [{ from: LOCAL_DEPLOYER, to: LOCAL_TOKEN, data }]);
  console.log(`Local faucet transaction: ${hash}`);
  for (let i = 0; ; i++) {
    const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [hash]);
    if (receipt) { if (receipt.status !== '0x1') throw new Error('MockPALS transfer reverted'); break; }
    if (i === 119) throw new Error(`Transfer confirmation timed out; check transaction ${hash} before retrying`);
    await delay(500);
  }
  const balance = await rpcCall(rpc, 'eth_call', [{ to: LOCAL_TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [address] }) }, 'latest']);
  console.log(`${address}: ${formatUnits(BigInt(balance), 18)} PALS`);
}
if (isMain(import.meta.url)) await main().catch(error => { console.error(error.message); process.exitCode = 1; });
