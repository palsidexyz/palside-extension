import type { Team as TeamProfile,Request as TeamRequest } from '@palside/shared/models/teams';
import type { TeamRetentionDays, TeamSnapshot } from '@palside/shared/contracts/team-model';
import type { TeamActivityBadge, TeamActivitySummary } from '@palside/shared/team-activity';

export type Team = TeamProfile & {
  activity?: TeamActivityBadge;
  activitySummary?: TeamActivitySummary;
  /** Unread messages that mention this account; recomputed with `unread`. */
  mentions?: number;
  applicationStatus?: 'pending' | 'rejected';
  applicationRetryAt?: number;
  applicationExpiresAt?: number;
  publishedAt?: number;
  recruitmentExpiresAt?: number;
  /** Squad message period in days; `null` keeps messages permanently. */
  retentionDays?: TeamRetentionDays;
  readonly?: boolean;
  readonlyReason?: string;
  requested?: boolean;
  /** Live lobby only: in the recruiting pages, and the position in this account's application pages; each list keeps the server's order. */
  listed?: boolean;
  appliedOrder?: number;
};
export type Request = TeamRequest & { createdAt?: number; expiresAt?: number };

type TeamMember = TeamSnapshot['people'][number];
/** Current members that can still receive encrypted events; a purged account has no Matrix identity left. */
export function liveMembers(team: Pick<TeamSnapshot, 'people' | 'memberIds'>) {
  return team.people.filter((person): person is TeamMember & { matrixId: string } => !person.deleted && person.matrixId !== null && team.memberIds.includes(person.id));
}
