import Type, { type TSchema } from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { chainConfig } from '../chain.ts';
import { nullable, id, page, adminRef } from './common.ts';
import { accountFields, teamFields, duration } from './moderation.ts';

/** Who caused the event. The server derives it from its own context, never from a request body. */
export const adminAuditActors = ['operator', 'system', 'host', 'unauthenticated'] as const;
export const adminAuditTargets = ['account', 'team', 'case', 'report', 'room-message', 'job', 'word', 'settings', 'chain', 'operator', 'dataset'] as const;
export type AdminAuditActor = typeof adminAuditActors[number];
export type AdminAuditTarget = typeof adminAuditTargets[number];

const count = Type.Integer({ minimum: 0 });
const delta = <S extends TSchema>(schema: S) => strictObject({ before: schema, after: schema });
/** `null` = not banned; `expiresAt: null` = permanent. */
const ban = nullable(strictObject({ expiresAt: nullable(Type.Integer()) }));
const word = strictObject({ word: Type.String(), kind: Type.Enum(['reserved', 'sensitive']), builtin: Type.Boolean() });
const credentialContext = Type.Enum(['login', 'change-password', 'change-totp']);
const revoked = strictObject({ sessionsRevoked: count });
const none = strictObject({});

const event = <G extends string, T extends AdminAuditTarget, S extends TSchema>(label: string, group: G, target: T, details: S) => ({ label, group, target, details });
/**
 * The only list of persisted operation-log events. Filters, groups, labels, CSV columns and
 * drawer rendering derive from it; writers validate `details` against it before inserting.
 */
export const adminAuditRegistry = {
  'ban-account': event('封禁账号', 'moderation', 'account', strictObject({ before: ban, after: ban, duration, deleteMessages: Type.Boolean(), removedMessages: count })),
  'unban-account': event('解除封禁', 'moderation', 'account', delta(ban)),
  'clear-account': event('清除账号资料', 'moderation', 'account', strictObject({ fields: accountFields, changed: Type.Array(Type.Enum(['nickname', 'bio', 'avatar', 'tags'])) })),
  'clear-team': event('清除小队资料', 'moderation', 'team', strictObject({ fields: teamFields, changed: Type.Array(Type.Enum(['name', 'description', 'avatar'])) })),
  'hide-recruitment': event('下架招募', 'moderation', 'team', delta(strictObject({ recruiting: Type.Boolean() }))),
  'set-ranking': event('调整热度榜资格', 'moderation', 'team', delta(strictObject({ excluded: Type.Boolean(), until: nullable(Type.Integer()) }))),
  'remove-message': event('删除弹幕', 'moderation', 'room-message', strictObject({ accountId: id, roomKey: Type.String() })),
  'retry-job': event('安排任务重试', 'moderation', 'job', strictObject({ kind: Type.String(), before: strictObject({ attempts: count, nextAttemptAt: Type.Integer() }), after: strictObject({ attempts: count, nextAttemptAt: Type.Integer() }) })),
  'handle-case': event('处理举报', 'moderation', 'case', strictObject({ outcome: Type.Enum(['confirmed', 'dismissed']), reportIds: Type.Array(id, { minItems: 1 }) })),
  'view-private-report': event('首次提供私密举报内容', 'moderation', 'report', strictObject({ surface: Type.Enum(['text', 'image']) })),
  'add-word': event('添加词', 'moderation', 'word', strictObject({ word })),
  'remove-word': event('删除词', 'moderation', 'word', strictObject({ word })),
  settings: event('修改举报设置', 'config', 'settings', delta(strictObject({ reportThreshold: Type.Integer({ minimum: 1, maximum: 5 }) }))),
  'chain-config': event('修改链上配置', 'config', 'chain', delta(chainConfig)),
  'seed-local-development': event('载入演示数据', 'config', 'dataset', strictObject({ seedVersion: Type.Literal(1), rows: Type.Array(strictObject({ table: Type.String(), rows: Type.Array(Type.Record(Type.String(), Type.String())) })) })),
  login: event('登录', 'security', 'operator', none),
  logout: event('退出登录', 'security', 'operator', none),
  'credentials-failed': event('凭据验证失败', 'security', 'operator', strictObject({ context: credentialContext, failures: count })),
  'login-locked': event('凭据验证已锁定', 'security', 'operator', strictObject({ context: credentialContext, failures: count, lockedUntil: Type.Integer() })),
  'revoke-sessions': event('结束所有会话', 'security', 'operator', revoked),
  'change-password': event('修改密码', 'security', 'operator', revoked),
  'change-totp': event('更换两步验证', 'security', 'operator', revoked),
  'recover-credentials': event('主机找回运营者', 'security', 'operator', revoked),
  'reset-local-development-credentials': event('重置本地开发账号', 'security', 'operator', revoked),
} as const;
export type AdminAuditAction = keyof typeof adminAuditRegistry;
export const adminAuditActions = Object.keys(adminAuditRegistry) as AdminAuditAction[];
export type AdminAuditDetails<A extends AdminAuditAction> = Infer<typeof adminAuditRegistry[A]['details']>;

/**
 * One event as a writer submits it. `caseId` links punishments to the case decision that caused
 * them; `batchId` links the rows of one bulk command.
 */
export type AdminAuditEvent = { [A in AdminAuditAction]: {
  action: A; targetId: string; reason: string; details: AdminAuditDetails<A>;
  actor: AdminAuditActor; caseId?: string | null; batchId?: string | null;
} }[AdminAuditAction];

import { decodeContract } from '../validation.ts';
import { adminListQuery, targetId } from './common.ts';

/** Current target identity; availability does not describe the historical event. */
export const adminAuditRow = strictObject({ id, action: Type.Enum(adminAuditActions), actor: Type.Enum(adminAuditActors), targetType: Type.Enum(adminAuditTargets), targetId: Type.String(), target: strictObject({ availability: Type.Enum(['available', 'deleted', 'expired', 'missing']), entity: nullable(adminRef), name: nullable(Type.String()) }), reason: Type.String(), createdAt: Type.Integer(), caseId: nullable(Type.String()), batchId: nullable(Type.String()) });
export const adminAuditPage = page(adminAuditRow);
type AuditDetail = Infer<typeof adminAuditRow> & { events: Infer<typeof adminAuditRow>[] } & { [A in AdminAuditAction]: { action: A; targetType: typeof adminAuditRegistry[A]['target']; details: AdminAuditDetails<A> } }[AdminAuditAction];
/** Decode only the selected registry entry, keeping the action/details relationship in the inferred type. */
export const adminAuditDetail = Type.Decode(strictObject({ ...adminAuditRow.properties, details: Type.Unknown(), events: Type.Array(adminAuditRow) }), value => {
  const entry = adminAuditRegistry[value.action];
  decodeContract(Type.Literal(entry.target), value.targetType);
  return { ...value, details: decodeContract(entry.details, value.details) } as AuditDetail;
});
export type AdminAuditDetail = Infer<typeof adminAuditDetail>;

export const adminAuditQuery = strictObject({ ...adminListQuery.properties, group: Type.Optional(Type.Enum([...new Set(Object.values(adminAuditRegistry).map(entry => entry.group))])), kind: Type.Optional(Type.Enum(adminAuditActions)), actor: Type.Optional(Type.Enum(adminAuditActors)), targetType: Type.Optional(Type.Enum(adminAuditTargets)), caseId: Type.Optional(targetId) });
export type AdminAuditQuery = Infer<typeof adminAuditQuery>;
