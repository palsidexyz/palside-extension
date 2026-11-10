import { SECOND_MS, MINUTE_MS } from '@palside/shared/units';
import { decodeContract } from '@palside/shared/contracts/validation';
import { errorMessage,message as uiMessage,MessageError,type TextMessage } from '@palside/i18n';
import { authorizationHeader,createHttpAuth } from '@palside/shared/identity';
import { endpointsById,pathFor,type EndpointId,type EndpointById } from '@palside/shared/contracts/endpoints';
import { errorBody,type ErrorBody } from '@palside/shared/contracts/errors';
import type { Infer } from '@palside/shared/contracts/validation';
import { carriedByLive,type LiveReply,type LiveRequest } from '@palside/shared/contracts/live';

const PROOF_OF_WORK_NOTICE_MS = MINUTE_MS;

export type ApiResult<I extends EndpointId> = Infer<EndpointById<I>['response']['schema']>;
export type ApiOptions<I extends EndpointId> = {
  params?: Infer<EndpointById<I>['params']>; query?: Infer<EndpointById<I>['query']> & object; body?: unknown;
  onProofOfWorkSlow?: () => void;
  key?: string; signal?: AbortSignal; secretKey?: Uint8Array; difficulty?: number; token?: string; timeoutMs?: number;
};
type ErrorFields<T> = { [K in T extends unknown ? keyof T : never]?: T extends Partial<Record<K, infer V>> ? V : never };
type ClientError = Omit<ErrorFields<ErrorBody>, 'error'> & { error: string; text?: TextMessage };
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly maximum?: number;
  readonly reason?: string;
  readonly remaining?: number;
  readonly lockedUntil?: number;
  readonly text: TextMessage;
  readonly serverDate?: number;
  constructor(status: number, result: ClientError, serverDate?: number) {
    super(result.error); this.code = result.error; this.status = status;
    this.retryAfterMs = result.retryAfterMs; this.maximum = result.maximum; this.reason = result.reason;
    this.remaining = result.remaining; this.lockedUntil = typeof result.lockedUntil === 'number' && Number.isFinite(result.lockedUntil) ? result.lockedUntil : undefined;
    this.text = result.text ?? errorMessage(this); this.serverDate = serverDate;
  }
}

/** A request over a ready live socket (`live-events.ts`), answered with the status and body its HTTP route would send. */
export type LiveChannel = { request(message: LiveRequest, signal: AbortSignal): Promise<LiveReply> };
/** The socket was not open (`sent` false: nothing went out) or closed before the reply (`sent` true: the result is unknown). */
export class LiveChannelLost extends Error {
  readonly sent: boolean;
  constructor(sent: boolean) { super('live channel lost'); this.sent = sent; }
}

/**
 * The current device's live socket as its requests see it. While a connection runs for the device (`attach`), every request it
 * carries waits for the socket to be ready and goes over it: a socket that is down delays requests, it never sends them elsewhere.
 */
