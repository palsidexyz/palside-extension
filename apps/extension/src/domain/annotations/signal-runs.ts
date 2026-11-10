/** One signal in the chat, as far as merging cares: who, on which page, which kind. */
export type SignalRunItem = { person: string; page: string; kind: string };
/** The kind a 共享画线 drawing counts under in a row: it joins the same person's signals on that page. */
export const DRAWING_RUN = 'drawing';
/** The kind an emote counts under in a row: `emote:<id>`, so each emote keeps its own count beside the signals. */
export const emoteRun = (emote: string) => `emote:${emote}`;
/** The emote a run kind stands for, if it is one. */
export const runEmote = (kind: string) => kind.startsWith('emote:') ? kind.slice(6) : undefined;
/** How many of one kind a merged row holds. */
export type SignalRunCount = { kind: string; count: number };

/**
 * Consecutive entries that are the same person's signals on the same page become one row: it keeps the first entry's place and
 * identity, so its counts change in place, and it replays the newest. Anything else in between, or a new day, starts another row.
 */
export function mergeSignalRuns<T>(entries: readonly T[], read: (entry: T) => (SignalRunItem & { day: string }) | undefined): { entry: T; latest: T; counts: SignalRunCount[] }[] {
  const rows: { entry: T; latest: T; counts: SignalRunCount[] }[] = [];
  let run: (SignalRunItem & { day: string }) | undefined;
  for (const entry of entries) {
    const item = read(entry), last = rows.at(-1);
    if (item && last && run && run.person === item.person && run.page === item.page && run.day === item.day) {
      last.latest = entry;
      const known = last.counts.find(count => count.kind === item.kind);
      if (known) known.count++; else last.counts.push({ kind: item.kind, count: 1 });
      continue;
    }
    rows.push({ entry, latest: entry, counts: item ? [{ kind: item.kind, count: 1 }] : [] });
    run = item;
  }
  return rows;
}
