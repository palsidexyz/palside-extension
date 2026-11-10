import type { PalsideService } from '../composition/core';

export function startedTeams(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))] : [];
}

/**
 * Completion is monotonic while the account is in the squad; a failed write keeps the mark in memory and retries on the next
 * confirmed snapshot. Marks of squads the account has left are dropped with the next write, so the list stays as long as
 * the squad list.
 */
export async function completeTeamStart(runtime: PalsideService, teamId: string) {
  const scope = runtime.auth.scope();
  if (!runtime.auth.session || !runtime.state.remoteTeams.some(team => team.id === teamId && team.joined)) return;
  const completed = startedTeams(runtime.state.preferences.startedTeams);
  if (!completed.includes(teamId)) {
    const kept = completed.filter(id => runtime.state.remoteTeams.some(team => team.id === id));
    runtime.state.preferences = { ...runtime.state.preferences, startedTeams: [...kept, teamId] };
  }
  else if (startedTeams(runtime.sharing.persistedPreferences?.startedTeams).includes(teamId)) return;
  await scope.wait(runtime.sharing.savePreferences());
}