export class LiveLink {
  private owner?: object;
  private channel?: LiveChannel;
  private readonly waiting = new Set<() => void>();
  /** Whether a connection runs for the current device. */
  get active() { return this.owner !== undefined; }
  /** A connection for the current device: it reports its ready channel; `detach` ends it unless a newer one replaced it. */
  attach() {
    const owner = {};
    this.owner = owner; this.channel = undefined; this.wake();
    return {
      ready: (channel: LiveChannel | undefined) => { if (this.owner === owner) { this.channel = channel; this.wake(); } },
      detach: () => { if (this.owner === owner) { this.owner = undefined; this.channel = undefined; this.wake(); } },
    };
  }
  private wake() { for (const resolve of this.waiting) resolve(); this.waiting.clear(); }
  /** `message` over the ready socket. A wait cut short by the signal's timeout rejects as not sent. */
  async request(message: LiveRequest, signal: AbortSignal): Promise<LiveReply> {
    for (;;) {
      if (signal.aborted) throw (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError' ? new LiveChannelLost(false) : signal.reason;
      if (!this.owner) throw new LiveChannelLost(false);
      const channel = this.channel;
      if (channel) {
        try { return await channel.request(message, signal); }
        catch (error) { if (!(error instanceof LiveChannelLost && !error.sent)) throw error; }
      }
      await new Promise<void>(resolve => {
        const done = () => { signal.removeEventListener('abort', done); this.waiting.delete(done); resolve(); };
        this.waiting.add(done); signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}

export async function responseError(response: Response): Promise<ApiError> {
  const result: unknown = await response.json().catch(() => undefined);
  const date = response.headers.get('Date'), parsedDate = date ? Date.parse(date) : NaN;
  const serverDate = Number.isFinite(parsedDate) ? parsedDate : undefined;
  const header = response.headers.get('Retry-After')?.trim();
  const delay = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * SECOND_MS : Math.max(0, Date.parse(header) - (serverDate ?? Date.now())) : undefined;
  let body: ClientError;
  try { body = decodeContract(errorBody, result); } catch { body = { error: 'INVALID_RESPONSE' }; }
  return new ApiError(response.status, { ...body, retryAfterMs: body.retryAfterMs ?? (Number.isFinite(delay) ? delay : undefined) }, serverDate);
}

/** This build's version, named on every request so the service can refuse one below its minimum; absent outside the extension. */
export const clientVersion = (globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: string } } } }).chrome?.runtime?.getManifest?.().version;

export class Api {
  readonly baseUrl: string;
  token?: string;
  /** The device's live socket: while it runs, every request it carries goes over it instead of a fetch and its CORS preflight. */
  readonly live = new LiveLink();
  /** Called when the service refuses this version (`CLIENT_OUTDATED`). */
  onOutdated?: () => void;
  private refused(error: unknown) { if (error instanceof ApiError && error.code === 'CLIENT_OUTDATED') this.onOutdated?.(); }
  private clockOffset = 0;
  /** A throttled route stays quiet until the service's wait passes. */
  private readonly cooldowns = new Map<string, number>();
  constructor(baseUrl: string) { this.baseUrl = baseUrl.replace(/\/$/, ''); }
  private cooling(route: string) {
    const until = this.cooldowns.get(route) ?? 0; const wait = until - Date.now();
    if (wait <= 0) { this.cooldowns.delete(route); return; }
    return new ApiError(429, { error: 'RATE_LIMITED', retryAfterMs: wait });
  }
  private throttled(route: string, error: unknown) {
    if (error instanceof ApiError && error.status === 429 && error.code !== 'ROOM_SLOW' && error.retryAfterMs) this.cooldowns.set(route, Math.max(this.cooldowns.get(route) ?? 0, Date.now() + error.retryAfterMs));
  }
  async request<I extends EndpointId>(id: I, { params, query, body, key, signal, secretKey, difficulty, onProofOfWorkSlow, token = this.token, timeoutMs = 20_000 }: ApiOptions<I> = {}): Promise<ApiResult<I>> {
    const endpoint = endpointsById[id];
    const path = pathFor(endpoint, (params ?? {}) as Infer<EndpointById<I>['params']>, query);
    const parsed = decodeContract(endpoint.body.schema, body);
    decodeContract(endpoint.headers, key ? { 'idempotency-key': key } : {});
    const bytes = endpoint.body.kind === 'json' ? new TextEncoder().encode(JSON.stringify(parsed)) : endpoint.body.kind === 'binary' ? parsed as Uint8Array : undefined;
    const cap = endpoint.body.caps && query && 'kind' in query ? endpoint.body.caps[String(query.kind)] : endpoint.body.maxBytes;
    if (bytes && bytes.byteLength > (cap ?? endpoint.body.maxBytes)) throw new ApiError(413, { error: 'BODY_TOO_LARGE' });
    const method = endpoint.method, route = `${method} ${path.split('?')[0]}`;
    const cooling = this.cooling(route); if (cooling) throw cooling;
    if (token !== undefined && token === this.token && !secretKey && carriedByLive(endpoint) && this.live.active) {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      let reply: LiveReply;
      // Params and query travel as the strings the URL would carry, so the service decodes them exactly as it does a route's.
      const search = new URLSearchParams(path.split('?')[1] ?? '');
      const message: LiveRequest = { type: 'request', endpoint: id,
        ...(params ? { params: Object.fromEntries(Object.entries(params).map(([name, value]) => [name, String(value)])) } : {}),
        ...(search.size ? { query: Object.fromEntries(search) } : {}), ...(parsed === undefined ? {} : { body: parsed }), ...(key ? { key } : {}) };
      try { reply = await this.live.request(message, requestSignal); }
      catch (error) {
        if (signal?.aborted && error === signal.reason) throw error;
        // Never sent: nothing happened. Sent but unanswered: like a fetch that failed after leaving.
        throw new ApiError(0, { error: error instanceof LiveChannelLost && !error.sent || method === 'GET' ? 'SERVICE_UNAVAILABLE' : 'RESULT_UNKNOWN' });
      }
      if (reply.status >= 200 && reply.status < 300) {
        try { return decodeContract(endpoint.response.schema, reply.body) as ApiResult<I>; }
        catch { throw new ApiError(502, { error: 'INVALID_RESPONSE' }); }
      }
      let failed: ClientError;
      try { failed = decodeContract(errorBody, reply.body); } catch { failed = { error: 'INVALID_RESPONSE' }; }
      const error = new ApiError(reply.status, failed);
      this.refused(error); this.throttled(route, error); throw error;
    }
    let retried = false;
    for (;;) {
      const headers: Record<string, string> = { ...(endpoint.body.kind === 'json' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(clientVersion ? { 'X-Palside-Version': clientVersion } : {}) };
      if (secretKey) {
        const timer = difficulty && onProofOfWorkSlow ? setTimeout(onProofOfWorkSlow, PROOF_OF_WORK_NOTICE_MS) : undefined;
        try { headers.Authorization = authorizationHeader(await createHttpAuth({ url: `${this.baseUrl}${path}`, method, body: bytes, secretKey, now: Math.floor((Date.now() + this.clockOffset) / SECOND_MS), difficulty, signal })); }
        finally { clearTimeout(timer); }
      }
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      requestSignal.throwIfAborted();
      let response: Response;
      try { response = await fetch(`${this.baseUrl}${path}`, { method, headers, ...(bytes ? { body: new Uint8Array(bytes) } : {}), signal: requestSignal, credentials: 'omit', cache: 'no-store' }); }
      catch { throw new ApiError(0, { error: method === 'GET' ? 'SERVICE_UNAVAILABLE' : 'RESULT_UNKNOWN' }); }
      try {
        if (!response.ok) throw await responseError(response);
        try {
          const value: unknown = endpoint.response.kind === 'binary' ? new Uint8Array(await response.arrayBuffer()) : await response.json();
          return decodeContract(endpoint.response.schema, value) as ApiResult<I>;
        } catch { throw new ApiError(502, { error: 'INVALID_RESPONSE' }); }
      } catch (error) {
        if (!retried && secretKey && error instanceof ApiError && error.code === 'AUTH_EXPIRED' && error.serverDate !== undefined) { this.clockOffset = error.serverDate - Date.now(); retried = true; continue; }
        this.refused(error); this.throttled(route, error); throw error;
      }
    }
  }
  async upload(data: Blob, kind: 'avatar' | 'encrypted' | 'report', teamId?: string, eventId?: string): Promise<string> {
    const token = this.token;
    const query = kind === 'avatar' ? { kind, teamId } : kind === 'report' ? { kind, eventId: eventId!, teamId } : { kind, teamId: teamId! };
    const body = new Uint8Array(await data.arrayBuffer());
    if (this.token !== token) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
    const result = await this.request('media.upload', { query, body, token, timeoutMs: 30_000 });
    if (this.token !== token) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
    return result.id;
  }
  async roomAvatar(key: string, account: string): Promise<Blob> {
    return new Blob([new Uint8Array(await this.request('rooms.avatar', { query: { key, accountId: account } }))]);
  }
  async inviteAvatar(id: string, token = this.token): Promise<Blob> {
    return new Blob([new Uint8Array(await this.request('invites.directAvatar', { params: { id }, token }))]);
  }
  async media(id: string, eventId?: string): Promise<ArrayBuffer> {
    return new Uint8Array(await this.request('media.read', { params: { id }, query: { eventId } })).buffer;
  }
}
