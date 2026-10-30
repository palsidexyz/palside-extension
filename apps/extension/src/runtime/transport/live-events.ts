import { decodeContract } from '@palside/shared/contracts/validation';
import type { EventPayload } from '@palside/shared/contracts/events';
import type { PresenceState } from '@palside/shared/contracts/common';
import { endpointsById,pathFor } from '@palside/shared/contracts/endpoints';
import { ApiError,responseError } from './api.ts';
import type { RoomEvent } from '../rooms/contract-types';
import { chainConfigEvent, chainEvent, type ChainClientConfig, type ChainEvent } from '@palside/shared/contracts/chain';

type LiveEventsOptions = {
  baseUrl: string;
  token: () => string | undefined;
  onRefresh: (scope: EventPayload<'refresh'>['scope']) => void;
  onPresence?: (account: string, state: PresenceState) => void;
  onTeamInvites?: (pending: number) => void;
  onRoom?: (event: RoomEvent) => void;
  onChainConfig?: (config: ChainClientConfig) => void;
  onChain?: (event: ChainEvent) => void;
  onBanned?: (ban: { expiresAt: number | null }) => void;
  onState?: (open: boolean) => void;
};

type SseEvent = { event: string; data: string };

export function parseSseEvents(buffer: string): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const index = line.indexOf(':');
      const field = index < 0 ? line : line.slice(0, index);
      const value = index < 0 ? '' : line.slice(index + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, remainder };
}

export function connectLiveEvents(options: LiveEventsOptions): () => void {
  let stopped = false;
  let controller: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  const heartbeatMs = 60_000;
  const retry = (wait: number) => {
    const chunk = Math.min(wait, 2_147_483_647);
    retryTimer = setTimeout(() => { if (!stopped) { if (wait > chunk) retry(wait - chunk); else void connect(); } }, chunk);
  };
  const connect = async () => {
    if (stopped) return;
    const accessToken = options.token();
    if (!accessToken) {
      options.onState?.(false);
      retryTimer = setTimeout(connect, 5000);
      return;
    }
    const connection = new AbortController(); controller = connection;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let serverDelay = 0;
    const alive = async <T>(work: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
          timer = setTimeout(() => { connection.abort(); reject(new Error('events heartbeat expired')); }, heartbeatMs);
        })]);
      } finally { clearTimeout(timer); }
    };
    try {
      const response = await alive(fetch(`${options.baseUrl}${pathFor(endpointsById['presence.events'], {})}`, {
        method: endpointsById['presence.events'].method,
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: connection.signal,
      }));
      if (stopped) return;
      if (!response.ok) throw await alive(responseError(response));
      if (!response.body) throw new Error(`events ${response.status}`);
      delay = 1000;
      options.onState?.(true);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const result = await alive(reader.read());
        if (stopped || result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;
        for (const event of parsed.events) {
          try {
            const data: unknown = JSON.parse(event.data);
            if (event.event === 'chain-config') { options.onChainConfig?.(decodeContract(chainConfigEvent, data).config); continue; }
            if (event.event === 'chain') { options.onChain?.(decodeContract(chainEvent, data)); continue; }
            const decoded = decodeContract(endpointsById['presence.events'].response.schema, { event: event.event, data });
            if (decoded.event === 'refresh') options.onRefresh(decoded.data.scope);
            if (decoded.event === 'room') options.onRoom?.(decoded.data);
            if (decoded.event === 'account-banned') options.onBanned?.(decoded.data);
            if (decoded.event === 'team-invites') options.onTeamInvites?.(decoded.data.pending);
            if (decoded.event === 'presence') options.onPresence?.(decoded.data.account, decoded.data.state);
          } catch {}
        }
      }
      if (!stopped) options.onState?.(false);
    } catch (error) {
      if (error instanceof ApiError) { serverDelay = error.retryAfterMs ?? 0; if (error.status === 401) delay = 30_000; }
      if (!stopped) options.onState?.(false);
    } finally {
      connection.abort();
      void reader?.cancel().catch(() => {});
      controller = undefined;
      if (!stopped) {
        retry(Math.max(delay, serverDelay) + Math.floor(Math.random() * Math.min(delay, 1000)));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  };
  void connect();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
  };
}
