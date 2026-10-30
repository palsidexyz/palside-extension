import Type, { type TProperties } from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { text, targetId } from './common.ts';
import { accountFields, teamFields, duration } from './moderation.ts';
import { adminCaseSteps, adminCaseReview, adminCaseStepResult, caseOutcome } from './cases.ts';

const reviews = Type.Array(adminCaseReview, { minItems: 1, maxItems: 100 });
const action = <T extends string, F extends TProperties = Record<never, never>>(name: T, fields = {} as F) => strictObject({ action: Type.Literal(name), targetId, reason: text, ...fields });
export const adminAction = Type.Union([
  action('ban-account', { duration, deleteMessages: Type.Boolean() }),
  action('unban-account'),
  action('clear-account', { fields: accountFields }),
  action('clear-team', { fields: teamFields }),
  action('hide-recruitment'),
  action('set-ranking', { hidden: Type.Boolean() }),
  action('remove-message'),
  action('retry-job'),
  strictObject({ action: Type.Literal('handle-case'), ...adminCaseReview.properties, outcome: caseOutcome, steps: Type.Optional(adminCaseSteps), reason: text }),
  strictObject({ action: Type.Literal('bulk-ban'), targetIds: Type.Array(targetId, { minItems: 1, maxItems: 100, uniqueItems: true }), duration, deleteMessages: Type.Boolean(), reason: text }),
  strictObject({ action: Type.Literal('bulk-dismiss'), reviews, reason: text }),
]);
export type AdminAction = Infer<typeof adminAction>;
export const adminActionResult = strictObject({ applied: Type.Literal(true), auditIds: Type.Array(Type.String()), cases: Type.Optional(Type.Array(strictObject({ id: targetId, revision: Type.Integer(), outcome: caseOutcome, results: Type.Array(adminCaseStepResult) }))) });
export type AdminActionResult = Infer<typeof adminActionResult>;
