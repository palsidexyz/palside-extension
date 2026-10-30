import {
POKE_DISPLAY,
type Poke,
type TeamItems,
} from '../../domain/annotations/social.ts';

type StickyItems = Pick<TeamItems, 'stickies'>;

export function upsertTeamItem(items: StickyItems, item: NonNullable<TeamItems['stickies']>[number]): StickyItems {
  return { stickies: [...(items.stickies ?? []).filter(existing => existing.id !== item.id), item].sort((a, b) => a.timestamp - b.timestamp) };
}

export function pruneTeamItems(items: StickyItems, now = Date.now(), readable: (teamId: string) => boolean = () => true): StickyItems {
  return { stickies: (items.stickies ?? []).filter(item => item.expiresAt > now && readable(item.teamId)) };
}

export function mergePoke(
  pokes: Poke[] | undefined,
  poke: Poke,
  now = Date.now(),
): Poke[] {
  const live = (pokes ?? []).filter((item) => item.at + POKE_DISPLAY > now);
  const found = live.find(
    (item) => item.teamId === poke.teamId && item.from === poke.from && item.view.url === poke.view.url,
  );
  if (found) {
    found.count += 1;
    found.at = poke.at;
    return live;
  }
  return [...live, poke];
}
