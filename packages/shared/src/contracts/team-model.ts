import Type, { type StaticDecode as Static } from 'typebox';
import { denseArray, contractString, strictObject } from './validation.ts';
import { id, matrixId, count, timestamp, text } from './common.ts';
import { person, teamPerson } from './profiles.ts';
import { TEAM_NAME_LENGTH, TEAM_DESCRIPTION_LENGTH, APPLICATION_NOTE_LENGTH, TEAM_RETENTION_DAYS, EVENT_ID_LENGTH } from './limits.ts';
import { teamActivityBadge, teamActivitySummary } from '../team-activity.ts';
export const retentionDays = Type.Enum(TEAM_RETENTION_DAYS);
export const teamFields = { id, name: text(TEAM_NAME_LENGTH), description: text(TEAM_DESCRIPTION_LENGTH), avatarId: Type.Union([id, Type.Null()]), ownerName: contractString(), owner: Type.Optional(person), memberCount: count, publishedAt: Type.Union([timestamp, Type.Null()]), recruitmentExpiresAt: Type.Union([timestamp, Type.Null()]), node: contractString({ min: 1 }), activity: Type.Optional(teamActivityBadge) };
export const publicTeam = strictObject(teamFields);
export const publicListing = strictObject({ id, name: text(TEAM_NAME_LENGTH), description: text(TEAM_DESCRIPTION_LENGTH), ownerName: contractString(), memberCount: count, publishedAt: timestamp, recruitmentExpiresAt: timestamp, avatar: Type.Boolean(), ownerAvatar: Type.Boolean(), ownerPortrait: contractString(), node: contractString({ min: 1 }), activity: Type.Optional(teamActivityBadge) });
export const applicationFields = { teamId: id, accountId: id, note: text(APPLICATION_NOTE_LENGTH), status: Type.Enum(['pending', 'rejected']), createdAt: timestamp, expiresAt: timestamp, rejectedAt: Type.Union([timestamp, Type.Null()]) };
export const application = strictObject(applicationFields);
export const teamSnapshot = Type.Refine(strictObject({
  ...teamFields, ownerName: Type.Optional(contractString()), node: Type.Optional(contractString({ min: 1 })), memberCount: Type.Union([count, Type.Null()]),
  ownerId: Type.Union([id, Type.Literal('')]), roomId: matrixId, joined: Type.Boolean(), reason: Type.Union([Type.Enum(['left', 'removed', 'dissolved', 'deleted', 'cancelled']), Type.Null()]),
  people: denseArray(teamPerson), memberIds: denseArray(id), revision: count, retentionDays, membersCanInvite: Type.Boolean(), activitySummary: Type.Optional(teamActivitySummary),
  periods: denseArray(strictObject({ joinedAt: timestamp, leftAt: Type.Union([timestamp, Type.Null()]) })),
  preferences: strictObject({ muted: Type.Boolean(), readIds: denseArray(contractString({ max: EVENT_ID_LENGTH })), revision: count }),
  requests: denseArray(strictObject({ ...applicationFields, nickname: contractString(), avatarId: Type.Union([id, Type.Null()]), deleted: Type.Boolean() })),
  bans: denseArray(strictObject({ accountId: id, nickname: contractString(), deleted: Type.Boolean() })),
  transfer: Type.Union([strictObject({ teamId: id, fromId: id, toId: id, createdAt: timestamp }), Type.Null()]), inviteSuspended: Type.Boolean(),
}), value => !value.joined || value.ownerId.length > 0, () => 'expected owner for joined team');
export const lobby = strictObject({ teams: denseArray(strictObject({ ...teamFields, joined: Type.Boolean(), application: Type.Optional(applicationFields.status) })), applications: denseArray(strictObject({ ...applicationFields, team: publicTeam })) });
export type PublicTeam = Static<typeof publicTeam>;
export type PublicListing = Static<typeof publicListing>;
export type TeamSnapshot = Static<typeof teamSnapshot>;
export type Application = Static<typeof application>;
export type TeamRetentionDays = Static<typeof retentionDays>;
