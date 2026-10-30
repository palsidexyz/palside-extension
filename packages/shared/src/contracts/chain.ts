import Type, { type StaticDecode } from 'typebox';
import { strictObject } from './validation.ts';
export const chainAddress = Type.String({ pattern: '^0x[0-9a-fA-F]{40}$' });
export const chainHash = Type.String({ pattern: '^0x[0-9a-fA-F]{64}$' });
export const chainAmount = Type.String({ pattern: '^(0|[1-9][0-9]{0,77})$' });
const time = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const identifier = Type.String({ minLength: 1, maxLength: 256 });
export const chainDeployment = strictObject({ chainId: Type.Union([Type.Literal(4663), Type.Literal(31337)]), token: chainAddress, packetContract: chainAddress, decimals: Type.Literal(18) });
// The operator's view. Clients only ever see chainClientConfig, resolved for their own account.
export const chainConfig = strictObject({ enabled: Type.Boolean(), audience: Type.Enum(['testers', 'everyone']), testers: Type.Array(identifier, { maxItems: 50 }), version: time, deployment: Type.Union([chainDeployment, Type.Null()]), dailySponsoredLimit: Type.Integer({ minimum: 0, maximum: 10000 }), updatedAt: time });
export const chainClientConfig = strictObject({ enabled: Type.Boolean(), version: time, deployment: Type.Union([chainDeployment, Type.Null()]), dailySponsoredLimit: Type.Integer({ minimum: 0, maximum: 10000 }), updatedAt: time });
export const packetInput = strictObject({ kind: Type.Enum(['team', 'invitation', 'room']), scope: identifier, count: Type.Integer({ minimum: 1, maximum: 100 }), distribution: Type.Enum(['equal', 'random']), amounts: Type.Array(chainAmount, { minItems: 1, maxItems: 100 }), allocationSalts: Type.Array(chainHash, { minItems: 1, maxItems: 100 }), blessing: Type.Optional(Type.String({ maxLength: 192 })) });
export const chainOrderInput = Type.Union([
  strictObject({ kind: Type.Literal('transfer'), teamId: identifier, recipientId: identifier, amount: chainAmount }),
  strictObject({ kind: Type.Literal('transfer'), recipient: chainAddress, amount: chainAmount }),
  strictObject({ kind: Type.Literal('tip'), messageId: identifier, amount: chainAmount }),
  strictObject({ kind: Type.Literal('packet'), packet: packetInput }),
]);
export const chainOrderStatus = Type.Enum(['quoted', 'submitted', 'confirmed', 'failed', 'expired']);
export const chainOrder = strictObject({ id: chainHash, accountId: identifier, payer: chainAddress, recipient: chainAddress, kind: Type.Enum(['transfer', 'tip', 'packet']), status: chainOrderStatus, amount: chainAmount, createdAt: time, expiresAt: time, confirmedAt: Type.Union([time, Type.Null()]), transactionHash: Type.Union([chainHash, Type.Null()]), configVersion: time, deployment: chainDeployment, payload: chainOrderInput });
// A grab: the service assigns the share in order at claimedAt; 'issued' is assigned and settling on chain, 'failed' could not settle before the escrow closed.
export const chainClaim = strictObject({ packetId: chainHash, accountId: identifier, recipient: chainAddress, index: Type.Integer({ minimum: 0, maximum: 99 }), amount: chainAmount, claimedAt: time, nonce: chainAmount, deadline: time, status: Type.Enum(['issued', 'confirmed', 'failed']), transactionHash: Type.Union([chainHash, Type.Null()]) });
// claimedCount/claimedAmount count assigned shares; expiresAt is when grabs close, not when the escrow refunds.
export const publicChainPacket = strictObject({ id: chainHash, accountId: identifier, kind: Type.Enum(['team', 'invitation', 'room']), scope: identifier, status: Type.Enum(['pending', 'active', 'exhausted', 'refunded']), count: time, amount: chainAmount, claimedCount: time, claimedAmount: chainAmount, createdAt: time, expiresAt: time });
// best marks the largest share of a finished random packet (earliest on a tie).
export const chainPacketClaimSummary = strictObject({ accountId: identifier, amount: chainAmount, claimedAt: time, status: Type.Enum(['issued', 'confirmed']), best: Type.Boolean() });
export const chainPacketDetail = strictObject({ packet: publicChainPacket, distribution: Type.Enum(['equal', 'random']), blessing: Type.String(), eligibility: Type.Enum(['eligible', 'sender', 'not-member-at-send', 'account-too-new', 'stay-too-short', 'invitation-only', 'claimed', 'unavailable', 'disabled']), eligibleAt: Type.Union([time, Type.Null()]), myClaim: Type.Union([chainClaim, Type.Null()]), claims: Type.Array(chainPacketClaimSummary) });
export const chainTransferCard = strictObject({ id: chainHash, accountId: identifier, recipientId: identifier, teamId: identifier, amount: chainAmount, createdAt: time, confirmedAt: Type.Union([time, Type.Null()]), status: chainOrderStatus, transactionHash: Type.Union([chainHash, Type.Null()]) });
export const chainTeamFeed = strictObject({ packets: Type.Array(chainPacketDetail), transfers: Type.Array(chainTransferCard), nextCursor: Type.Union([identifier, Type.Null()]) });
export const chainTipGroup = strictObject({ id: identifier, messageId: identifier, roomKey: identifier, recipientId: identifier, accountIds: Type.Array(identifier), amount: chainAmount, startedAt: time, updatedAt: time });
export const chainRoom = strictObject({ packets: Type.Array(publicChainPacket) });
export const chainConfigEvent = strictObject({ config: chainClientConfig });
export const chainEvent = Type.Union([
  strictObject({ type: Type.Literal('config'), config: chainClientConfig }),
  strictObject({ type: Type.Literal('order'), accountId: identifier, order: chainOrder }),
  strictObject({ type: Type.Literal('packet'), packetId: chainHash, scope: identifier }),
  strictObject({ type: Type.Literal('tip'), roomKey: identifier, groupId: identifier }),
]);
export const walletIdentityProof = strictObject({ id: Type.String({ pattern: '^[0-9a-f]{64}$' }), pubkey: Type.String({ pattern: '^[0-9a-f]{64}$' }), created_at: time, kind: Type.Literal(27236), tags: Type.Array(Type.Array(Type.String())), content: Type.String({ maxLength: 1024 }), sig: Type.String({ pattern: '^[0-9a-f]{128}$' }) });
export const walletChallenge = strictObject({ id: chainHash, accountId: identifier, chainId: Type.Union([Type.Literal(4663), Type.Literal(31337)]), address: chainAddress, nonce: chainHash, expiresAt: time });
export const walletBinding = strictObject({ accountId: identifier, chainId: Type.Union([Type.Literal(4663), Type.Literal(31337)]), address: chainAddress, proof: walletIdentityProof, boundAt: time });
export const walletBindInput = strictObject({ challengeId: chainHash, signature: Type.String({ pattern: '^0x[0-9a-fA-F]{130}$' }), proof: walletIdentityProof });
export const chainBalance = strictObject({ token: chainAddress, chainId: Type.Integer(), address: chainAddress, balance: chainAmount, blockNumber: chainAmount });
// Records are finalized token movements. amount is this movement, orderAmount is its linked business operation.
export const chainRecord = strictObject({ id: identifier, transactionHash: chainHash, from: chainAddress, to: chainAddress, amount: chainAmount, blockNumber: chainAmount, transactionIndex: time, logIndex: time, occurredAt: time, kind: Type.Enum(['transfer', 'tip', 'packet', 'claim', 'packet-refund']), status: Type.Literal('confirmed'), orderId: Type.Union([chainHash, Type.Null()]), packetId: Type.Union([chainHash, Type.Null()]), orderAmount: Type.Union([chainAmount, Type.Null()]), part: Type.Enum(['transfer', 'packet', 'claim', 'refund']) });
export type ChainRecord = StaticDecode<typeof chainRecord>;
export const chainRecords = strictObject({ items: Type.Array(chainRecord), nextCursor: Type.Union([identifier, Type.Null()]) });
export type WalletChallenge = StaticDecode<typeof walletChallenge>;
export type WalletBinding = StaticDecode<typeof walletBinding>;
export type ChainConfig = StaticDecode<typeof chainConfig>;
export type ChainClientConfig = StaticDecode<typeof chainClientConfig>;
export type ChainDeployment = StaticDecode<typeof chainDeployment>;
export type ChainOrderInput = StaticDecode<typeof chainOrderInput>;
export type ChainOrder = StaticDecode<typeof chainOrder>;
export type ChainClaim = StaticDecode<typeof chainClaim>;
export type ChainEvent = StaticDecode<typeof chainEvent>;
