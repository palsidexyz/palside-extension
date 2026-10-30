export const ACTIVITY_DAY_MS = 86_400_000;
export const TEAM_LEVELS = [1, 2, 3, 4] as const;
export type TeamLevel = (typeof TEAM_LEVELS)[number];
export const TEAM_LEVEL_THRESHOLDS = [0, 150, 450, 720] as const;
export const TEAM_ACTIVITY_WINDOW_DAYS = 30;
export const TEAM_HEAT_WINDOW_DAYS = 7;
export const TEAM_LEVEL_GRACE_DAYS = 7;
export const TEAM_ACTIVITY_ACCOUNT_AGE_DAYS = 3;
export const TEAM_DAILY_MESSAGE_CAP = 50;
export const TEAM_DAILY_VIEWING_CAP_MS = 2 * 60 * 60 * 1000;
export const TEAM_RANKING_MIN_ACTIVE = 3;
export const TEAM_REPORT_EXCLUSION_DAYS = 30;
export const TEAM_HEAT_WEIGHTS = { active: 0.30, retention: 0.25, viewing: 0.25, messages: 0.20 } as const;
const TEAM_HEAT_DEPARTURE_TOLERANCE = 0.30;

export function activityDay(time: number) { return Math.floor(time / ACTIVITY_DAY_MS) * ACTIVITY_DAY_MS; }
export function levelForActivity(points: number): TeamLevel {
  if (points >= TEAM_LEVEL_THRESHOLDS[3]) return 4;
  if (points >= TEAM_LEVEL_THRESHOLDS[2]) return 3;
  if (points >= TEAM_LEVEL_THRESHOLDS[1]) return 2;
  return 1;
}

type TeamLevelState = { level: TeamLevel; belowSince: number | null };
export function advanceTeamLevel(previous: TeamLevelState, points: number, at: number): TeamLevelState {
  const earned = levelForActivity(points);
  if (earned >= previous.level) return { level: earned, belowSince: null };
  const belowSince = previous.belowSince ?? at;
  return at >= belowSince + TEAM_LEVEL_GRACE_DAYS * ACTIVITY_DAY_MS
    ? { level: earned, belowSince: null }
    : { level: previous.level, belowSince };
}

type TeamHeatMetrics = {
  activeMembers: number; members: number; retainedMembers: number; retentionCohort: number;
  viewingMs: number; messages: number; days: number; departedMembers: number; exposedMembers: number;
};
const ratio = (numerator: number, denominator: number) => denominator > 0 ? Math.max(0, Math.min(1, numerator / denominator)) : 0;
/**
 * Normalized components, never paid volume. A week with no maturing cohort has no retention evidence,
 * so the other weights are rescaled instead of scoring retention as zero. Departures above the tolerated
 * share scale heat down continuously, reaching zero when everyone exposed this week left.
 */
export function calculateTeamHeat(metrics: TeamHeatMetrics) {
  const weights = TEAM_HEAT_WEIGHTS;
  const memberDays = metrics.members * metrics.days;
  const observed = metrics.retentionCohort > 0;
  const base = weights.active * ratio(metrics.activeMembers, metrics.members)
    + (observed ? weights.retention * ratio(metrics.retainedMembers, metrics.retentionCohort) : 0)
    + weights.viewing * ratio(metrics.viewingMs, memberDays * TEAM_DAILY_VIEWING_CAP_MS)
    + weights.messages * ratio(metrics.messages, memberDays * TEAM_DAILY_MESSAGE_CAP);
  const departureRate = ratio(metrics.departedMembers, metrics.exposedMembers);
  return base / (observed ? 1 : 1 - weights.retention) * Math.min(1, (1 - departureRate) / (1 - TEAM_HEAT_DEPARTURE_TOLERANCE));
}
