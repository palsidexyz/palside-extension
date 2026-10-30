import { message as uiMessage,type TextValue } from '@palside/i18n';
import { TEAM_RETENTION_DAYS,TEAM_RETENTION_DEFAULT } from '@palside/shared/contracts/limits';

export const retentionOptions = TEAM_RETENTION_DAYS;
export const defaultRetentionDays = TEAM_RETENTION_DEFAULT;

/** Message for a retention period; the list is fixed server-side, so each period has its own key. */
export function retentionPeriod(days: number | undefined): TextValue {
  switch (days ?? defaultRetentionDays) {
    case 1: return uiMessage('extension.copy.retention1');
    case 7: return uiMessage('extension.copy.retention7');
    case 14: return uiMessage('extension.copy.retention14');
    default: return uiMessage('extension.copy.retention30');
  }
}
