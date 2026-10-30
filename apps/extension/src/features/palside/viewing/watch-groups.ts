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
