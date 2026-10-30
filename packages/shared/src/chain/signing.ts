import { decodeFunctionData, encodeFunctionData, hashMessage, isAddress, maxUint256, parseAbi, recoverAddress, serializeSignature, type Address, type Hex, type LocalAccount } from 'viem';
import { entryPoint07Address, getUserOperationHash, type UserOperation } from 'viem/account-abstraction';
import { hashAuthorization } from 'viem/utils';
import type { OrderAuthorization } from './orders.ts';

export const RELAY_DELEGATE = '0x77021100bD87b7008E5E1989d0eB38555d0d0000' as const;
/** MAv2 owner entity 0, global validation flag 1; SDK reserves the low 40 key bits. */
export function relayEntryPointNonceKey(nonceKey: string): bigint {
  const key = BigInt(nonceKey);
  relayAssert(key > 0n && key < (1n << 152n), 'Invalid nonce key');
  return (key << 40n) | 1n;
}
export const relayBatchAbi = parseAbi(['function executeBatch((address target, uint256 value, bytes data)[] calls) payable returns (bytes[])']);
const approveAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
export type RelayCall = { to: Address; value: string; data: Hex };
export type RelaySignature = { type: 'secp256k1'; data: Hex };
export type RelayFee = { mode: 'sponsored' };
export type RelayRequest = {
  type: 'authorization' | 'user-operation-v070'; chainId: number;
  data: Record<string, unknown>;
  signatureRequest: { type: 'eip7702Auth' | 'personal_sign'; rawPayload: Hex; data?: { raw: Hex } };
};
export type RelaySigningEnvelope = {
  requestId: string; orderId: string; orderFingerprint: string; account: Address; chainId: number;
  expiresAt: number; calls: RelayCall[]; requests: RelayRequest[]; fee: RelayFee;
  authorizationNonce: number | null; orderAuthorization?: OrderAuthorization;
};
/** Trusted order/configuration from the local payment confirmation, never copied blindly from the envelope. */
export type RelaySigningExpectation = {
  orderId: string; orderFingerprint: string; account: Address; chainId: number; calls: RelayCall[];
  authorizationNonce?: number | null;
};
export class RelayValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RelayValidationError'; }
}
export function relayAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RelayValidationError(message);
}
export const sameRelayAddress = (a: unknown, b: unknown): boolean => typeof a === 'string' && typeof b === 'string' && isAddress(a, { strict: false }) && isAddress(b, { strict: false }) && a.toLowerCase() === b.toLowerCase();
export function relayJson<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString(10) : v)) as T; }
export function relayAmount(value: unknown): bigint {
  relayAssert(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'Invalid decimal amount');
  const amount = BigInt(value); relayAssert(amount < maxUint256, 'Unlimited approval or overflowing amount'); return amount;
}
export function relayUserOperation(data: Record<string, unknown>): UserOperation<'0.7'> {
  const result = { ...data };
  for (const field of ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit']) {
    if (result[field] !== undefined) result[field] = relayAmount(result[field]);
  }
  return result as UserOperation<'0.7'>;
}
export function relayOperationHash(request: RelayRequest): Hex {
  return getUserOperationHash({ chainId: request.chainId, entryPointAddress: entryPoint07Address, entryPointVersion: '0.7', userOperation: relayUserOperation(request.data) });
}
export function relayApprove(token: Address, spender: Address, amount: string): RelayCall {
  relayAssert(relayAmount(amount) > 0n, 'Approval must be positive');
  return { to: token, value: '0', data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(amount)] }) };
}
export function validateRelayCalls(actual: readonly RelayCall[], expected: readonly RelayCall[]): void {
  relayAssert(actual.length === expected.length && actual.length > 0, 'Prepared call count mismatch');
  actual.forEach((call, i) => {
    relayAssert(call.value === '0' && expected[i]!.value === '0' && sameRelayAddress(call.to, expected[i]!.to) && call.data.toLowerCase() === expected[i]!.data.toLowerCase(), 'Prepared calls differ from the approved order');
  });
}
/** Validates all requests before any signature can be produced. No provider, API key or network access. */
export function validateRelayEnvelope(envelope: RelaySigningEnvelope, expected: RelaySigningExpectation, now = Date.now()): void {
  relayAssert(Number.isSafeInteger(envelope.expiresAt) && now < envelope.expiresAt, 'Prepared request expired');
  relayAssert(envelope.orderId === expected.orderId && envelope.orderFingerprint === expected.orderFingerprint, 'Order binding mismatch');
  relayAssert([4663, 31337].includes(expected.chainId) && envelope.chainId === expected.chainId, 'Unexpected chain');
  relayAssert(sameRelayAddress(envelope.account, expected.account), 'Account mismatch');
  validateRelayCalls(envelope.calls, expected.calls);
  // Palside only ever sponsors network fees; any other fee mode is refused before signing.
  relayAssert(envelope.fee.mode === 'sponsored' && Object.keys(envelope.fee).length === 1, 'Unexpected fee mode');
  const auth = envelope.requests.filter(r => r.type === 'authorization');
  relayAssert(envelope.requests.length === auth.length + 1 && auth.length <= 1 && envelope.requests.at(-1)?.type === 'user-operation-v070', 'Unexpected signing requests');
  relayAssert(auth.length === (envelope.authorizationNonce === null ? 0 : 1), 'Authorization count mismatch');
  if (expected.authorizationNonce !== undefined) relayAssert(expected.authorizationNonce === envelope.authorizationNonce, 'Authorization nonce mismatch');
  for (const request of envelope.requests) {
    relayAssert(request.chainId === expected.chainId, 'Signing chain mismatch');
    if (request.type === 'authorization') {
      relayAssert(sameRelayAddress(request.data.address, RELAY_DELEGATE), 'Unexpected delegation implementation');
      relayAssert(Number.isSafeInteger(request.data.nonce) && Number(request.data.nonce) >= 0 && request.data.nonce === envelope.authorizationNonce, 'Invalid authorization nonce');
      relayAssert(request.signatureRequest.type === 'eip7702Auth' && request.signatureRequest.rawPayload === hashAuthorization({ address: RELAY_DELEGATE, chainId: expected.chainId, nonce: Number(request.data.nonce) }), 'Authorization digest mismatch');
      continue;
    }
    relayAssert(sameRelayAddress(request.data.sender, expected.account), 'UserOperation sender mismatch');
    relayAssert(!request.data.factory && !request.data.factoryData && !request.data.signature && !request.data.eip7702Auth, 'Unexpected account creation or signature');
    if (request.data.paymaster === undefined) {
      relayAssert(envelope.fee.mode === 'sponsored' && ['preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(field => relayAmount(request.data[field]) === 0n), 'Missing paymaster requires zero-fee sponsorship');
      relayAssert(request.data.paymasterData === undefined && request.data.paymasterVerificationGasLimit === undefined && request.data.paymasterPostOpGasLimit === undefined, 'Unexpected paymaster fields');
    } else relayAssert(isAddress(String(request.data.paymaster), { strict: false }) && !sameRelayAddress(request.data.paymaster, '0x0000000000000000000000000000000000000000'), 'Missing paymaster');
    const decoded = decodeFunctionData({ abi: relayBatchAbi, data: request.data.callData as Hex });
    const actual = decoded.args[0].map(c => ({ to: c.target, value: c.value.toString(), data: c.data }));
    validateRelayCalls(actual, expected.calls);
    const hash = relayOperationHash(request);
    relayAssert(request.signatureRequest.type === 'personal_sign' && request.signatureRequest.data?.raw === hash && request.signatureRequest.rawPayload === hashMessage({ raw: hash }), 'UserOperation signing digest mismatch');
  }
}
export async function verifyRelaySignatures(envelope: RelaySigningEnvelope, signatures: readonly RelaySignature[]): Promise<void> {
  relayAssert(signatures.length === envelope.requests.length, 'Wrong signature count');
  for (let i = 0; i < signatures.length; i++) {
    relayAssert(signatures[i]!.type === 'secp256k1' && /^0x[0-9a-f]{130}$/i.test(signatures[i]!.data), 'Invalid signature encoding');
    const recovered = await recoverAddress({ hash: envelope.requests[i]!.signatureRequest.rawPayload, signature: signatures[i]!.data });
    relayAssert(sameRelayAddress(recovered, envelope.account), 'Signature owner mismatch');
  }
}
export async function signRelayEnvelope(account: LocalAccount, envelope: RelaySigningEnvelope, expected: RelaySigningExpectation, now = Date.now()): Promise<{ requestId: string; signatures: RelaySignature[] }> {
  relayAssert(sameRelayAddress(account.address, expected.account), 'Local signing account mismatch');
  validateRelayEnvelope(envelope, expected, now);
  const signatures: RelaySignature[] = [];
  for (const request of envelope.requests) {
    if (request.type === 'authorization') {
      relayAssert(account.signAuthorization, 'Local signer cannot authorize');
      const auth = await account.signAuthorization({ contractAddress: RELAY_DELEGATE, chainId: envelope.chainId, nonce: Number(request.data.nonce) });
      signatures.push({ type: 'secp256k1', data: serializeSignature(auth) });
    } else signatures.push({ type: 'secp256k1', data: await account.signMessage({ message: { raw: request.signatureRequest.data!.raw } }) });
  }
  return { requestId: envelope.requestId, signatures };
}
