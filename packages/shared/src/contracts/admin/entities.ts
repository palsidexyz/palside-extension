import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { profileTags } from '../profiles.ts';
import { nullable, page, adminAccountRef, adminTeamRef } from './common.ts';
import { adminOrderRow } from './ledger.ts';
import { adminCaseRow } from './cases.ts';
import { adminAuditRow } from './audit.ts';

export const adminEntityBan = nullable(strictObject({ expiresAt: nullable(Type.Integer()) }));
/** These exclusions are independent; clearing the manual flag does not promise a place in the ranking. */
export const adminEntityRanking = strictObject({ manualExcluded: Type.Boolean(), reportExcludedUntil: nullable(Type.Integer()) });
/** `orders` counts all orders initiated by this account, in every state. Pending counts cover queued open case episodes and their reports. */
export const adminAccountRow = strictObject({ ...adminAccountRef.properties, wallet: nullable(Type.String()), createdAt: Type.Integer(), ban: adminEntityBan, teams: Type.Integer(), orders: Type.Integer(), openCases: Type.Integer(), openReports: Type.Integer() });
export const adminTeamRow = strictObject({ ...adminTeamRef.properties, owner: adminAccountRef, members: Type.Integer(), recruiting: Type.Boolean(), ranking: adminEntityRanking, createdAt: Type.Integer(), openCases: Type.Integer(), openReports: Type.Integer() });
export const adminAccountPage = page(adminAccountRow);
export const adminTeamPage = page(adminTeamRow);
/** ⌘K: at most 5 per group; an exact id, wallet address or transaction hash ranks first. */
export const adminSearch = strictObject({ accounts: Type.Array(strictObject({ ...adminAccountRef.properties, wallet: nullable(Type.String()) })), teams: Type.Array(adminTeamRef), orders: Type.Array(adminOrderRow) });
export const adminSearchQuery = strictObject({ q: Type.String({ minLength: 1, maxLength: 256 }) });
const relatedCases = strictObject({ items: Type.Array(adminCaseRow), total: Type.Integer() });
const recentAudit = strictObject({ items: Type.Array(adminAuditRow), total: Type.Integer() });
/** Action targets come from this response: `id` for account actions, `owner.id` for a squad captain ban, and the squad `id` for squad actions. Freeze them when opening confirmation. */
export const adminAccountDetail = strictObject({ ...adminAccountRow.properties, bio: Type.String(), tags: profileTags, devicesCount: Type.Integer(), devices: Type.Array(strictObject({ id: Type.String(), label: Type.String(), createdAt: Type.Integer() })), memberships: Type.Array(strictObject({ team: adminTeamRef, role: Type.Enum(['owner', 'member']), joinedAt: Type.Integer() })), cases: relatedCases, audit: recentAudit });
export const adminTeamDetail = strictObject({ ...adminTeamRow.properties, description: Type.String(), recruitmentExpiresAt: nullable(Type.Integer()), members: Type.Array(strictObject({ account: adminAccountRef, role: Type.Enum(['owner', 'member']), joinedAt: Type.Integer() })), cases: relatedCases, audit: recentAudit });
export type AdminAccountDetail = Infer<typeof adminAccountDetail>;
export type AdminTeamDetail = Infer<typeof adminTeamDetail>;
