import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { nullable, id, page, adminRef, adminTeamRef } from './common.ts';

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const uint = Type.String({ pattern: '^(0|[1-9][0-9]*)$', maxLength: 256 });
/** attempts counts failures. Completed jobs have cleared payloads and are retained for seven days. */
export const adminJobRow = strictObject({
  id, kind: Type.String(), status: Type.Enum(['pending', 'running', 'retrying', 'failed-permanently', 'complete']), attempts: count,
  nextAttemptAt: nullable(count), leaseExpiresAt: nullable(count), subject: nullable(adminRef), team: nullable(adminTeamRef),
  retry: strictObject({ allowed: Type.Boolean(), blockedReason: nullable(Type.Enum(['running', 'registration-protected', 'complete', 'worker-unavailable', 'unsupported-kind', 'failed-permanently'])) }),
  createdAt: count, completedAt: nullable(count),
});
export const adminJobPage = strictObject({ ...page(adminJobRow).properties, checkedAt: count });
export const adminHealthState = Type.Enum(['ok', 'degraded', 'down', 'unconfigured', 'unverified']);
export const adminHealthDetail = Type.Enum(['QUERY_OK', 'PROTOCOL_REACHABLE', 'INDEX_REACHABLE', 'INDEX_SYNCED', 'INDEX_LAGGING', 'DEPLOYMENT_MISMATCH', 'PROVIDER_OK', 'PROVIDER_DEGRADED', 'PROVIDER_DOWN', 'PRICE_OK', 'NOT_CONFIGURED', 'PROBE_UNAVAILABLE', 'CONFIGURED_UNVERIFIED', 'TIMEOUT', 'CHECK_FAILED', 'INVALID_RESPONSE', 'SLOW_RESPONSE', 'STALE_BLOCK', 'PRICE_UNAVAILABLE', 'INVALID_PRICE']);
const sample = { state: adminHealthState, detail: adminHealthDetail, startedAt: count, checkedAt: count, latencyMs: nullable(count) };
export const adminIndexProgress = strictObject({ indexedBlock: uint, headBlock: uint, lagBlocks: uint, checkpointBlockAt: nullable(count), deploymentMatches: nullable(Type.Boolean()), synced: nullable(Type.Boolean()) });
export const adminHealthQuote = strictObject({ numerator: Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 256 }), denominator: Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 256 }), currency: Type.Literal('USD'), source: Type.Literal('pool'), blockNumber: uint, blockAt: count });
export const adminDatabaseHealth = strictObject({ id: Type.Literal('database'), ...sample });
export const adminMatrixHealth = strictObject({ id: Type.Literal('matrix'), ...sample, protocolVersions: nullable(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: 100 })) });
export const adminIndexHealth = strictObject({ id: Type.Literal('index'), ...sample, chainId: nullable(count), progress: nullable(adminIndexProgress) });
export const adminRelayHealth = strictObject({ id: Type.Literal('relay'), ...sample, configured: nullable(Type.Boolean()), provider: nullable(Type.Enum(['alchemy', 'local'])), probe: Type.Enum(['configuration', 'provider-read']) });
export const adminPriceHealth = strictObject({ id: Type.Literal('price'), ...sample, quote: nullable(adminHealthQuote) });
/** Fixed order guarantees exactly one result for each dependency. Index reachability alone is unverified. */
export const adminHealth = strictObject({ checkedAt: count, services: Type.Tuple([adminDatabaseHealth, adminMatrixHealth, adminIndexHealth, adminRelayHealth, adminPriceHealth]) });
export type AdminHealth = Infer<typeof adminHealth>;
export type AdminIndexProgress = Infer<typeof adminIndexProgress>;
