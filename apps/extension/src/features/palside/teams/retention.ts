import { message as uiMessage,type TextValue } from '@palside/i18n';
import { TEAM_RETENTION_DAYS, TEAM_RETENTION_DEFAULT } from '@palside/shared/rules/retention';
import type { TeamRetentionDays } from '@palside/shared/contracts/team-model';

/** Finite periods, then permanent (`null`). */
export const retentionOptions: readonly TeamRetentionDays[] = [...TEAM_RETENTION_DAYS, null];
export const defaultRetentionDays: TeamRetentionDays = TEAM_RETENTION_DEFAULT;

/** Message for a retention period; the list is fixed server-side, so each period has its own key. */
export function retentionPeriod(days: TeamRetentionDays): TextValue {
  switch (days) {
    case 1: return uiMessage('extension.copy.retention1');
    case 7: return uiMessage('extension.copy.retention7');
    case 30: return uiMessage('extension.copy.retention30');
    case null: return uiMessage('extension.copy.retentionForever');
  }
  throw new RangeError('Invalid retention period');
}

/** Select values: the day count, or `forever` for permanent retention. */
export const retentionKey = (days: TeamRetentionDays) => days === null ? 'forever' : String(days);
export const retentionFromKey = (key: string) => retentionOptions.find(days => retentionKey(days) === key);

/** Shortening applies to existing messages at once, so it needs confirmation; permanent is the longest. */
export const isShorterRetention = (next: TeamRetentionDays, current: TeamRetentionDays) => next !== null && (current === null || next < current);
