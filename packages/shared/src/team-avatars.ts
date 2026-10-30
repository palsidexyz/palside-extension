/**
 * Preset team portraits, in their fixed order: a team without an uploaded avatar always gets the same portrait,
 * so the side panel and the website show one identity for it. Files live under /team-avatars/ on both hosts.
 */
export const defaultTeamAvatarNames = [
  'frog-ghost', 'robot-duo', 'cat-duo', 'blob-trio', 'mushroom-pals', 'cool-birds', 'ghost-high-five', 'monster-stack',
  'portrait-classics', 'portrait-cosmic', 'portrait-cozy', 'portrait-nature', 'portrait-playful', 'portrait-mischief',
  'chat-classics', 'chat-cosmic', 'chat-cozy', 'chat-night', 'chat-odd', 'chat-garden',
  'ride-boat', 'ride-spaceship', 'ride-camper', 'ride-skateboard',
] as const;
export type DefaultTeamAvatarName = typeof defaultTeamAvatarNames[number];

export const teamAvatarPath = (name: DefaultTeamAvatarName) => `/team-avatars/team-avatar-${name}.webp`;

/** FNV-1a over the team ID picks the portrait. */
export function defaultTeamAvatar(id: string): string | undefined {
  if (!id) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return teamAvatarPath(defaultTeamAvatarNames[(hash >>> 0) % defaultTeamAvatarNames.length]!);
}
