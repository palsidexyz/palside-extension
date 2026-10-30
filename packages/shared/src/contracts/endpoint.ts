import Type, { type StaticDecode as Static, type TSchema, type TUndefined } from 'typebox';
import { decodeContract, ContractDecodeError, strictObject, binaryBody } from './validation.ts';
import { empty, operationKey } from './common.ts';
import { JSON_BODY_BYTES } from './limits.ts';
import { errors, errorSchemas, sessionErrors, signatureErrors, transportErrors } from './errors.ts';
import type { ErrorCode } from './errors.ts';
export const rateLimitNames = ['entry', 'accountCreate', 'deviceCreateIp', 'deviceCreateAccount', 'deviceRemove', 'accountDelete', 'invitePreview', 'publicLobby', 'publicAvatar', 'recruitment', 'application', 'teamCreate', 'teamJoin', 'inviteRegenerate', 'profileEdit', 'avatarUpload', 'report', 'imageUpload', 'snapshot', 'viewing', 'reaction', 'readState', 'mediaRead', 'roomLease', 'roomMessages', 'roomRead', 'roomReport', 'roomBlocks', 'roomSummary', 'roomPeople', 'roomHot', 'roomStance', 'roomRetract', 'teamInviteRead', 'teamInviteOptions', 'teamInviteSend', 'teamInviteAccept', 'teamInviteIgnore', 'teamInviteAvatar', 'teamInvitePermission', 'roomAvatar', 'session'] as const;
type RateLimitName = typeof rateLimitNames[number];
export type RateLimit = { name: RateLimitName; enforcement?: 'success' | 'operation'; when?: 'regenerate' | 'new-publication' | 'new-application' | 'avatar' | 'non-avatar' };
export type Auth = 'public' | 'signed' | 'bearer' | 'optional-bearer';
export type Body<S extends TSchema = TSchema> = { kind: 'none' | 'json' | 'binary'; maxBytes: number; schema: S; caps?: Readonly<Record<string, number>> };
export type Response<S extends TSchema = TSchema> = { kind: 'json' | 'binary' | 'sse'; schema: S; statuses?: readonly number[] };
export const noBody = { kind: 'none', maxBytes: 0, schema: Type.Undefined() } as const;
export const jsonBody = <S extends TSchema>(schema: S) => ({ kind: 'json', maxBytes: JSON_BODY_BYTES, schema } as const);
export const jsonResponse = <S extends TSchema>(schema: S, statuses: readonly number[] = [200]) => ({ kind: 'json', schema, statuses } as const);
export const binaryResponse = { kind: 'binary', schema: binaryBody() } as const;
export type Endpoint<P extends TSchema = TSchema, Q extends TSchema = TSchema, B extends TSchema = TSchema, R extends TSchema = TSchema> = {
  id: string; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; auth: Auth;
  authorization: 'account' | 'member' | 'owner' | 'transfer-party' | 'resource';
  rateLimits: readonly RateLimit[]; params: P; query: Q; body: Body<B>; response: Response<R>;
  errors: readonly ErrorCode[]; idempotency: 'none' | 'required' | 'accept'; headers: TSchema;
};
export function endpoint<const I extends string, const M extends Endpoint['method'], const T extends string, P extends TSchema = typeof empty, Q extends TSchema = typeof empty, B extends TSchema = TUndefined, R extends TSchema = TSchema>(input: {
  id: I; method: M; path: T; auth?: Auth; authorization?: Endpoint['authorization'];
  rateLimits?: readonly (RateLimitName | RateLimit)[]; params?: P; query?: Q; body?: Body<B>;
  response: Response<R>; errors?: readonly ErrorCode[]; idempotency?: Endpoint['idempotency'];
}): Endpoint<P, Q, B, R> & { id: I; method: M; path: T } {
  const auth = input.auth ?? 'bearer';
  const idempotency = input.idempotency ?? 'none';
  const rates: RateLimit[] = input.id === 'system.health' ? [] : [{ name: 'entry' }];
  if (auth === 'bearer') rates.push({ name: 'session' });
  rates.push(...(input.rateLimits ?? []).map(rule => typeof rule === 'string' ? { name: rule } : rule));
  return {
    ...input, auth, authorization: input.authorization ?? 'account', idempotency,
    params: (input.params ?? empty) as P, query: (input.query ?? empty) as Q, body: (input.body ?? noBody) as Body<B>,
    headers: idempotency === 'none' ? empty : strictObject({ 'idempotency-key': idempotency === 'required' ? operationKey : Type.Optional(operationKey) }),
    rateLimits: rates,
    errors: [...new Set<ErrorCode>([...transportErrors.filter(code => !((input.id === 'system.health' && (code === 'DRAINING' || code === 'RATE_LIMITED')) || (input.id === 'system.ready' && code === 'DRAINING'))), ...(auth === 'bearer' || auth === 'optional-bearer' ? sessionErrors : []), ...(auth === 'signed' ? signatureErrors : []), 'BODY_TOO_LARGE', ...(input.body?.kind === 'json' ? ['INVALID_JSON'] as const : []), ...(idempotency !== 'none' ? ['OPERATION_ID_REQUIRED'] as const : []), ...(input.errors ?? [])])],
  };
}
export function pathFor<E extends { path: string; params: TSchema; query: TSchema }>(endpoint: E, params: Static<E['params']>, query?: Static<E['query']>): string {
  const parsed = decodeContract(endpoint.params, params) as Record<string, unknown>;
  const path = endpoint.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) => {
    const value = parsed[key];
    if (typeof value !== 'string' || !value || value === '.' || value === '..') throw new ContractDecodeError([key], 'expected path segment');
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  const values = decodeContract(endpoint.query, query ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) if (value !== undefined) search.set(key, String(value));
  return `${path}${search.size ? `?${search}` : ''}`;
}

/** Response schemas include each declared error status.
 * decodeContract validates and normalizes requests and responses at the transport boundary.
 * SSE and binary responses are written as streams/bytes without JSON serialization.
 */
export function routeSchema<E extends Endpoint>(endpoint: E) {
  const responses: Record<number, (E['response']['schema'] | typeof errorSchemas[ErrorCode])[]> = {};
  if (endpoint.response.kind === 'json') {
    for (const status of endpoint.response.statuses ?? [200]) responses[status] = [endpoint.response.schema];
  }
  for (const code of endpoint.errors) {
    for (const status of errors[code].statuses) {
      (responses[status] ??= []).push(errorSchemas[code]);
    }
  }
  const response = Object.fromEntries(Object.entries(responses).map(([status, schemas]) => [status, Type.Union(schemas)]));
  return { response };
}
