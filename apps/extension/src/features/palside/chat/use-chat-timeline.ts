'use client';
import { useLayoutEffect,useMemo,useSyncExternalStore,type RefObject } from 'react';
import type { LivePort } from '../app/live-port';
import type { Message } from '../../../domain/chat/model';
import { ChatTimeline } from './chat-timeline';

export function useChatTimeline({ self, teamId, messages, active, command, jumpId, listRef, contentRef }: { self: string; teamId: string; messages: Message[]; active: boolean; command?: LivePort['command']; jumpId?: string; listRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null> }) {
  const timeline = useMemo(() => new ChatTimeline(`palside:reading:${self}:${teamId}`, self), [self, teamId]);
  const panelId = useMemo(() => crypto.randomUUID(), []);
  const state = useSyncExternalStore(timeline.subscribe, timeline.getSnapshot, timeline.getServerSnapshot);
  useLayoutEffect(() => { if (listRef.current && contentRef.current) return timeline.connect(listRef.current, contentRef.current); }, [timeline, listRef, contentRef]);
  useLayoutEffect(() => { timeline.setReporter(command ? ids => command('visible', { teamId, sourceId: panelId, ids }) : undefined); return () => timeline.setReporter(undefined); }, [timeline, command, teamId, panelId]);
  useLayoutEffect(() => { timeline.update(messages, active, jumpId); }, [timeline, messages, active, jumpId]);
  return { ...state, latest: timeline.latest, jump: timeline.jump, returnTo: timeline.returnTo, sendIntent: timeline.sendIntent };
}
