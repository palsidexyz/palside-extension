import type { Endpoint } from './endpoint.ts';
import type { EndpointId } from './endpoints.ts';
import type { EventName, EventPayload } from './events.ts';
import { MIB, MINUTE_MS } from '../units.ts';

/**
 * The live socket: the one connection a signed-in device keeps to the service. Everything realtime travels over it; a browser
 * fetch from the extension origin pays a CORS preflight for every new URL (each Matrix send has one), the socket pays nothing.
 *
 * - The client's first message is `auth` with its device token and extension version; the service answers `ready` or closes with
 *   `LIVE_UNAUTHORIZED` or `LIVE_OUTDATED`.
 * - Down: `event` pushes (the account's changes, presence, rooms, chain), `ping` every `LIVE_PING_MS`, and one `reply` per request.
 *   Each device receives its pushes in the order they were published.
 * - Up: `request` for any endpoint `carriedByLive` accepts, and `matrix` for the Matrix client API; each is answered by the status
 *   and body its HTTP route would have sent. Signed, public and binary endpoints stay on HTTP. `ping` asks for a `pong` at once:
 *   the client's own check that the socket still carries anything.
 * - Liveness: the service also sends protocol pings, which browsers answer by themselves; a socket that misses one is dropped, so a
 *   device that vanished stops counting as online within two intervals.
 * - Draining: the service sends `draining`, answers what it already received, then closes with `LIVE_GOING_AWAY`. A client sends
 *   nothing more on that socket; a request that crossed `draining` is answered `LIVE_DRAINING` and was never run.
 */
export const LIVE_PATH = '/live';
/** The `auth` message must arrive within this long of the socket opening. */
export const LIVE_AUTH_MS = 10_000;
/** The service pings this often; a client that hears nothing for `LIVE_SILENT_MS` treats the socket as gone. */
export const LIVE_PING_MS = 25_000;
export const LIVE_SILENT_MS = MINUTE_MS;
/** A client's `ping` unanswered for this long means the socket is gone. */
export const LIVE_PROBE_MS = 5_000;
/** A draining service waits at most this long for its open requests before closing. */
export const LIVE_DRAIN_MS = 10_000;
/** Status and error of a request that reached a draining socket: it never ran and may be sent again on the next socket. */
export const LIVE_DRAINING = { status: 503, error: 'DRAINING' } as const;
/** Bytes a socket may hold unsent: above `LIVE_PAUSE_BYTES` the service reads no new requests, above `LIVE_BUFFER_BYTES` it drops
 *  the socket (the client reconnects and reads again). */
export const LIVE_PAUSE_BYTES = MIB;
export const LIVE_BUFFER_BYTES = 8 * MIB;
/** Close codes: the device token was refused (sign in again), this extension version is below the minimum (update), or the service
 *  is going away (reconnect). */
export const LIVE_UNAUTHORIZED = 4401;
export const LIVE_OUTDATED = 4426;
export const LIVE_GOING_AWAY = 1001;
/** At most this many requests wait for their replies on one socket; more are refused until some answer. */
export const LIVE_INFLIGHT = 64;
/** Request ids are short opaque strings. */
export const LIVE_REQUEST_ID = /^[\w-]{1,64}$/;
export const LIVE_MATRIX_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export type LiveMatrixMethod = typeof LIVE_MATRIX_METHODS[number];

/**
 * Endpoints the socket carries: those a device token authorizes with JSON in and out. Signing out closes the device's socket before
 * its reply could arrive, so it stays on HTTP.
 */
export const carriedByLive = (endpoint: Pick<Endpoint, 'id' | 'auth' | 'body' | 'response'>) =>
  (endpoint.auth === 'bearer' || endpoint.auth === 'optional-bearer') && endpoint.body.kind !== 'binary' && endpoint.response.kind === 'json'
  && endpoint.id !== 'accounts.logout';

export type LiveRequest =
  | { type: 'request'; endpoint: EndpointId; params?: unknown; query?: unknown; body?: unknown; key?: string }
  /** `path` is the Matrix client path with its query string; `original` and `editBase` mark an edit, as the HTTP headers do. */
  | { type: 'matrix'; method: LiveMatrixMethod; path: string; body?: unknown; original?: string; editBase?: string };
export type LiveClientMessage = { type: 'auth'; token: string; version?: string } | { type: 'ping' } | (LiveRequest & { id: string });
export type LiveEvent = { [N in EventName]: { type: 'event'; event: N; data: EventPayload<N> } }[EventName];
export type LiveServerMessage =
  | { type: 'ready'; serverTime: number }
  | { type: 'reply'; id: string; status: number; body: unknown }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'draining' }
  | LiveEvent;
export type LiveReply = { status: number; body: unknown };
