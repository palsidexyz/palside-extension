const DAY = 86_400_000;

export function messageExpiry(unsignedExpiresAt: unknown, timestamp?: number, retentionDays?: number): number {
  const server = typeof unsignedExpiresAt === 'number' && Number.isFinite(unsignedExpiresAt) ? unsignedExpiresAt : Infinity;
  const local = typeof timestamp === 'number' && Number.isFinite(timestamp) && typeof retentionDays === 'number' && Number.isFinite(retentionDays) && retentionDays > 0 ? timestamp + retentionDays * DAY : Infinity;
  const expiresAt = Math.min(server, local);
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}
