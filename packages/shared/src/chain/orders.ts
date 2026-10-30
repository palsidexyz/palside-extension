import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, stringToHex, zeroHash, type Address, type Hex } from 'viem';
import type { ChainClaim, ChainOrder, WalletChallenge } from '../contracts/chain.ts';
import { redPacketAbi as palsideRedPacketAbi } from './generated.ts';
export const claimTypes = { Claim: [{ name: 'packetId', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] } as const;
export function claimTypedData(claim: ChainClaim, chainId: number, contract: Address) {
  return { domain: { name: 'PalsideRedPacket', version: '1', chainId, verifyingContract: contract }, types: claimTypes, primaryType: 'Claim' as const,
    message: { packetId: claim.packetId as Hex, recipient: claim.recipient as Address, nonce: BigInt(claim.nonce), deadline: BigInt(Math.floor(claim.deadline / 1000)) } };
}
export function walletBindingTypedData(challenge: WalletChallenge) {
  return { domain: { name: 'PalsideWalletBinding', version: '1', chainId: challenge.chainId }, primaryType: 'WalletBinding' as const,
    types: { WalletBinding: [{ name: 'accountId', type: 'string' }, { name: 'wallet', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] } as const,
    message: { accountId: challenge.accountId, wallet: challenge.address as Address, nonce: challenge.nonce as Hex, deadline: BigInt(Math.floor(challenge.expiresAt / 1000)) } };
}
export function walletIdentityContent(accountId: string, chainId: number, address: string) { return JSON.stringify({ accountId, chainId, wallet: address.toLowerCase() }); }
export function allocationHashes(packetId: Hex, amounts: readonly string[], salts: readonly string[]) {
  if (amounts.length !== salts.length) throw new Error('Allocation salt count mismatch');
  const hashes: Hex[] = Array.from({ length: amounts.length + 1 }, () => zeroHash);
  for (let i = amounts.length - 1; i >= 0; i--) hashes[i] = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint32' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [packetId, i, BigInt(amounts[i]!), salts[i] as Hex, hashes[i + 1]!]));
  return hashes;
}
export type OrderAuthorization = { packetSalt?: Hex };
export type OrderCall = { to: Address; value: '0'; data: Hex };
export function orderCalls(order: ChainOrder, authorization: OrderAuthorization): OrderCall[] {
  const token = order.deployment.token as Address, escrow = order.deployment.packetContract as Address;
  const calls: OrderCall[] = [];
  const call = (to: Address, data: Hex) => calls.push({ to, value: '0', data });
  const approve = (to: Address, amount: bigint) => { if (amount > 0n) call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [to, amount] })); };
  // Transfers and tips are plain token transfers; the relay binds the submitted transaction to this order.
  if (order.kind === 'transfer' || order.kind === 'tip') call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [order.recipient as Address, BigInt(order.amount)] }));
  if (order.kind === 'packet') {
    if (order.payload.kind !== 'packet' || !authorization.packetSalt) throw new Error('Missing packet authorization');
    const packet = order.payload.packet;
    const expectedId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [order.payer as Address, authorization.packetSalt]));
    if (expectedId !== order.id) throw new Error('Packet sender/salt mismatch');
    approve(escrow, BigInt(order.amount));
    call(escrow, encodeFunctionData({ abi: palsideRedPacketAbi, functionName: 'createPacket', args: [token, authorization.packetSalt, ({ team: 0, invitation: 1, room: 2 } as const)[packet.kind], BigInt(order.amount), packet.count, packet.distribution === 'equal' ? BigInt(packet.amounts[0]!) : 0n, packet.distribution === 'random' ? allocationHashes(order.id as Hex, packet.amounts, packet.allocationSalts)[0]! : zeroHash] }));
  }
  return calls;
}
// Keys are sorted at every level: PostgreSQL jsonb reorders stored objects, so the server's copy and the client's copy differ in key order.
const sortedJson = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export function orderFingerprint(order: ChainOrder, calls: readonly OrderCall[]) {
  return keccak256(stringToHex(sortedJson({ id: order.id, accountId: order.accountId, payer: order.payer.toLowerCase(), recipient: order.recipient.toLowerCase(), kind: order.kind, amount: order.amount, expiresAt: order.expiresAt, configVersion: order.configVersion, deployment: order.deployment, payload: order.payload, calls })));
}
