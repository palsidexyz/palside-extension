import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, http, keccak256, parseEther, zeroHash } from 'viem';
import { foundry } from 'viem/chains';
import { mockPalsAbi, redPacketAbi } from '../../packages/shared/src/chain/generated.ts';
import { contractsRoot, localDeployment, requireArtifacts } from './tools.mjs';

const rpc = new URL(process.env.PALSIDE_CHAIN_RPC ?? 'http://127.0.0.1:8545');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(rpc.hostname) || rpc.protocol !== 'http:') throw new Error('Local anvil RPC only');
requireArtifacts();
const deployment = localDeployment();
const publicClient = createPublicClient({ chain: foundry, transport: http(rpc.href) });
assert.equal(await publicClient.getChainId(), 31337);
const wallet = createWalletClient({ chain: foundry, transport: http(rpc.href) });
const accounts = await wallet.getAddresses();
const [payer, signer, bob, carol] = accounts;
assert.equal(deployment.deployer.toLowerCase(), payer.toLowerCase());
assert.equal(deployment.signer.toLowerCase(), signer.toLowerCase());
const id = () => `0x${randomBytes(32).toString('hex')}`;
const balance = (address, token) => publicClient.readContract({ address: token, abi: mockPalsAbi, functionName: 'balanceOf', args: [address] });
async function send(address, abi, functionName, args, account = payer) {
  const hash = await wallet.writeContract({ account, address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return receipt;
}
async function approve(token, address, amount) {
  await send(token, mockPalsAbi, 'approve', [address, amount]);
}
const claimTypes = { Claim: [
  { name: 'packetId', type: 'bytes32' }, { name: 'recipient', type: 'address' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] };
const now = async () => (await publicClient.getBlock()).timestamp;
const hashShare = (packetId, index, amount, salt, next) => keccak256(encodeAbiParameters([
  { type: 'bytes32' }, { type: 'uint32' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' },
], [packetId, index, amount, salt, next]));
const artifact = JSON.parse(await readFile(path.join(contractsRoot, 'out/MockPALS.sol/MockPALS.json'), 'utf8'));
const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: await wallet.deployContract({ account: payer, abi: mockPalsAbi, bytecode: artifact.bytecode.object, args: [payer] }) });
assert.equal(tokenReceipt.status, 'success');
assert.ok(tokenReceipt.contractAddress);
const tokens = [deployment.token, tokenReceipt.contractAddress];
const initial = await Promise.all(tokens.map(async token => ({ payer: await balance(payer, token), bob: await balance(bob, token), carol: await balance(carol, token) })));
let claimNonce = 1n;
async function claim(packetId, recipient, amount, salt = zeroHash, next = zeroHash) {
  const message = { packetId, recipient, nonce: claimNonce++, deadline: await now() + 300n };
  const signature = await wallet.signTypedData({ account: signer, domain: { name: 'PalsideRedPacket', version: '1', chainId: 31337, verifyingContract: deployment.redPacket }, types: claimTypes, primaryType: 'Claim', message });
  const receipt = await send(deployment.redPacket, redPacketAbi, 'claim', [message, amount, salt, next, signature], carol);
  assert.ok(receipt.logs.some(log => {
    if (log.address.toLowerCase() !== deployment.redPacket.toLowerCase()) return false;
    return decodeEventLog({ abi: redPacketAbi, data: log.data, topics: log.topics }).eventName === 'PacketClaimed';
  }));
}
// All three kinds use exact allowance, indexed events, externally signed typed data and real transactions.
const pending = [];
for (const token of tokens) for (const kind of [0, 1, 2]) {
  const salt = id();
  const packetId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [payer, salt]));
  const total = parseEther('4');
  const allocationSalt0 = id();
  const allocationSalt1 = id();
  const secondHash = hashShare(packetId, 1, parseEther('3'), allocationSalt1, zeroHash);
  const allocationHash = kind === 2 ? hashShare(packetId, 0, parseEther('1'), allocationSalt0, secondHash) : zeroHash;
  await approve(token, deployment.redPacket, total);
  const receipt = await send(deployment.redPacket, redPacketAbi, 'createPacket', [token, salt, kind, total, 2, kind === 2 ? 0n : parseEther('2'), allocationHash]);
  assert.equal(await publicClient.readContract({ address: token, abi: mockPalsAbi, functionName: 'allowance', args: [payer, deployment.redPacket] }), 0n);
  const created = receipt.logs.filter(log => log.address.toLowerCase() === deployment.redPacket.toLowerCase()).map(log => decodeEventLog({ abi: redPacketAbi, data: log.data, topics: log.topics })).find(log => log.eventName === 'PacketCreated');
  assert.ok(created);
  assert.equal(created.args.packetId, packetId);
  assert.equal(created.args.token.toLowerCase(), token.toLowerCase());
  assert.equal(created.args.sender.toLowerCase(), payer.toLowerCase());
  pending.push({ token, kind, packetId, allocationSalt0, secondHash });
}
for (const token of tokens) assert.equal(await balance(deployment.redPacket, token), parseEther('12'));
for (const { token, kind, packetId, allocationSalt0, secondHash } of pending.sort((a, b) => a.kind - b.kind)) {
  const otherToken = tokens.find(address => address !== token);
  const otherBalance = await balance(deployment.redPacket, otherToken);
  const packet = await publicClient.readContract({ address: deployment.redPacket, abi: redPacketAbi, functionName: 'packets', args: [packetId] });
  assert.equal(packet[1].toLowerCase(), token.toLowerCase());
  if (kind === 2) {
    await claim(packetId, bob, parseEther('1'), allocationSalt0, secondHash);
  } else {
    await claim(packetId, bob, parseEther('2'));
    await claim(packetId, carol, parseEther('2'));
  }
  assert.equal(await balance(deployment.redPacket, otherToken), otherBalance);
}
await wallet.request({ method: 'evm_increaseTime', params: [3600 + 7200] });
await wallet.request({ method: 'evm_mine' });
for (const { token, packetId } of pending.filter(packet => packet.kind === 2)) {
  const otherToken = tokens.find(address => address !== token);
  const otherBalance = await balance(deployment.redPacket, otherToken);
  await send(deployment.redPacket, redPacketAbi, 'refundExpired', [packetId], carol);
  assert.equal(await balance(deployment.redPacket, otherToken), otherBalance);
}
for (const [index, token] of tokens.entries()) {
  assert.equal(await balance(deployment.redPacket, token), 0n);
  assert.equal(await balance(bob, token) - initial[index].bob, parseEther('5'));
  assert.equal(await balance(carol, token) - initial[index].carol, parseEther('4'));
  assert.equal(initial[index].payer - await balance(payer, token), parseEther('9'));
  assert.equal(await balance(payer, token) + await balance(bob, token) + await balance(carol, token), initial[index].payer + initial[index].bob + initial[index].carol);
}
console.log('PASS: local Anvil typed-data signatures, three packet kinds, claims/refund, exact approvals and two-token isolation/conservation');
