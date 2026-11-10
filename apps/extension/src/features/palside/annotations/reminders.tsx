'use client';
import { useTranslations } from 'use-intl';
import { errorMessage } from '@palside/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { type Viewing } from '../../../domain/assets/model';
import { captureSocialUi, setSocialUi, useSocialUi } from './social-state';
import { FOLLOW_WATCH_MS } from '../../../domain/annotations/follow';
import { SessionCard } from '../feedback/session-notice';
import type { PalsideController } from '../app/use-palside';

export type TopCard = {
  /** Changes when the card means something else, so the slot fades the new one in. */
  key: string;
  card: ReactNode;
};

/** 跟看 ends when the team changes or the teammate leaves. */
function useSocialLifecycle(c: PalsideController) {
  const { follow } = useSocialUi();
  const teamId = c.current; const memberIds = c.team.memberIds;
  useEffect(() => { if (follow && (follow.teamId !== teamId || !memberIds.includes(follow.personId))) setSocialUi({ follow: undefined }); }, [follow, teamId, memberIds]);
  useFollowTab(c);
}

/** 跟看's tabs follow the teammate: the background moves them, and tells the panel when you took one over (paused) or closed
 *  the last (ended). Starting opens a tab in front once; later moves never take focus from your own tabs. */
function useFollowTab(c: PalsideController) {
  const { follow } = useSocialUi();
  const followed = follow && follow.teamId === c.current ? follow.personId : undefined;
  const viewingId = followed ? c.people.find(person => person.id === followed)?.viewing : undefined;
  const url = viewingId ? c.data.views.find(view => view.id === viewingId)?.url : undefined;
  const request = c.live?.follow, listen = c.live?.onFollowStatus, setNotice = c.setNotice, current = c.current;
  const t = useTranslations();
  const followedName = followed ? c.people.find(person => person.id === followed)?.name : undefined;
  const groupTitle = followedName ? t('extension.top.followGroup', { name: followedName }) : undefined;
  const started = useRef<string | undefined>(undefined);
  const paused = Boolean(follow?.paused), startedAt = follow?.startedAt ?? 0;
  useEffect(() => {
    if (!request) return;
    if (!followed) { if (started.current) { started.current = undefined; void request({ op: 'stop' }).catch(() => {}); } return; }
    if (!url || paused) return;
    const start = started.current !== followed && Date.now() - startedAt < 3_000;
    started.current = followed;
    void request({ op: 'go', url, start, teamId: current, personId: followed, ...(groupTitle ? { title: groupTitle } : {}) }).catch(error => setNotice(errorMessage(error)));
  }, [request, followed, url, paused, startedAt, setNotice, current, groupTitle]);
  // The teammate hears that you follow while it runs: now, then every minute; pausing or ending says so once.
  const command = c.live?.command, teamId = c.current;
  useEffect(() => {
    if (!command || !followed) return;
    const watch = (on: boolean) => { void command('follow-watch', { teamId, leader: followed, on }).catch(() => {}); };
    if (paused) return;
    watch(true);
    const timer = setInterval(() => watch(true), FOLLOW_WATCH_MS);
    return () => { clearInterval(timer); watch(false); };
  }, [command, followed, paused, teamId]);
  useEffect(() => listen?.(status => setSocialUi(old => !old.follow ? {} : status.ended ? { follow: undefined }
    : { follow: { ...old.follow, paused: status.paused } })), [listen]);
}

/** What the top slot shows instead of the 在看 chips: only a connection or read-only state. Nothing returns undefined and the chips
 *  stay; 跟看 marks the followed chip and has its own bar above the panel, and 喊你来看 and signals are hints in the chat. */
export function useTopCard(c: PalsideController): TopCard | undefined {
  useSocialLifecycle(c);
  if (c.disconnected || c.team.readonly) return { key: c.team.readonly ? 'readonly' : `connection-${c.connection}`, card: <SessionCard c={c} /> };
}

export function openPage(c: PalsideController, view: Viewing, then?: () => void) {
  const session = captureSocialUi();
  if (c.live) void c.live.openPage(view.url).then(() => { if (session.current()) then?.(); }, error => { if (session.current()) c.setNotice(errorMessage(error)); });
}
