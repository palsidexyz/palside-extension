/**
 * Preset personal portraits, in their fixed order: an account without an uploaded avatar always gets the same portrait,
 * so the side panel and the website show one face for it. Files live under /avatars/ on both hosts.
 */
export const defaultAvatarNames = [
  'frog', 'ghost', 'cat', 'alien', 'robot', 'duck', 'hoodie', 'dog', 'mushroom', 'crab', 'bat', 'skull', 'cactus', 'fish', 'star',
  'pear', 'three-ears', 'crown', 'sprout', 'long-nose', 'waving', 'moustache', 'rabbit', 'triangle',
] as const;
export type DefaultAvatarName = typeof defaultAvatarNames[number];

export const avatarPath = (name: DefaultAvatarName) => `/avatars/avatar-${name}.webp`;

/** FNV-1a over the account ID picks the portrait. */
export function defaultAvatarName(id: string): DefaultAvatarName | undefined {
  if (!id) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return defaultAvatarNames[(hash >>> 0) % defaultAvatarNames.length]!;
}

export const isDefaultAvatarName = (value: unknown): value is DefaultAvatarName => defaultAvatarNames.includes(value as DefaultAvatarName);

export function defaultAvatar(id: string): string | undefined {
  const name = defaultAvatarName(id);
  return name && avatarPath(name);
}

/**
 * Default portraits inside one team: members in join order keep their own portrait unless an earlier member already has it, and then
 * take the next free one. The first 24 members never share a portrait; after that the set starts again. Returns account ID → path.
 */
export function teamDefaultAvatars(memberIds: readonly string[]): Map<string, string> {
  const portraits = new Map<string, string>();
  let used = new Set<number>();
  for (const id of memberIds) {
    const name = defaultAvatarName(id);
    if (!name || portraits.has(id)) continue;
    if (used.size === defaultAvatarNames.length) used = new Set();
    let index = defaultAvatarNames.indexOf(name);
    while (used.has(index)) index = (index + 1) % defaultAvatarNames.length;
    used.add(index);
    portraits.set(id, avatarPath(defaultAvatarNames[index]!));
  }
  return portraits;
}
