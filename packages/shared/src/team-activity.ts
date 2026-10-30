import Type, { type StaticDecode } from 'typebox';
import { strictObject } from './contracts/validation.ts';
import { count, timestamp } from './contracts/common.ts';
import { TEAM_LEVELS } from './team-activity-rules.ts';
export * from './team-activity-rules.ts';

export const teamLevel = Type.Enum(TEAM_LEVELS);
export const teamDiscoverySort = Type.Enum(['heat', 'latest']);
export type TeamDiscoverySort = StaticDecode<typeof teamDiscoverySort>;
export const teamRankingStatus = Type.Enum(['ranked', 'insufficient-activity', 'not-recruiting', 'excluded', 'reported', 'pending']);

/** Only the rank is public; the numerical heat score stays in the business database. */
export const teamActivityBadge = strictObject({
  level: teamLevel,
  rank: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  isNew: Type.Boolean(),
});
export type TeamActivityBadge = StaticDecode<typeof teamActivityBadge>;
export const teamActivitySummary = strictObject({
  ...teamActivityBadge.properties,
  points: count,
  nextLevel: Type.Union([teamLevel, Type.Null()]),
  pointsToNextLevel: count,
  downgrade: Type.Union([strictObject({ level: teamLevel, at: timestamp }), Type.Null()]),
  averageDailyActive: Type.Number({ minimum: 0 }),
  averageDailyMessages: Type.Number({ minimum: 0 }),
  sharedViewingHours: Type.Number({ minimum: 0 }),
  activeMembers7d: count,
  rankingStatus: teamRankingStatus,
  calculatedAt: Type.Union([timestamp, Type.Null()]),
});
export type TeamActivitySummary = StaticDecode<typeof teamActivitySummary>;
