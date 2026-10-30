import type { Dataset } from '../composition/dataset';

/** Display-only cache. Never restore room IDs, permissions, presence or avatar URLs. */
export type OfflineDirectory = Pick<Dataset, 'self' | 'teams' | 'people'> & { expiresAt: number };
export function offlineDirectory(data: Pick<Dataset, 'self' | 'teams' | 'people'>, expiresAt: number): OfflineDirectory {
  return {
    self: data.self, expiresAt,
    teams: data.teams.map(t => ({ id: t.id, name: t.name, description: t.description, owner: t.owner, memberIds: [...t.memberIds], memberCount: t.memberCount, joined: t.joined, readonly: t.readonly, readonlyReason: t.readonlyReason, retentionDays: t.retentionDays, muted: t.muted, unread: 0, published: false })),
    people: data.people.map(p => ({ id: p.id, name: p.name, color: p.color })),
  };
}
export function usableDirectory(value: OfflineDirectory | undefined, accountId: string, now = Date.now()) {
  return value?.self === accountId && value.expiresAt > now ? offlineDirectory(value, value.expiresAt) : undefined;
}
