import { samePage } from '../../domain/annotations/interaction.ts';
import { POKE_DISPLAY,type Poke } from '../../domain/annotations/social.ts';

export function mergePoke(
  pokes: Poke[] | undefined,
  poke: Poke,
  now = Date.now(),
): Poke[] {
  const live = (pokes ?? []).filter((item) => item.at + POKE_DISPLAY > now);
  const found = live.find(
    (item) => item.teamId === poke.teamId && item.from === poke.from && samePage(item.view.url, poke.view.url),
  );
  if (found) {
    found.count += 1;
    found.at = poke.at;
    return live;
  }
  return [...live, poke];
}
