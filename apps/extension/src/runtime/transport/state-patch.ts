import type { RuntimeState } from '../composition/runtime-state';

export type EntityChange = { upsert: [string, unknown][]; remove: string[]; splice?: [number, number, ...string[]] };
export type StatePatch = {
  base?: number;
  revision: number;
  set: Record<string, unknown>;
  unset?: string[];
  entities?: Record<string, EntityChange>;
};
const entityId = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return;
  const item = value as { id?: string; key?: string };
  return item.id ?? item.key;
};

export function applyPatch(state: RuntimeState | undefined, patch: StatePatch): RuntimeState {
  let result = patch.base === undefined ? {} : state ?? {};
  function update(path: string, change: (value: unknown) => unknown) {
    const keys = path.split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    function visit(value: unknown, index: number): unknown {
      if (index === keys.length) return change(value);
      const source = value as Record<string, unknown>, key = keys[index]!;
      const item = visit(Object.hasOwn(source ?? {}, key) ? source[key] : undefined, index + 1);
      const copy = { ...source, [key]: item };
      if (item === undefined) delete copy[key];
      return copy;
    }
    result = visit(result, 0) as RuntimeState;
  }
  for (const [path, value] of Object.entries(patch.set)) update(path, () => value);
  for (const path of patch.unset ?? []) update(path, () => undefined);
  for (const [path, change] of Object.entries(patch.entities ?? {})) update(path, value => {
    const rows = value as unknown[], ids = rows.map(entityId) as string[], entries = new Map(rows.map((item, index) => [ids[index]!, item]));
    for (const id of change.remove) entries.delete(id);
    for (const [id, item] of change.upsert) entries.set(id, item);
    if (change.splice) ids.splice(...change.splice);
    return ids.map(id => entries.get(id));
  });
  return { ...result, revision: patch.revision } as RuntimeState;
}
