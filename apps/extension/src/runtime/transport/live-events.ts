import { SECOND_MS } from '@palside/shared/units';
import { retryDelayMs } from '@palside/shared/backoff';
import { decodeContract } from '@palside/shared/contracts/validation';
import { event as eventSchema, type EventPayload } from '@palside/shared/contracts/events';
import type { PresenceState } from '@palside/shared/contracts/common';
import { LIVE_DRAINING, LIVE_GOING_AWAY, LIVE_OUTDATED, LIVE_PATH, LIVE_PROBE_MS, LIVE_SILENT_MS, LIVE_UNAUTHORIZED, type LiveReply, type LiveServerMessage } from '@palside/shared/contracts/live';
import type { ChainClientConfig, ChainEvent } from '@palside/shared/contracts/chain';
import { LiveChannelLost, type LiveChannel } from './api.ts';
import type { RoomEvent } from '../rooms/contract-types';

type LiveEventsOptions = {
  baseUrl: string;
  token: () => string | undefined;
  onRefresh: (refresh: EventPayload<'refresh'>) => void;
  onPresence?: (account: string, state: PresenceState) => void;
  onTeamInvites?: (pending: number) => void;
  onRoom?: (event: RoomEvent) => void;
  onChainConfig?: (config: ChainClientConfig) => void;
  onChain?: (event: ChainEvent) => void;
  onBanned?: (ban: { expiresAt: number | null }) => void;
  onTokens?: (entries: EventPayload<'tokens'>['tokens']) => void;
  onState?: (open: boolean) => void;
  onUnauthorized?: () => void;
  /** This extension version is below the service minimum; the socket stays closed. */
  onOutdated?: () => void;
  /** The version `auth` names (`clientVersion`). */
  version?: string;
  /** The ready socket for requests, or undefined while there is none. */
  onChannel?: (channel: LiveChannel | undefined) => void;
  /** The WebSocket constructor. Defaults to the global one. */
  WebSocket?: typeof WebSocket;
  /** Calls back when the network comes back; returns its removal. Defaults to the global `online` event. */
  onOnline?: (listener: () => void) => () => void;
};

/** Reconnects after a lost socket wait 1 s, doubling up to 10 s; the network coming back, or a service restart, retries sooner. */
const RECONNECT = { baseMs: SECOND_MS, maxMs: 10 * SECOND_MS };
const globalOnline = (listener: () => void) => {
  const target = globalThis as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
  target.addEventListener?.('online', listener);
  return () => target.removeEventListener?.('online', listener);
};

/** One push to its callback. A push that does not decode is dropped, like an unknown one. */
function dispatch(options: LiveEventsOptions, message: { event: unknown; data: unknown }) {
  let decoded;
  try { decoded = decodeContract(eventSchema, { event: message.event, data: message.data }); } catch { return; }
  if (decoded.event === 'refresh') options.onRefresh(decoded.data);
  if (decoded.event === 'room') options.onRoom?.(decoded.data);
  if (decoded.event === 'account-banned') options.onBanned?.(decoded.data);
  if (decoded.event === 'team-invites') options.onTeamInvites?.(decoded.data.pending);
  if (decoded.event === 'presence') options.onPresence?.(decoded.data.account, decoded.data.state);
  if (decoded.event === 'tokens') options.onTokens?.(decoded.data.tokens);
  if (decoded.event === 'chain-config') options.onChainConfig?.(decoded.data.config);
  if (decoded.event === 'chain') options.onChain?.(decoded.data);
}

/**
 * The account's live socket (`@palside/shared/contracts/live`): its pushes, and the channel every request of this device rides.
 * A lost socket reconnects with backoff; a refused device token or version stops for good.
 *
 * A request that runs out of time does not condemn the socket: the client sends `ping`, and only a socket that stays silent for
 * `LIVE_PROBE_MS` is dropped. The network coming back probes an open socket and reconnects a closed one at once. When the service
 * drains, requests wait for the next socket instead of going out on this one.
 */
