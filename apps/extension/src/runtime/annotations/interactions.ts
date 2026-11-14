import { message as uiMessage,MessageError } from '@palside/i18n';
import type { MatrixEvent } from 'matrix-js-sdk';
import { trustedDeviceMessages } from '../viewing/viewing-targets';
import { teamSendGuard } from '../account/crypto-identity';
import { isReactionEmoji,pruneReactions,readReaction,REACTION_DISPLAY,REACTION_MAX_COUNT } from '../../domain/annotations/reactions';
import type { RuntimeDevice } from '../account/device';
import { sharingWork, PING_ENCRYPTION_WAIT_MS } from '../viewing/sharing-work';
import type { PalsideService } from '../composition/core';
import { liveMembers } from '../../domain/teams/model.ts';
import { FOLLOW_EVENT,FOLLOW_SCROLL_MS,FOLLOW_WATCH_LIFE,nextFollowers,readFollowEvent } from '../../domain/annotations/follow.ts';

export class TeamInteractions {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  reactionTimer?: ReturnType<typeof setTimeout>;
  private followTimer?: ReturnType<typeof setTimeout>;
  private lastScroll = 0;
  private readonly followSeen = new Map<string, number>();
  /** Forget everything learned under the previous device session. */
  reset() {
    clearTimeout(this.reactionTimer); this.reactionTimer = undefined;
    clearTimeout(this.followTimer); this.followTimer = undefined;
    this.followSeen.clear(); this.lastScroll = 0;
    this.runtime.state.followers = []; this.runtime.state.leadScrolls = []; this.runtime.state.leadTabs = [];
  }
  /** 跟看: tell the followed teammate, and only them, that following runs or stopped. */
  async followWatch(teamId: string, leaderId: string, on: boolean) {
    const runtime = this.runtime, scope = runtime.auth.scope();
    const guard = teamSendGuard(runtime, teamId, true);
    const leader = liveMembers(guard.team).find(person => person.id === leaderId && person.id !== guard.session.account.id);
    if (!leader) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
    return await this.followSend(scope, guard, teamId, [leader.matrixId], { kind: 'watch', on });
  }
  /** 跟看: the page in front scrolled; only the people following this account hear it. */
  async leadScroll(teamId: string, url: string, y: number) {
    const runtime = this.runtime, scope = runtime.auth.scope(), now = Date.now();
    const guard = teamSendGuard(runtime, teamId, true), { session, team } = guard;
    if (now - this.lastScroll < FOLLOW_SCROLL_MS) return { delivered: 0 };
    const targets = this.followerDevices(team, session, now);
    if (!targets.length) return { delivered: 0 };
    this.lastScroll = now;
    return await this.followSend(scope, guard, teamId, targets, { kind: 'scroll', url, y });
  }
  /** 跟看: which tabs came to the front and which is there now; only the people following this account hear it. */
  async leadTabs(teamId: string, gen: string, open: string[], front: { tab: string; url: string } | undefined) {
    const scope = this.runtime.auth.scope(), guard = teamSendGuard(this.runtime, teamId, true);
    const targets = this.followerDevices(guard.team, guard.session, Date.now());
    if (!targets.length) return { delivered: 0 };
    return await this.followSend(scope, guard, teamId, targets, { kind: 'tabs', gen, open, ...(front ? { front } : {}) });
  }
  private followerDevices(team: ReturnType<typeof teamSendGuard>['team'], session: RuntimeDevice, now: number) {
    const followers = new Set((this.runtime.state.followers ?? []).filter(item => item.teamId === team.id && item.until > now).map(item => item.personId));
    return liveMembers(team).filter(person => followers.has(person.id) && person.id !== session.account.id).map(person => person.matrixId);
  }
  private async followSend(scope: ReturnType<PalsideService['auth']['scope']>, { session, client, check }: ReturnType<typeof teamSendGuard>, teamId: string, targets: string[], body: Record<string, unknown>) {
    const cryptoApi = client.getCrypto();
    if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const messages = await scope.wait(sharingWork(trustedDeviceMessages(cryptoApi, targets, session.matrix, FOLLOW_EVENT, { ...body, id: crypto.randomUUID(), teamId, sentAt: Date.now() }, check), PING_ENCRYPTION_WAIT_MS));
    check();
    if (!Object.keys(messages).length) return { delivered: 0 };
    const result = await scope.wait(this.runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check(); return result;
  }
  consumeFollow(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime, now = Date.now();
    if (runtime.auth.session !== session || !event.isEncrypted() || event.getType() !== FOLLOW_EVENT) return;
    const wire = readFollowEvent(event.getContent(), now);
    const team = wire && runtime.state.remoteTeams.find(t => t.id === wire.teamId && t.joined && t.memberIds.includes(session.account.id));
    const person = team?.people.find(p => !p.deleted && p.matrixId === event.getSender() && team.memberIds.includes(p.id) && p.id !== session.account.id);
    if (!wire || !person) return;
    for (const [key, until] of this.followSeen) if (until <= now) this.followSeen.delete(key);
    const key = `${wire.teamId}\0${person.id}\0${wire.id}`;
    if (this.followSeen.has(key) || this.followSeen.size >= 512) return;
    this.followSeen.set(key, now + 2 * FOLLOW_WATCH_LIFE);
    if (wire.kind === 'watch') runtime.state.followers = nextFollowers(runtime.state.followers ?? [], wire.teamId, person.id, wire.on, now);
    else if (wire.kind === 'tabs') {
      // Likewise counted only from someone this panel follows; the newest snapshot per teammate replaces the last.
      const rest = (runtime.state.leadTabs ?? []).filter(item => !(item.teamId === wire.teamId && item.personId === person.id));
      runtime.state.leadTabs = [...rest, { teamId: wire.teamId, personId: person.id, gen: wire.gen, open: wire.open, ...(wire.front ? { front: wire.front } : {}), at: now }].slice(-8);
    } else {
      // A scroll counts only from someone this panel follows; the background checks that before it moves a tab.
      const rest = (runtime.state.leadScrolls ?? []).filter(item => !(item.teamId === wire.teamId && item.personId === person.id));
      runtime.state.leadScrolls = [...rest, { teamId: wire.teamId, personId: person.id, url: wire.url, y: wire.y, at: now }].slice(-8);
    }
    this.scheduleFollowers(session);
    runtime.emit();
  }
  /** Followers whose heartbeat stopped leave on time, without another event. */
  private scheduleFollowers(session: RuntimeDevice) {
    clearTimeout(this.followTimer); this.followTimer = undefined;
    const runtime = this.runtime, next = Math.min(...(runtime.state.followers ?? []).map(item => item.until));
    if (!Number.isFinite(next)) return;
    this.followTimer = setTimeout(() => {
      if (runtime.auth.session !== session) return;
      const now = Date.now();
      runtime.state.followers = (runtime.state.followers ?? []).filter(item => item.until > now);
      this.scheduleFollowers(session); runtime.emit();
    }, Math.max(0, next - Date.now()) + 50);
  }
  async react(teamId: string, emoji: unknown, count: number) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const { session, client, users, check } = teamSendGuard(runtime, teamId, true);
    if (!isReactionEmoji(emoji) || !Number.isSafeInteger(count) || count < 1) throw new MessageError(uiMessage('common.error'));
    const cryptoApi = client.getCrypto(); if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const others = users.filter(userId => userId !== session.matrix.userId);
    const messages = await scope.wait(sharingWork(trustedDeviceMessages(cryptoApi, others, session.matrix, 'com.palside.reaction', { id: crypto.randomUUID(), teamId, emoji, count: Math.min(count, REACTION_MAX_COUNT), sentAt: Date.now() }, check), PING_ENCRYPTION_WAIT_MS));
    check();
    if (!Object.keys(messages).length) return { delivered: 0 };
    const result = await scope.wait(runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check(); return result;
  }
  consumeReaction(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime;
    if (runtime.auth.session !== session || !event.isEncrypted()) return;
    const reaction = readReaction(event.getContent());
    const team = reaction && runtime.state.remoteTeams.find(t => t.id === reaction.teamId && t.joined);
    const person = team?.people.find(p => p.matrixId === event.getSender() && team.memberIds.includes(p.id) && p.id !== session.account.id);
    if (!reaction || !person) return;
    const known = runtime.state.reactions ?? [];
    if (known.some(item => item.id === reaction.id)) return;
    runtime.state.reactions = pruneReactions([...known, { ...reaction, personId: person.id, at: Date.now() }]);
    clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => { if (runtime.auth.session !== session) return; runtime.state.reactions = pruneReactions(runtime.state.reactions ?? []); runtime.emit(); }, REACTION_DISPLAY + 50);
    runtime.emit();
  }
}
