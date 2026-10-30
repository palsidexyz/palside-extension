import type { Team as TeamProfile,Request as TeamRequest } from '@palside/shared/models/teams';
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
  retentionDays?: number;
  readonly?: boolean;
  readonlyReason?: string;
  requested?: boolean;
};
export type Request = TeamRequest & { createdAt?: number; expiresAt?: number };
