import { WEEK_MS, DAY_MS, HOUR_MS } from '../units.ts';
/** Members per squad; caps membership; docs/product/teams.md#创建与身份. */
export const TEAM_MEMBER_LIMIT = 30;
/** Squads or applications per page; caps discovery responses; docs/product/teams.md#创建与身份. */
export const LOBBY_RESULT_LIMIT = 50;
/** Characters per invitation password; sizes join codes; docs/product/teams.md#创建与身份. */
export const INVITE_PASSWORD_LENGTH = 4;
/** Allowed characters; generates invitation passwords; docs/product/teams.md#创建与身份. */
export const INVITE_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Milliseconds; expires direct invitations; docs/product/teams.md#创建与身份. */
export const TEAM_INVITE_TTL_MS = WEEK_MS;
/** Milliseconds; prevents repeat direct invitations; docs/product/teams.md#创建与身份. */
export const TEAM_INVITE_COOLDOWN_MS = WEEK_MS;
/** Invitations per account per day; caps direct invitations; docs/product/teams.md#创建与身份. */
export const TEAM_INVITE_DAILY_LIMIT = 10;
/** Squads per account; caps joined squads; docs/product/teams.md#创建与身份. */
export const TEAM_JOINED_LIMIT = 20;
/** Squads per owner; caps created squads; docs/product/teams.md#创建与身份. */
export const TEAM_OWNED_LIMIT = 5;
/** Graphemes; caps squad names; docs/product/teams.md#创建与身份. */
export const TEAM_NAME_LENGTH = 40;
/** Graphemes; caps squad descriptions; docs/product/teams.md#创建与身份. */
export const TEAM_DESCRIPTION_LENGTH = 200;
/** Graphemes; caps join application notes; docs/product/teams.md#创建与身份. */
export const APPLICATION_NOTE_LENGTH = 100;
/** Graphemes; caps public squad search; docs/product/teams.md#创建与身份. */
export const PUBLIC_SEARCH_LENGTH = 60;
/** Graphemes; caps signed-in squad search; docs/product/teams.md#创建与身份. */
export const LOBBY_SEARCH_LENGTH = PUBLIC_SEARCH_LENGTH;
/** Milliseconds; expires squad invite links; docs/product/teams.md#创建与身份. */
export const INVITE_LINK_TTL_MS = 7 * DAY_MS;
/** Milliseconds; expires squad recruitment; docs/product/teams.md#创建与身份. */
export const RECRUITMENT_TTL_MS = 7 * DAY_MS;
/** Milliseconds; expires join applications; docs/product/teams.md#创建与身份. */
export const APPLICATION_TTL_MS = 7 * DAY_MS;
/** Milliseconds; delays repeat join applications; docs/product/teams.md#创建与身份. */
export const APPLICATION_COOLDOWN_MS = DAY_MS;

/** Points per level; sets squad level entry thresholds; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_LEVEL_THRESHOLDS = [0, 150, 450, 720] as const;
type LevelKey = Exclude<Extract<keyof [unknown, ...typeof TEAM_LEVEL_THRESHOLDS], `${number}`>, '0'>;
export type TeamLevel = LevelKey extends `${infer Level extends number}` ? Level : never;
/** Level numbers; defines selectable squad levels; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_LEVELS = TEAM_LEVEL_THRESHOLDS.map((_, index) => index + 1) as TeamLevel[];
/** Level number; caps squad advancement; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_MAX_LEVEL = TEAM_LEVELS.length as TeamLevel;
/** Days; measures squad activity for levels; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_ACTIVITY_WINDOW_DAYS = 30;
/** Days; measures squad heat and new-squad badges; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_HEAT_WINDOW_DAYS = 7;
/** Days; delays squad downgrades after activity falls; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_LEVEL_GRACE_DAYS = 7;
/** Messages per member per day; caps squad activity credit; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_DAILY_MESSAGE_CAP = 50;
/** Milliseconds per member per day; caps shared-viewing activity credit; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_DAILY_VIEWING_CAP_MS = 2 * HOUR_MS;
/** Active members; qualifies squads for ranking; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_RANKING_MIN_ACTIVE = 3;
/** Days; excludes upheld reported squads from ranking; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_REPORT_EXCLUSION_DAYS = 30;
/** Unitless weights; combines squad activity metrics; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_HEAT_WEIGHTS = { active: 0.30, retention: 0.25, viewing: 0.25, messages: 0.20 } as const;
/** Departed-member ratio; starts penalizing squad heat above this share; docs/product/teams.md#荣誉等级与热度. */
const TEAM_HEAT_DEPARTURE_TOLERANCE = 0.30;

export function activityDay(time: number) { return Math.floor(time / DAY_MS) * DAY_MS; }
export function levelForActivity(points: number): TeamLevel {
  return Math.max(1, TEAM_LEVEL_THRESHOLDS.filter(threshold => points >= threshold).length) as TeamLevel;
}

type TeamLevelState = { level: TeamLevel; belowSince: number | null };
export function advanceTeamLevel(previous: TeamLevelState, points: number, at: number): TeamLevelState {
  const earned = levelForActivity(points);
  if (earned >= previous.level) return { level: earned, belowSince: null };
  const belowSince = previous.belowSince ?? at;
  return at >= belowSince + TEAM_LEVEL_GRACE_DAYS * DAY_MS
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
