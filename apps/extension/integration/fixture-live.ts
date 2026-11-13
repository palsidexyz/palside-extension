import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emptyState } from '../src/runtime/composition/state';
import { emptyDraft, recallMessage, type Draft, type Message } from '../src/domain/chat/model';
import type { Dataset } from '../src/runtime/composition/dataset';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import type { RevisionedDraft } from '../src/runtime/storage/storage';
import type { LivePort } from '../src/features/palside/app/live-port';

/** A signed-in, connected runtime state around fixture data. Review pages use it instead of a real offscreen runtime. */
export function fixtureState(data: Dataset, patch: Partial<RuntimeState> = {}): RuntimeState {
  const self = data.people.find(person => person.id === data.self);
  return {
    ...emptyState(), ready: true, authenticated: true,
    connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
    account: { wallet: null, bio: '', tags: [], id: data.self, nickname: self?.name || 'You', avatarId: null, matrixId: `@${data.self}:fixture.test`, revision: 0, acceptTeamInvites: true },
    data, viewingId: self?.viewing,
    preferences: { ...emptyState().preferences, current: data.teams.find(team => team.joined)?.id ?? data.teams[0]?.id ?? '', notifications: 'off', toured: true },
    ...patch,
  };
}

type FixtureOptions = {
  /** How long a send takes before it is confirmed. */
  delay?: number;
  /** Read at send time: a failing send stays on screen with 重试. */
  fail?: () => boolean;
};

/**
 * The commands a fixture panel needs to feel real: drafts, sending (with its delay and failure), cancelling, retrying, recall,
 * preferences and reconnect. Every other command resolves with nothing, as if the service accepted it.
 */
export function useFixtureLive(initial: Dataset | (() => RuntimeState), options: FixtureOptions = {}): LivePort {
  const [state, setState] = useState<RuntimeState>(() => typeof initial === 'function' ? initial() : fixtureState(initial));
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const command = useMemo(() => {
    const update = (change: (old: RuntimeState) => RuntimeState) => setState(old => ({ ...change(old), revision: old.revision + 1 }));
    const messages = (change: (list: Message[]) => Message[]) => update(old => ({ ...old, data: { ...old.data, messages: change(old.data.messages) } }));
    return (async (name: string, payload: Record<string, unknown> = {}) => {
    switch (name) {
      case 'draft': {
        const teamId = String(payload.teamId);
        let next: RevisionedDraft<Draft> | undefined;
        update(old => {
          const saved = old.drafts[teamId];
          next = { value: { ...(saved?.value ?? emptyDraft), ...(payload.patch as Partial<Draft>) }, revision: (saved?.revision ?? 0) + 1, updatedAt: Date.now() };
          return { ...old, drafts: { ...old.drafts, [teamId]: next } };
        });
        return next;
      }
      case 'send': {
        const message = payload.message as Message;
        messages(list => [...list.filter(item => item.id !== message.id), { ...message, status: 'sending', timestamp: message.timestamp ?? Date.now() }]);
        await new Promise(resolve => setTimeout(resolve, latest.current.delay ?? 600));
        if (latest.current.fail?.()) { messages(list => list.map(item => item.id === message.id ? { ...item, status: 'failed' } : item)); return {}; }
        const eventId = `$fixture-${message.id}`;
        messages(list => list.map(item => item.id === message.id ? { ...item, id: eventId, status: 'sent' } : item));
        return { eventId };
      }
      case 'cancel-send': messages(list => list.filter(item => item.id !== payload.id || item.status === 'sent')); return undefined;
      case 'prepare-retry': {
        let message: Message | undefined;
        setState(old => { message = old.data.messages.find(item => item.id === payload.id); return old; });
        return message ? { message: { ...message, status: 'waiting' } } : undefined;
      }
      case 'recall': messages(list => recallMessage(list, String(payload.id))); return { done: true };
      case 'preferences': { const { accountId: _accountId, ...rest } = payload; update(old => ({ ...old, preferences: { ...old.preferences, ...rest } })); return undefined; }
      case 'reconnect': update(old => ({ ...old, connection: { ...old.connection, networkOnline: true, service: 'ready', messaging: 'ready' } })); return undefined;
      default: return undefined;
    }
  }) as LivePort['command'];
  }, []);
  return useMemo(() => ({ state, command, openPage: async (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); } }), [state, command]);
}
