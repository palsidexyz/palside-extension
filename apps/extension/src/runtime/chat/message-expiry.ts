import { DAY_MS as DAY } from '@palside/shared/units';
import { TEAM_RETENTION_CAP_DAYS } from '@palside/shared/rules/retention';
import type { Message } from '../../domain/chat/model';

/** Expiry of something a squad keeps permanently: finite, so it survives JSON and every `<= now` comparison stays plain. */
export const PERMANENT = Number.MAX_SAFE_INTEGER;

/** The earlier of the server's expiry and the squad period; `0` (already expired) when the squad is unknown. */
export function messageExpiry(unsignedExpiresAt: unknown, timestamp?: number, retentionDays?: number | null): number {
  // A cached PERMANENT is not a server deadline: the squad's current period decides again (and an unknown squad expires).
  const server = typeof unsignedExpiresAt === 'number' && Number.isFinite(unsignedExpiresAt) && unsignedExpiresAt !== PERMANENT ? unsignedExpiresAt : Infinity;
  const local = typeof timestamp === 'number' && Number.isFinite(timestamp) && typeof retentionDays === 'number' && Number.isFinite(retentionDays) && retentionDays > 0 ? timestamp + retentionDays * DAY : Infinity;
  const expiresAt = Math.min(server, local);
  return Number.isFinite(expiresAt) ? expiresAt : retentionDays === null ? PERMANENT : 0;
}

/** Chat images last at most 30 days after sending, even when the squad keeps text permanently. */
export function imageExpiry(message: Pick<Message, 'timestamp'>, expiresAt: number) { return message.timestamp === undefined ? expiresAt : Math.min(expiresAt, message.timestamp + TEAM_RETENTION_CAP_DAYS * DAY); }
