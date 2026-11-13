import { samePage } from '../../domain/annotations/interaction.ts';
import { POKE_DISPLAY,type Poke } from '../../domain/annotations/social.ts';

export function mergePoke(
  pokes: Poke[] | undefined,
  poke: Poke,
  now = Date.now(),
): Poke[] {
  const live = (pokes ?? []).filter((item) => item.at + POKE_DISPLAY > now);
  // The same call delivered twice (another sync of the same relay) counts once.
  if (live.some((item) => item.id === poke.id)) return live;
  const found = live.find(
    (item) => item.teamId === poke.teamId && item.from === poke.from && samePage(item.view.url, poke.view.url),
  );
  // Calling again to the same page joins the earlier line, which takes the newest call's id and time.
  if (found) return live.map((item) => item === found ? { ...found, id: poke.id, at: poke.at, count: found.count + 1 } : item);
  return [...live, poke];
}
