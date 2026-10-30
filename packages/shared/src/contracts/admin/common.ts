import Type, { type TSchema } from 'typebox';
import { strictObject, type Infer } from '../validation.ts';

export const ADMIN_IDLE_MS = 12 * 60 * 60 * 1000;
export const text = Type.String({ minLength: 1, maxLength: 500 });
export const targetId = Type.String({ minLength: 1, maxLength: 512 });
export const nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);
export const id = Type.String();
export const amount = Type.String({ pattern: '^[0-9]+$' });
/** Operation-log groups: moderation actions, configuration changes, and operator sign-in and credential events. */
export const adminAuditGroups = ['moderation', 'config', 'security'] as const;
/** `to` (exclusive), `batchId` and `targetType` apply to the operation log; `role` narrows a ledger `accountId` filter. Other resources reject them. */
export const adminListQuery = strictObject({ page: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,5}$' })), pageSize: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-9][0-9]|100)$' })), sort: Type.Optional(Type.String({ pattern: '^[a-zA-Z]{1,40}$' })), direction: Type.Optional(Type.Enum(['asc', 'desc'])), q: Type.Optional(Type.String({ maxLength: 256 })), status: Type.Optional(Type.String({ pattern: '^[a-z-]{1,40}$' })), kind: Type.Optional(Type.String({ pattern: '^[a-z-]{1,40}$' })), accountId: Type.Optional(targetId), teamId: Type.Optional(targetId), targetId: Type.Optional(targetId), group: Type.Optional(Type.Enum(adminAuditGroups)), from: Type.Optional(Type.String({ pattern: '^[0-9]{1,15}$' })), to: Type.Optional(Type.String({ pattern: '^[0-9]{1,15}$' })), batchId: Type.Optional(targetId), targetType: Type.Optional(Type.String({ pattern: '^[a-z-]{1,40}$' })), role: Type.Optional(Type.Enum(['payer', 'recipient', 'sender', 'claimer'])) });
export type AdminListQuery = Infer<typeof adminListQuery>;
export const page = <S extends TSchema>(item: S) => strictObject({ items: Type.Array(item), total: Type.Integer(), page: Type.Integer(), pageSize: Type.Integer(), facets: Type.Record(Type.String(), Type.Integer()) });
/** A displayable account or squad. `name` is '' when cleared; the client shows a neutral placeholder. */
export const adminAccountRef = strictObject({ id, name: Type.String(), avatarId: nullable(Type.String()), status: Type.Enum(['active', 'restricted', 'deleted']) });
export const adminTeamRef = strictObject({ id, name: Type.String(), avatarId: nullable(Type.String()), status: Type.Enum(['provisioning', 'active', 'dissolved']) });
export const adminRef = Type.Union([strictObject({ type: Type.Literal('account'), account: adminAccountRef }), strictObject({ type: Type.Literal('team'), team: adminTeamRef }), strictObject({ type: Type.Literal('address'), address: Type.String() })]);
export type AdminAccountRef = Infer<typeof adminAccountRef>;
export type AdminTeamRef = Infer<typeof adminTeamRef>;
export type AdminRef = Infer<typeof adminRef>;
export const adminReason = strictObject({ reason: text });
/** Unknown business codes remain safe to display through the client's generic fallback. */
export const adminError = strictObject({ error: Type.String(), lockedUntil: Type.Optional(Type.Integer()), retryAfterMs: Type.Optional(Type.Integer()), remaining: Type.Optional(Type.Integer()), reason: Type.Optional(Type.String()), maximum: Type.Optional(Type.Number()), checkedAt: Type.Optional(Type.Integer()), total: Type.Optional(Type.Integer({ minimum: 0 })), existingId: Type.Optional(Type.String()), existingWord: Type.Optional(Type.String()), existingKind: Type.Optional(Type.Enum(['reserved', 'sensitive'])) });
