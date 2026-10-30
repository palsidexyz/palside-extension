import Type from 'typebox';
import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { strictObject } from '../validation.ts';
import { walletPerson } from '../profiles.ts';
import { chainAddress, chainAmount, chainBalance, chainClaim, chainClientConfig, chainHash, chainOrder, chainOrderInput, chainRecords, chainPacketDetail, chainTeamFeed, chainRoom, walletBinding, walletBindInput, walletChallenge } from '../chain.ts';
const id = Type.String({ minLength: 1, maxLength: 256 });
const hex = Type.String({ pattern: '^0x[0-9a-fA-F]*$' });
const nullable = <T extends ReturnType<typeof Type.String> | typeof walletBinding>(schema: T) => Type.Union([schema, Type.Null()]);
const signature = strictObject({ type: Type.Literal('secp256k1'), data: hex });
const authorization = strictObject({ packetSalt: Type.Optional(chainHash) });
const fee = strictObject({ mode: Type.Literal('sponsored') });
export const relayResult = strictObject({ requestId: id, orderId: chainHash, state: Type.Enum(['preparing', 'prepared', 'submitting', 'uncertain', 'submitted', 'included', 'confirmed', 'failed', 'expired', 'cancelled']), transactionHash: Type.Union([chainHash, Type.Null()]), error: Type.Union([Type.String(), Type.Null()]), envelope: Type.Union([Type.Null(), strictObject({
  requestId: id, orderId: chainHash, orderFingerprint: Type.String(), account: chainAddress, chainId: Type.Integer(), expiresAt: Type.Integer(),
  calls: Type.Array(strictObject({ to: chainAddress, value: chainAmount, data: hex }), { maxItems: 8 }),
  requests: Type.Array(strictObject({ type: Type.Union([Type.Literal('authorization'), Type.Literal('user-operation-v070')]), chainId: Type.Integer(), data: Type.Record(Type.String(), Type.Unknown()), signatureRequest: strictObject({ type: Type.Union([Type.Literal('eip7702Auth'), Type.Literal('personal_sign')]), rawPayload: hex, data: Type.Optional(strictObject({ raw: hex })) }) }), { maxItems: 2 }),
  fee, authorizationNonce: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]), orderAuthorization: Type.Optional(authorization),
})]) });
const write = { idempotency: 'required' as const };
export const chainRecoveryItem = strictObject({
  order: chainOrder,
  relay: Type.Union([Type.Null(), strictObject({ requestId: id, state: relayResult.properties.state, fundsReserved: Type.Boolean(), transactionHash: Type.Union([chainHash, Type.Null()]), updatedAt: Type.Integer(), expiresAt: Type.Integer() })]),
  canResume: Type.Boolean(),
});
export const chainRecovery = strictObject({ items: Type.Array(chainRecoveryItem, { maxItems: 50 }), nextCursor: Type.Union([id, Type.Null()]) });
const serviceErrors = ['CHAIN_UNAVAILABLE'] as const;
const walletWriteErrors = [...serviceErrors, 'CHAIN_DISABLED', 'CHAIN_IDEMPOTENCY_CONFLICT', 'CHAIN_WALLET_IMMUTABLE'] as const;
const accountErrors = ['ACCOUNT_UNAVAILABLE', 'CHAIN_WALLET_REQUIRED'] as const;
const paymentErrors = [...serviceErrors, ...accountErrors, 'CHAIN_DISABLED', 'CHAIN_ACCOUNT_UNAVAILABLE', 'TEAM_NOT_FOUND', 'CHAIN_TEAM_REQUIRED', 'ROOM_MESSAGE_NOT_FOUND', 'CHAIN_RECIPIENT_UNAVAILABLE'] as const;
const orderEvidenceErrors = ['CHAIN_ORDER_NOT_FOUND', 'CHAIN_EVIDENCE_INVALID', 'CHAIN_EVIDENCE_REUSED'] as const;
const packetReadErrors = ['CHAIN_PACKET_NOT_FOUND', 'CHAIN_PACKET_INVALID', 'TEAM_NOT_FOUND', 'CHAIN_TEAM_REQUIRED'] as const;
const relayErrors = ['CHAIN_RELAY_UNAVAILABLE', 'CHAIN_RELAY_REJECTED'] as const;
const relayPaymentErrors = [...paymentErrors, ...relayErrors, 'CHAIN_ORDER_NOT_FOUND', 'CHAIN_ORDER_UNAVAILABLE', 'CHAIN_ORDER_EXPIRED', 'CHAIN_PACKET_NOT_FOUND'] as const;
export const chainEndpoints = [
  endpoint({ id: 'chain.recovery', method: 'GET', path: '/chain/recovery', query: strictObject({ cursor: Type.Optional(Type.String({ pattern: '^[0-9]{1,16}:0x[0-9a-fA-F]{64}$' })), orderId: Type.Optional(chainHash) }), response: jsonResponse(chainRecovery), errors: serviceErrors }),
  endpoint({ id: 'chain.config', method: 'GET', path: '/chain/config', response: jsonResponse(chainClientConfig), errors: serviceErrors }),
  endpoint({ id: 'chain.wallet', method: 'GET', path: '/chain/wallet', response: jsonResponse(nullable(walletBinding)), errors: serviceErrors }),
  endpoint({ id: 'chain.walletPeer', method: 'GET', path: '/chain/wallet/:id', params: strictObject({ id }), response: jsonResponse(nullable(walletBinding)), errors: [...serviceErrors, 'ACCOUNT_UNAVAILABLE'] }),
  endpoint({ id: 'chain.person', method: 'GET', path: '/chain/people/:id', params: strictObject({ id }), response: jsonResponse(walletPerson), errors: [...serviceErrors, 'ACCOUNT_UNAVAILABLE'] }),
  endpoint({ id: 'chain.walletChallenge', method: 'POST', path: '/chain/wallet/challenge', ...write, body: jsonBody(strictObject({ address: chainAddress })), response: jsonResponse(walletChallenge), errors: [...walletWriteErrors, 'CHAIN_NOT_CONFIGURED'] }),
  endpoint({ id: 'chain.walletBind', method: 'POST', path: '/chain/wallet/bind', ...write, body: jsonBody(walletBindInput), response: jsonResponse(walletBinding), errors: [...walletWriteErrors, 'CHAIN_CHALLENGE_INVALID', 'CHAIN_SIGNATURE_INVALID', 'CHAIN_CHALLENGE_EXPIRED', 'CHAIN_WALLET_BOUND'] }),
  endpoint({ id: 'chain.room', method: 'GET', path: '/chain/rooms', query: strictObject({ key: id }), response: jsonResponse(chainRoom), errors: [...serviceErrors, 'ROOM_NOT_LEASED'] }),
  endpoint({ id: 'chain.packet', method: 'GET', path: '/chain/packets/:id', params: strictObject({ id: chainHash }), response: jsonResponse(chainPacketDetail), errors: [...serviceErrors, ...packetReadErrors, ...accountErrors] }),
  endpoint({ id: 'chain.teamFeed', method: 'GET', path: '/chain/teams/:id/feed', params: strictObject({ id }), query: strictObject({ cursor: Type.Optional(id) }), response: jsonResponse(chainTeamFeed), errors: [...serviceErrors, ...packetReadErrors, 'CHAIN_ORDER_UNAVAILABLE'] }),
  endpoint({ id: 'chain.orders', method: 'POST', path: '/chain/orders', ...write, body: jsonBody(chainOrderInput), response: jsonResponse(chainOrder), errors: [...paymentErrors, 'CHAIN_IDEMPOTENCY_CONFLICT', 'CHAIN_AMOUNT_INVALID', 'CHAIN_RECIPIENT_INVALID', 'CHAIN_PACKET_INVALID', 'CHAIN_TEXT_REJECTED', 'CHAIN_RATE_LIMITED', 'CHAIN_ROOM_FORBIDDEN', 'CHAIN_PACKET_LIMIT', 'CHAIN_INVITATION_UNAVAILABLE'] }),
  endpoint({ id: 'chain.order', method: 'GET', path: '/chain/orders/:id', params: strictObject({ id: chainHash }), response: jsonResponse(chainOrder), errors: [...serviceErrors, ...orderEvidenceErrors] }),
  endpoint({ id: 'chain.price', method: 'GET', path: '/chain/price', response: jsonResponse(Type.Union([Type.Null(), strictObject({ numerator: chainAmount, denominator: chainAmount, currency: Type.Literal('USD'), source: Type.Literal('pool'), blockNumber: chainAmount, updatedAt: Type.Integer({ minimum: 0 }) })])) }),
  endpoint({ id: 'chain.balance', method: 'GET', path: '/chain/balance', response: jsonResponse(chainBalance), errors: [...serviceErrors, 'CHAIN_WALLET_REQUIRED', 'CHAIN_INDEX_UNAVAILABLE'] }),
  endpoint({ id: 'chain.records', method: 'GET', path: '/chain/records', query: strictObject({ cursor: Type.Optional(Type.String({ pattern: '^(0|[1-9]\\d{0,77}):(0|[1-9]\\d{0,9}):(0|[1-9]\\d{0,9})$' })), direction: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('in'), Type.Literal('out')])) }), response: jsonResponse(chainRecords), errors: [...serviceErrors, 'CHAIN_WALLET_REQUIRED', 'CHAIN_INDEX_UNAVAILABLE'] }),
  endpoint({ id: 'chain.relayPrepare', method: 'POST', path: '/chain/relay/prepare', ...write, body: jsonBody(strictObject({ orderId: chainHash })), response: jsonResponse(relayResult), errors: [...relayPaymentErrors, 'CHAIN_SPONSOR_LIMIT'] }),
  endpoint({ id: 'chain.relaySubmit', method: 'POST', path: '/chain/relay/submit', ...write, body: jsonBody(strictObject({ requestId: id, signatures: Type.Array(signature, { minItems: 1, maxItems: 2 }) })), response: jsonResponse(relayResult), errors: relayPaymentErrors }),
  endpoint({ id: 'chain.relayCancel', method: 'POST', path: '/chain/relay/:id/cancel', ...write, params: strictObject({ id }), response: jsonResponse(relayResult), errors: [...serviceErrors, ...relayErrors, 'CHAIN_DISABLED'] }),
  endpoint({ id: 'chain.relayStatus', method: 'GET', path: '/chain/relay/:id', params: strictObject({ id }), response: jsonResponse(relayResult), errors: [...relayErrors, ...orderEvidenceErrors, 'CHAIN_DISABLED'] }),
  endpoint({ id: 'chain.claim', method: 'POST', path: '/chain/packets/:id/claim', ...write, params: strictObject({ id: chainHash }), response: jsonResponse(chainClaim), errors: [...serviceErrors, ...accountErrors, 'CHAIN_DISABLED', 'CHAIN_ACCOUNT_UNAVAILABLE', 'CHAIN_IDEMPOTENCY_CONFLICT', 'CHAIN_PACKET_NOT_FOUND', 'CHAIN_CLAIM_INELIGIBLE', 'CHAIN_PACKET_UNAVAILABLE', 'CHAIN_RATE_LIMITED'] }),
] as const;
