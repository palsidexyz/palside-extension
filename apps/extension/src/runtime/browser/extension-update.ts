/**
 * A newer extension version as the background sees it: `ready` names it once Chrome has downloaded it (applying it reloads the
 * extension), `checking` while the store is being asked. The background sends it to every panel as `{ type: 'update', status }`.
 */
export type UpdateStatus = { ready?: string; checking?: boolean };
/** What the panel's `update` command did: applied the ready version, or asked the store (`update_available` downloads it first). */
export type UpdateRequest = { applied: true } | { applied: false; check: 'update_available' | 'no_update' | 'throttled' | 'failed' };

export function readUpdateStatus(value: unknown): UpdateStatus {
  const status = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const ready = typeof status.ready === 'string' && status.ready.length <= 32 ? status.ready : undefined;
  return { ...(ready ? { ready } : {}), ...(status.checking === true ? { checking: true } : {}) };
}
