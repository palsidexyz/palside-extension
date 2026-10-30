export function uniqueMediaIds(
  accountAvatarId: string | null | undefined,
  teams: Array<{
    avatarId?: string | null;
    people: Array<{ avatarId?: string | null }>;
  }>,
): Set<string> {
  const ids = new Set<string>();
  if (accountAvatarId) {
    ids.add(accountAvatarId);
  }
  for (const team of teams) {
    if (team.avatarId) {
      ids.add(team.avatarId);
    }
    for (const person of team.people) {
      if (person.avatarId) {
        ids.add(person.avatarId);
      }
    }
  }
  return ids;
}
