import { RECRUITMENT_TTL_MS } from '@palside/shared/contracts/limits';
import type { Request,Team } from './model';

export function isRecruiting(team: Team, now: number) {
  return team.published && typeof team.recruitmentExpiresAt === 'number' && team.recruitmentExpiresAt > now;
}
export function publishRecruitment(team: Team, now: number): Team {
  if (isRecruiting(team, now)) return team;
  return { ...team, published: true, publishedAt: now, recruitmentExpiresAt: now + RECRUITMENT_TTL_MS };
}
export function requestIsActive(request: Request, now: number) {
  return typeof request.expiresAt === 'number' && request.expiresAt > now;
}
/** Public discovery never inherits archived/private room fields. */
export function lobbyWithMembership(listings: readonly Team[], memberships: readonly Team[]): Team[] {
  return listings.map(listing => {
    const membership = memberships.find(team => team.id === listing.id && team.joined);
    const joined = Boolean(membership);
    return { ...listing, joined, requested: joined ? false : listing.requested, memberCount: membership ? membership.memberCount ?? membership.memberIds.length : listing.memberCount };
  });
}
/** Editing does not refresh publication order or expiry. */
function filterTeams(teams: readonly Team[], query: string) {
  const search = query.trim().toLocaleLowerCase();
  return teams.filter(team => `${team.name} ${team.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}
export function publicTeams(teams: readonly Team[], query: string, now = Date.now()) {
  return filterTeams(teams.filter(team => isRecruiting(team, now)), query);
}