export function connectLiveEvents(options: LiveEventsOptions): () => void {
  let stopped = false;
  let close: (() => void) | undefined;
  let probe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const again = (code?: number) => {
    close = undefined; probe = undefined;
    if (stopped) return;
    // A service that said it was going away is restarting: try again soon, without growing the wait.
    if (code !== LIVE_GOING_AWAY) failures++;
    retryTimer = setTimeout(connect, retryDelayMs(Math.max(failures, 1), RECONNECT));
  };
  const online = () => {
    if (stopped) return;
    if (probe) { probe(); return; }
    if (close) return;
    clearTimeout(retryTimer); failures = 0; connect();
  };
  const removeOnline = (options.onOnline ?? globalOnline)(online);
  function connect() {
    retryTimer = undefined;
    if (stopped) return;
    const accessToken = options.token();
    if (!accessToken) { options.onState?.(false); retryTimer = setTimeout(connect, 5 * SECOND_MS); return; }
    let ready = false, ended = false, draining = false;
    let silence: ReturnType<typeof setTimeout> | undefined, probing: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, { resolve: (reply: LiveReply) => void; reject: (error: unknown) => void }>();
    const ws = new Socket(`${options.baseUrl.replace(/^http/, 'ws')}${LIVE_PATH}`);
    // A socket gone quiet is lost at once: closing a dead socket waits for a handshake that never comes.
    const lose = () => { end(); ws.close(); };
    const heard = () => { clearTimeout(silence); clearTimeout(probing); probing = undefined; silence = setTimeout(lose, LIVE_SILENT_MS); };
    const check = () => {
      if (!ready || ended || probing) return;
      probing = setTimeout(lose, LIVE_PROBE_MS);
      ws.send(JSON.stringify({ type: 'ping' }));
    };
    const channel: LiveChannel = {
      request: (message, signal) => new Promise((resolve, reject) => {
        if (!ready || ended || draining || ws.readyState !== Socket.OPEN) { reject(new LiveChannelLost(false)); return; }
        if (signal.aborted) { reject(signal.reason); return; }
        const id = crypto.randomUUID();
        pending.set(id, { resolve, reject });
        signal.addEventListener('abort', () => {
          if (!pending.delete(id)) return;
          reject(signal.reason);
          if ((signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError') check();
        }, { once: true });
        ws.send(JSON.stringify({ ...message, id }));
      }),
    };
    ws.onopen = () => { heard(); ws.send(JSON.stringify({ type: 'auth', token: accessToken, ...(options.version ? { version: options.version } : {}) })); };
    ws.onmessage = event => {
      if (typeof event.data !== 'string' || stopped || ended) return;
      heard();
      let message: LiveServerMessage;
      try { message = JSON.parse(event.data) as LiveServerMessage; } catch { return; }
      if (message.type === 'ready' && !ready) { ready = true; failures = 0; probe = check; options.onState?.(true); options.onChannel?.(channel); }
      else if (message.type === 'reply') {
        const waiting = pending.get(message.id); pending.delete(message.id);
        const body = message.body as { error?: unknown } | undefined;
        // It crossed `draining` and never ran: the request goes out again on the next socket.
        if (message.status === LIVE_DRAINING.status && body?.error === LIVE_DRAINING.error) waiting?.reject(new LiveChannelLost(false));
        else waiting?.resolve({ status: message.status, body: message.body });
      }
      else if (message.type === 'event') dispatch(options, message);
      else if (message.type === 'draining' && !draining) { draining = true; if (ready) options.onChannel?.(undefined); }
    };
    function end(code?: number) {
      if (ended) return;
      ended = true; clearTimeout(silence); clearTimeout(probing);
      for (const waiting of pending.values()) waiting.reject(new LiveChannelLost(true));
      pending.clear();
      if (ready && !draining) options.onChannel?.(undefined);
      if (stopped) return;
      options.onState?.(false);
      if (code === LIVE_UNAUTHORIZED) { stopped = true; options.onUnauthorized?.(); return; }
      if (code === LIVE_OUTDATED) { stopped = true; options.onOutdated?.(); return; }
      again(code);
    }
    ws.onclose = event => end(event.code);
    close = () => { end(); ws.close(1000); };
  }

  connect();
  return () => {
    stopped = true;
    removeOnline();
    if (retryTimer) clearTimeout(retryTimer);
    close?.();
  };
}
