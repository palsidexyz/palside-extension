import Type, { type StaticDecode as Static, type TSchema } from 'typebox';
import { strictObject, contractString } from './validation.ts';
import { count, timestamp } from './common.ts';

const empty = strictObject({});
const retry = strictObject({ retryAfterMs: count });
const upstream = strictObject({ retryAfterMs: Type.Optional(count) });
function definition<const S extends number, P extends TSchema>(status: S, params: P, statuses: readonly number[] = [status]) {
  return { status, statuses, params };
}
/** Business responses contain only { error: code, ...params }; transport sets Retry-After in seconds.
 * Matrix client-server paths under /_matrix/ use { errcode, error, retry_after_ms? } for matrix-js-sdk.
 * Upstream M_* codes are open-ended on that boundary. Business adapters map unrecognised upstream failures to MATRIX_ERROR.
 * lockedUntil is Unix milliseconds; retryAfterMs is a duration; remaining counts password guesses.
 * INVALID_INPUT.maximum counts graphemes for LENGTH and items for COUNT.
 */
export const errors = {
  ADMIN_JOB_BUSY: definition(409, empty),
  ACCOUNT_EXISTS: definition(409, empty),
  ACCOUNT_NOT_FOUND: definition(404, empty),
  ACCOUNT_RESTRICTED: definition(403, empty),
  ACCOUNT_BANNED: definition(403, strictObject({ expiresAt: Type.Union([timestamp, Type.Null()]) })),
  TEXT_NOT_ALLOWED: definition(400, empty),
  CHAIN_UNAVAILABLE: definition(503, empty),
  CHAIN_RELAY_UNAVAILABLE: definition(503, empty),
  CHAIN_INDEX_UNAVAILABLE: definition(503, empty),
  CHAIN_DISABLED: definition(503, empty),
  CHAIN_NOT_CONFIGURED: definition(503, empty),
  CHAIN_WALLET_REQUIRED: definition(409, empty),
  CHAIN_WALLET_IMMUTABLE: definition(409, empty),
  CHAIN_WALLET_BOUND: definition(409, empty),
  CHAIN_CHALLENGE_INVALID: definition(404, empty),
  CHAIN_CHALLENGE_EXPIRED: definition(409, empty),
  CHAIN_SIGNATURE_INVALID: definition(400, empty),
  CHAIN_AMOUNT_INVALID: definition(400, empty),
  CHAIN_TEXT_REJECTED: definition(400, empty),
  CHAIN_RECIPIENT_INVALID: definition(400, empty),
  CHAIN_ACCOUNT_UNAVAILABLE: definition(403, empty),
  CHAIN_RECIPIENT_UNAVAILABLE: definition(403, empty),
  CHAIN_TEAM_REQUIRED: definition(403, empty),
  CHAIN_ROOM_FORBIDDEN: definition(403, empty),
  CHAIN_CLAIM_INELIGIBLE: definition(403, empty),
  CHAIN_RATE_LIMITED: definition(429, empty),
  CHAIN_SPONSOR_LIMIT: definition(429, empty),
  CHAIN_IDEMPOTENCY_CONFLICT: definition(409, empty),
  CHAIN_ORDER_NOT_FOUND: definition(404, empty),
  CHAIN_ORDER_EXPIRED: definition(409, empty),
  CHAIN_ORDER_UNAVAILABLE: definition(409, empty),
  CHAIN_PACKET_NOT_FOUND: definition(404, empty),
  CHAIN_PACKET_INVALID: definition(400, empty, [400, 403, 409]),
  CHAIN_PACKET_UNAVAILABLE: definition(409, empty),
  CHAIN_PACKET_LIMIT: definition(409, empty),
  CHAIN_INVITATION_UNAVAILABLE: definition(409, empty),
  CHAIN_EVIDENCE_INVALID: definition(409, empty),
  CHAIN_EVIDENCE_REUSED: definition(409, empty),
  CHAIN_CONFIG_CHANGED: definition(409, empty),
  CHAIN_CONFIG_INVALID: definition(400, empty),
  CHAIN_RELAY_REJECTED: definition(409, strictObject({ reason: Type.String() })),
  ACCOUNT_UNAVAILABLE: definition(403, empty),
  ALREADY_JOINED: definition(409, empty),
  APPLICATION_COOLDOWN: definition(429, retry),
  APPLICATION_EXPIRED: definition(409, empty),
  AUTH_EXPIRED: definition(401, empty),
  AUTH_INVALID: definition(401, empty),
  AUTH_REPLAYED: definition(401, empty),
  AUTH_REQUIRED: definition(401, empty),
  BODY_TOO_LARGE: definition(413, empty),
  CANNOT_REMOVE_OWNER: definition(409, empty),
  DEVICE_NOT_FOUND: definition(404, empty),
  DEVICE_REVOKED: definition(401, empty),
  DRAINING: definition(503, empty),
  EDIT_CONFLICT: definition(409, empty),
  EMPTY_UPLOAD: definition(400, empty),
  INTERNAL_ERROR: definition(500, empty),
  INVALID_ACTION: definition(400, empty),
  INVALID_ENCRYPTION: definition(400, empty),
  INVALID_INPUT: definition(400, Type.Union([empty, strictObject({ reason: Type.Enum(['COUNT', 'LENGTH']), maximum: count })])),
  INVALID_INVITE_PASSWORD: definition(400, empty),
  INVALID_JSON: definition(400, empty),
  INVALID_REACTION: definition(400, empty),
  INVALID_READ: definition(400, empty),
  INVALID_RECIPIENT: definition(403, empty),
  INVALID_REPORT: definition(400, empty),
  INVALID_RETENTION: definition(400, empty),
  INVALID_SEQUENCE: definition(400, empty),
  INVALID_VIEWING: definition(400, empty),
  INVITE_ACCOUNT_UNAVAILABLE: definition(403, empty),
  INVITE_AWAITING_REPLY: definition(409, empty),
  INVITE_EXPIRED: definition(409, empty),
  INVITE_FORBIDDEN: definition(403, empty),
  INVITE_INVALID: definition(404, empty),
  INVITE_JOIN_PENDING: definition(409, empty),
  INVITE_LIMIT: definition(429, empty),
  INVITE_MEMBER: definition(409, empty),
  INVITE_PASSWORD_LOCKED: definition(403, strictObject({ lockedUntil: timestamp, retryAfterMs: count })),
  INVITE_PASSWORD_REQUIRED: definition(400, empty),
  INVITE_PASSWORD_WRONG: definition(403, strictObject({ remaining: count })),
  INVITE_TEAM_UNAVAILABLE: definition(403, empty),
  JOIN_BLOCKED: definition(403, empty),
  JOIN_CANCELLED: definition(409, empty, [403, 409]),
  LOGIN_REQUIRED: definition(401, empty),
  MATRIX_ERROR: definition(502, upstream),
  MATRIX_UNAVAILABLE: definition(503, upstream, [502, 503]),
  MEDIA_FORBIDDEN: definition(403, empty),
  MEDIA_UNAVAILABLE: definition(404, empty),
  MESSAGE_RECALL_REQUIRED: definition(409, empty),
  METHOD_NOT_ALLOWED: definition(405, empty),
  M_BAD_JSON: definition(400, empty),
  M_FORBIDDEN: definition(403, empty),
  M_LIMIT_EXCEEDED: definition(429, upstream),
  M_NOT_FOUND: definition(404, empty),
  M_UNAVAILABLE: definition(503, empty),
  M_UNKNOWN_TOKEN: definition(401, empty),
  NICKNAME_REQUIRED: definition(409, empty),
  NOT_FOUND: definition(404, empty),
  NOT_MEMBER: definition(403, empty),
  OPERATION_CONFLICT: definition(409, empty),
  OPERATION_ENDED: definition(409, empty),
  OPERATION_EXPIRED: definition(409, empty),
  OPERATION_ID_REQUIRED: definition(400, empty),
  ORIGIN_DENIED: definition(403, empty),
  OWNED_TEAMS: definition(409, empty),
  OWNER_LIMIT: definition(409, empty),
  OWNER_MUST_TRANSFER: definition(409, empty),
  OWNER_REQUIRED: definition(403, empty),
  POW_REQUIRED: definition(400, empty),
  RATE_LIMITED: definition(429, retry),
  REACTION_RECIPIENT: definition(403, empty),
  REACTION_TOO_LARGE: definition(413, empty),
  RECRUITMENT_ENDED: definition(409, empty),
  REPORT_IMAGE_UNAVAILABLE: definition(400, empty),
  REPORT_UNAVAILABLE: definition(403, empty),
  RESULT_PENDING: definition(409, empty),
  ROOM_FORBIDDEN: definition(403, empty),
  ROOM_MESSAGE_NOT_FOUND: definition(404, empty),
  ROOM_NOT_LEASED: definition(403, empty),
  ROOM_SLOW: definition(429, retry),
  STALE_VIEWING: definition(409, empty),
  TEAM_CLOSED: definition(409, empty),
  TEAM_FULL: definition(409, empty),
  TEAM_LIMIT: definition(409, empty),
  TEAM_NOT_FOUND: definition(404, empty),
  TEAM_REQUIRED: definition(400, empty),
  TRANSACTION_CONFLICT: definition(409, empty),
  TRANSFER_PENDING: definition(409, empty),
  TRANSFER_UNAVAILABLE: definition(403, empty),
  UNSUPPORTED_IMAGE: definition(400, empty),
  UPLOAD_QUOTA: definition(429, retry),
  VIEWING_TOO_LARGE: definition(413, empty),
} as const;
export type ErrorCode = keyof typeof errors;
export type ErrorBody = { [C in ErrorCode]: { error: C } & Static<typeof errors[C]['params']> }[ErrorCode];
type ErrorSchemas = { [C in ErrorCode]: Type.TUnsafe<{ error: C } & Static<typeof errors[C]['params']>> };
export const errorSchemas = Object.fromEntries(Object.entries(errors).map(([code, definition]) => {
  const variants = Type.IsUnion(definition.params) ? definition.params.anyOf : [definition.params];
  return [code, Type.Union(variants.map(params => strictObject({ error: Type.Literal(code), ...params.properties })))];
})) as unknown as ErrorSchemas;
export const errorBody = Type.Unsafe<ErrorBody>(Type.Union(Object.values(errorSchemas).flatMap(schema => Type.IsUnion(schema) ? schema.anyOf : [schema]), { discriminator: 'error' }));
export const matrixErrorBody = strictObject({ errcode: contractString({ pattern: /^M_[A-Z_]{1,64}$/ }), error: contractString(), retry_after_ms: Type.Optional(count) });
export const transportErrors = ['INVALID_INPUT', 'ORIGIN_DENIED', 'RATE_LIMITED', 'DRAINING', 'INTERNAL_ERROR'] as const;
export const sessionErrors = ['LOGIN_REQUIRED', 'DEVICE_REVOKED', 'ACCOUNT_RESTRICTED', 'ACCOUNT_BANNED'] as const;
export const signatureErrors = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_REPLAYED'] as const;
export const memberErrors = ['TEAM_NOT_FOUND', 'NOT_MEMBER'] as const;
export const ownerErrors = [...memberErrors, 'OWNER_REQUIRED'] as const;
export const operationErrors = ['OPERATION_ID_REQUIRED', 'OPERATION_CONFLICT', 'OPERATION_ENDED'] as const;
export const joinErrors = [...operationErrors, 'ACCOUNT_UNAVAILABLE', 'TEAM_NOT_FOUND', 'TEAM_CLOSED', 'JOIN_BLOCKED', 'JOIN_CANCELLED', 'TEAM_LIMIT', 'TEAM_FULL', 'MATRIX_UNAVAILABLE', 'MATRIX_ERROR'] as const;
