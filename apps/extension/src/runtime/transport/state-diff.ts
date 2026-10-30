import type { RuntimeState } from '../composition/runtime-state';
import type { EntityChange,StatePatch } from './state-patch';

type Node = { json?: string; children?: Map<string, Node>; ids?: string[] };
export type PatchSliceCache = { root?: Node };
const escapeKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

export function createPatchSliceCache(): PatchSliceCache { return {}; }

function capture(value: unknown, root = false): Node {
  if (Array.isArray(value)) {
    const ids = value.map(value => value && typeof value === 'object' ? value.id ?? value.key : undefined);
    if (ids.every((id): id is string => typeof id === 'string') && new Set(ids).size === ids.length) {
      return { ids, children: new Map(ids.map((id, index) => [id, { json: JSON.stringify(value[index]) }])) };
    }
  } else if (value && typeof value === 'object') {
    return { children: new Map(Object.entries(value).filter(([key]) => !root || key !== 'revision').map(([key, item]) => [key, capture(item)])) };
  }
  return { json: JSON.stringify(value) };
}

/** Cached content detects in-place mutations without retaining a second mutable state. */
export function diffState(previous: RuntimeState | undefined, next: RuntimeState, cache: PatchSliceCache = createPatchSliceCache()): StatePatch {
  const patch: StatePatch = { ...(previous ? { base: previous.revision } : {}), revision: next.revision, set: {} };
  const root = capture(next, true);
  function walk(path: string, value: unknown, before: Node | undefined, after: Node) {
    if (after.ids && before?.ids) {
      const upsert: [string, unknown][] = [], remove = [...before.children!.keys()].filter(id => !after.children!.has(id));
      after.ids.forEach((id, index) => { if (after.children!.get(id)!.json !== before.children!.get(id)?.json) upsert.push([id, (value as unknown[])[index]]); });
      let start = 0, end = 0;
      while (start < before.ids.length && start < after.ids.length && before.ids[start] === after.ids[start]) start++;
      while (end < before.ids.length - start && end < after.ids.length - start && before.ids[before.ids.length - end - 1] === after.ids[after.ids.length - end - 1]) end++;
      const splice: EntityChange['splice'] = start + end === before.ids.length && start + end === after.ids.length ? undefined : [start, before.ids.length - start - end, ...after.ids.slice(start, after.ids.length - end)];
      if (upsert.length || remove.length || splice) (patch.entities ??= {})[path] = { upsert, remove, ...(splice ? { splice } : {}) };
    } else if (after.children && !after.ids && before?.children && !before.ids) {
      for (const key of new Set([...before.children.keys(), ...after.children.keys()])) {
        walk(`${path}/${escapeKey(key)}`, after.children.has(key) ? (value as Record<string, unknown>)[key] : undefined, before.children.get(key), after.children.get(key) ?? {});
      }
    } else if (after.children || before?.children || after.json !== before?.json) {
      if (value === undefined) (patch.unset ??= []).push(path);
      else patch.set[path] = value;
    }
  }
  const before = previous ? cache.root ?? capture(previous, true) : undefined;
  for (const [key, node] of root.children!) walk(escapeKey(key), next[key as keyof RuntimeState], before?.children?.get(key), node);
  for (const key of before?.children?.keys() ?? []) if (!root.children!.has(key)) (patch.unset ??= []).push(escapeKey(key));
  cache.root = root;
  return patch;
}

