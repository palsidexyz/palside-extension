import { translator } from '@palside/i18n';
import { pageKey,shortAddress } from '@palside/shared/navigation';
import { viewingKey,type Viewing } from '../../../domain/assets/model.ts';
import { type Person } from '../../../domain/account/model.ts';
export type WatchSource = { key: string; url: string; view: Viewing; members: Person[] };
export type WatchGroup = { key: string; view: Viewing; members: Person[]; sources: WatchSource[] };
/** Each account contributes once. Sender snapshots stay separate from the derived group label. */
export function watchGroups(people: Person[], views: Viewing[]): WatchGroup[] {
  const lookup = new Map(views.map(view => [view.id, view]));
  const groups = new Map<string, WatchGroup>(); const seen = new Set<string>();
  for (const person of people) {
    if (seen.has(person.id)) continue; seen.add(person.id);
    const view = person.viewing ? lookup.get(person.viewing) : undefined; if (!view) continue;
    const url = pageKey(view.url); if (!url) continue;
    const key = viewingKey(view); const group = groups.get(key) ?? { key, view, members: [], sources: [] };
    group.members.push(person);
    const sourceKey = `${view.kind === 'website' ? view.disclosure ?? 'site' : 'asset'}:${url}`;
    let source = group.sources.find(item => item.key === sourceKey);
    if (!source) { source = { key: sourceKey, url, view, members: [] }; group.sources.push(source); }
    source.members.push(person); groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.view.kind !== 'asset' || !group.view.address) continue;
    const snapshots = group.members.map(p => lookup.get(p.viewing!)!);
    const fallback = shortAddress(group.view.address);
    const names = new Set(snapshots.map(v => v.name).filter(name => name !== fallback));
    const logos = new Set(snapshots.map(v => v.logo).filter(Boolean));
    group.view = { ...group.view, name: names.size === 1 ? [...names][0]! : fallback, logo: names.size <= 1 && logos.size === 1 ? [...logos][0] : undefined };
  }
  return [...groups.values()];
}
/** Stable ties use the previous visible order. New ties follow existing entries. */
export function rankedKeys(items: { key: string; members: unknown[] }[], previous: string[] = []) {
  const rank = new Map(previous.map((key, i) => [key, i]));
  return items.map((item, i) => ({ item, rank: rank.get(item.key) ?? previous.length + i }))
    .sort((a, b) => b.item.members.length - a.item.members.length || a.rank - b.rank).map(({ item }) => item.key);
}
export function sourceLabel(source: WatchSource, t = translator('en')) {
  if (source.view.kind === 'asset') return source.view.source;
  if (source.view.disclosure !== 'page') return t('extension.copy.siteOnly');
  const url = new URL(source.url);
  return url.pathname === '/' && !url.search && !url.hash ? t('extension.copy.websiteHome') : `${url.pathname}${url.search}${url.hash}`;
}

/** One of the two places in the 在看 row. The id stays while the page in it changes, so the chip stays put and only its
 *  content rolls. */
export type WatchSlot = { id: number; key: string };

/** A place keeps its page while anyone is on it. When its page empties it takes the busiest hidden page in place, or
 *  closes; new pages fill free places from the right. `keys` are ranked busiest first. */
export function placeSlots(previous: WatchSlot[], keys: string[], nextId: () => number, max = 2): WatchSlot[] {
  const live = new Set(keys);
  const taken = new Set(previous.filter(slot => live.has(slot.key)).map(slot => slot.key));
  const pool = keys.filter(key => !taken.has(key));
  const slots: WatchSlot[] = [];
  for (const slot of previous.slice(0, max)) {
    if (live.has(slot.key)) slots.push(slot);
    else { const key = pool.shift(); if (key) slots.push({ id: slot.id, key }); }
  }
  while (slots.length < max && pool.length) slots.push({ id: nextId(), key: pool.shift()! });
  return slots;
}

/** A hidden page that has at least `margin` more people than the quieter shown place, so it may take that place once it
 *  has stayed ahead for a while. Close counts never swap pages back and forth. */
export function overtake(slots: WatchSlot[], items: { key: string; members: unknown[] }[], keys: string[], margin = 2): WatchSlot | undefined {
  const size = new Map(items.map(item => [item.key, item.members.length]));
  const top = keys.find(key => !slots.some(slot => slot.key === key));
  if (!top || slots.length === 0) return undefined;
  const weakest = slots.reduce((a, b) => (size.get(b.key) ?? 0) < (size.get(a.key) ?? 0) ? b : a);
  return (size.get(top) ?? 0) >= (size.get(weakest.key) ?? 0) + margin ? { id: weakest.id, key: top } : undefined;
}

/** The faces a chip shows, at most `max`, kept by position: a face stays while that person is still here; when they
 *  leave, the next person takes the same place. The user leads when they are here. `members` are in team order. */
export function stickyFaces(previous: string[], members: string[], self: string, max = 2): string[] {
  const here = new Set(members);
  let faces: (string | undefined)[] = previous.slice(0, max).map(id => here.has(id) ? id : undefined);
  if (here.has(self) && !faces.includes(self)) faces = faces.length < max ? [self, ...faces] : [self, ...faces.slice(1)];
  const pool = members.filter(id => !faces.includes(id));
  faces = faces.map(id => id ?? pool.shift());
  while (faces.length < max && pool.length) faces.push(pool.shift());
  const shown = faces.filter((id): id is string => id !== undefined);
  const at = shown.indexOf(self);
  if (at > 0) [shown[0], shown[at]] = [shown[at]!, shown[0]!];
  return shown;
}
