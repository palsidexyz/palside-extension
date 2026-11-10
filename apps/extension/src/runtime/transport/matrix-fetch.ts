import { MINUTE_MS } from '@palside/shared/units';
import { LIVE_MATRIX_METHODS, type LiveMatrixMethod } from '@palside/shared/contracts/live';
import type { LiveLink } from './api.ts';

/** How long one Matrix request may wait for the socket and its reply; the gateway ends a long poll well within it. */
const MATRIX_REQUEST_MS = MINUTE_MS;
export type EditMarks = { original: string; editBase: string };

/**
 * The Matrix client's `fetch`, carried by the live socket (`matrix` requests) instead of HTTP. `marks` names the edit a send carries,
 * which HTTP put in headers. A request that never left, or whose answer was lost with the socket, fails as a network error, the
 * way the client expects a dropped connection to.
 */
export function liveMatrixFetch(link: LiveLink, marks: (url: URL) => EditMarks | undefined): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!(LIVE_MATRIX_METHODS as readonly string[]).includes(method)) throw new TypeError(`Unsupported Matrix method ${method}`);
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new TypeError('Matrix requests carry JSON text');
    const body: unknown = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(MATRIX_REQUEST_MS)]) : AbortSignal.timeout(MATRIX_REQUEST_MS);
    let reply;
    try { reply = await link.request({ type: 'matrix', method: method as LiveMatrixMethod, path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }), ...marks(url) }, signal); }
    catch (error) {
      if (init?.signal?.aborted) throw init.signal.reason;
      throw new TypeError('Live connection unavailable', { cause: error });
    }
    const empty = reply.status === 204 || reply.status === 205 || reply.status === 304;
    return new Response(empty ? null : JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
}
