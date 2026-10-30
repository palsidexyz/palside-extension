import { deviceStates,type PresenceState } from '@palside/shared/contracts/common';
import type { DeviceState } from '@palside/shared/contracts/presence';
import { offlineDirectory } from './offline-directory';
import { ApiError } from '../transport/api';
import type { Person } from '../../domain/account/model';
import { DAY,color } from '../composition/state';
import { pruneTeamItems } from '../annotations/team-items';
import { uniqueMediaIds } from '../teams/teams';
import { completeTeamStart } from '../teams/onboarding';
import type { SessionRuntime } from './session-lifecycle';

export async function fetchSnapshot(this: SessionRuntime) {
    const runtime = this.runtime;
    const scope = this.scope();
    const requestRuntimeDevice = this.session; const presenceVersion = this.presenceVersion;
    const presence = new Map<string, PresenceState>(); this.snapshotPresence = presence;
    try {
      const snapshot = await scope.wait(runtime.api.request('accounts.snapshot'));
      if (!requestRuntimeDevice || this.session !== requestRuntimeDevice || snapshot.account.id !== requestRuntimeDevice.account.id) return;
      if (JSON.stringify(requestRuntimeDevice.account) !== JSON.stringify(snapshot.account)) {
        requestRuntimeDevice.account = snapshot.account;
        if (requestRuntimeDevice !== this.pendingDevice && requestRuntimeDevice.crypto === 'ready') await scope.wait(runtime.storage.put('device', snapshot.account.id, 'device', requestRuntimeDevice));
        if (this.session !== requestRuntimeDevice) return;
      }
      if (!snapshot.teams.some(team => team.id === runtime.state.preferences.current)) {
        runtime.state.preferences.current = snapshot.teams.find(team => team.joined)?.id ?? snapshot.teams[0]?.id ?? '';
        await scope.wait(runtime.sharing.savePreferences());
        if (this.session !== requestRuntimeDevice) return;
      }
      const avatarIds = uniqueMediaIds(snapshot.account.avatarId, snapshot.teams);
      const avatars = new Map<string, string | undefined>(await scope.wait(Promise.all(
        [...avatarIds].map(async id => [id, await scope.wait(runtime.cache.avatar(id))] as const),
      )));
      const ownAvatar = snapshot.account.avatarId ? avatars.get(snapshot.account.avatarId) : undefined;
      if (this.session !== requestRuntimeDevice) return;
      const people = new Map<string, Person>([[snapshot.account.id, { id: snapshot.account.id, name: snapshot.account.nickname || '', bio: snapshot.account.bio, tags: snapshot.account.tags, color: color(snapshot.account.id), avatar: ownAvatar }]]);
      for (const team of snapshot.teams) {
        for (const p of team.people) {
          const avatar = p.avatarId ? avatars.get(p.avatarId) : undefined;
          people.set(p.id, { id: p.id, name: p.nickname || '', bio: p.bio, tags: p.tags, deleted: p.deleted, color: color(p.id), avatar });
        }
        for (const p of team.requests) if (!people.has(p.accountId)) people.set(p.accountId, { id: p.accountId, name: p.nickname || '', deleted: p.deleted, color: color(p.accountId), avatar: undefined });
      }
      const old = new Map(runtime.state.data.people.map(p => [p.id, p]));
      const teams = snapshot.teams.map(t => ({
        ...runtime.state.data.teams.find(old => old.id === t.id),
        id: t.id,
        name: t.name,
        description: t.description,
        retentionDays: t.retentionDays,
        activity: t.activity,
        activitySummary: t.activitySummary,
        owner: t.ownerId,
        memberCount: t.memberCount ?? undefined,
        memberIds: t.memberIds,
        joined: t.joined,
        readonly: !t.joined,
        readonlyReason: t.reason ?? undefined,
        muted: Boolean(t.preferences.muted),
        unread: runtime.state.data.teams.find(old => old.id === t.id)?.unread ?? 0,
        published: (t.recruitmentExpiresAt ?? 0) > Date.now(),
        publishedAt: t.publishedAt ?? undefined,
        recruitmentExpiresAt: t.recruitmentExpiresAt ?? undefined,
        avatar: t.avatarId ? avatars.get(t.avatarId) : undefined,
      }));
      if (this.session !== requestRuntimeDevice) return;
      const levelKey = `${snapshot.account.id}:team-level-events`;
      const levelState = await scope.wait(runtime.storage.get<{ levels: Record<string, number>; events: NonNullable<typeof runtime.state.teamLevelEvents> }>(levelKey)) ?? { levels: {}, events: [] };
      const now = Date.now();
      levelState.events = levelState.events.filter(event => snapshot.teams.some(team => team.id === event.teamId && team.joined && event.timestamp > now - team.retentionDays * DAY));
      for (const team of snapshot.teams) if (team.joined && team.activity) {
        const previous = levelState.levels[team.id], next = team.activity.level;
        if (previous !== undefined && next > previous) levelState.events.push({ id: crypto.randomUUID(), teamId: team.id, from: previous, to: next, timestamp: now });
        levelState.levels[team.id] = next;
      }
      await scope.wait(runtime.storage.put(levelKey, snapshot.account.id, 'team-level-events', levelState));
      runtime.state.teamLevelEvents = levelState.events;
      this.snapshotAt = Date.now();
      runtime.state.account = snapshot.account; runtime.state.rooms.acceptInvites = snapshot.account.acceptTeamInvites ?? true; runtime.state.remoteTeams = snapshot.teams;
      for (const [account, state] of presence) snapshot.presence[account] = state;
      runtime.state.data.people = [...people.values()].map(p => ({ ...p, walletAddress: old.get(p.id)?.walletAddress, walletVerified: old.get(p.id)?.walletVerified, viewing: old.get(p.id)?.viewing, presence: this.sseOpen && presenceVersion === this.presenceVersion ? (deviceStates.some(state => state === snapshot.presence[p.id]) ? snapshot.presence[p.id] as DeviceState : undefined) : old.get(p.id)?.presence }));
      runtime.state.data.self = snapshot.account.id; runtime.state.data.teams = teams;
      runtime.state.items = pruneTeamItems(runtime.state.items, Date.now(), teamId => snapshot.teams.some(t => t.id === teamId && t.joined));
      runtime.state.data.requests = snapshot.teams.flatMap(t => t.requests.map(r => ({ id: `${t.id}:${r.accountId}`, personId: r.accountId, teamId: t.id, text: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt })));
      for (const team of snapshot.teams) if (team.joined && ((team.memberCount ?? team.memberIds.length) > 1 || runtime.state.preferences.startedTeams?.includes(team.id))) await scope.wait(completeTeamStart(runtime, team.id));
      await scope.wait(runtime.cache.expireLocalContent());
      if (this.session !== requestRuntimeDevice) return;
      const previousMessages = runtime.state.data.messages;
      runtime.state.data.messages = previousMessages.filter(m => {
        const time = runtime.cache.eventTimes.get(m.id); const team = snapshot.teams.find(t => t.id === m.teamId);
        return Boolean(team && (time === undefined ? runtime.sending.outgoing.has(m.id) : runtime.cache.expiresAt(m, time) > Date.now() && team.periods.some(p => time >= p.joinedAt && (!p.leftAt || time <= p.leftAt))));
      });
      const retainedMessageIds = new Set(runtime.state.data.messages.map(message => message.id));
      for (const message of previousMessages) if (!retainedMessageIds.has(message.id)) { runtime.cache.eventTimes.delete(message.id); runtime.timeline.edits.delete(message.id); }
      for (const [id, edit] of runtime.timeline.edits) if (!snapshot.teams.some(t => t.id === edit.teamId)) runtime.timeline.edits.delete(id);
      const inaccessibleKeys = previousMessages.filter(message => message.id.startsWith('$') && !retainedMessageIds.has(message.id)).flatMap(message => [`${snapshot.account.id}:cache:${message.id}`, `${snapshot.account.id}:cache:media:event:${message.id}`]);
      await scope.wait(Promise.all(inaccessibleKeys.map(key => runtime.storage.remove(key))));
      if (this.session !== requestRuntimeDevice) return;
      runtime.cache.evictCachedContent(inaccessibleKeys);
      const visibleViews = new Set<string>();
      for (const message of runtime.state.data.messages) { if (message.attachment?.kind === 'asset') visibleViews.add(message.attachment.assetId); if (!message.recalled && message.ref) visibleViews.add(message.ref.view.id); }
      for (const draft of Object.values(runtime.state.drafts)) { if (draft.value.attachment?.kind === 'asset') visibleViews.add(draft.value.attachment.assetId); if (draft.value.ref) visibleViews.add(draft.value.ref.view.id); }
      if (runtime.sharing.page) visibleViews.add(runtime.sharing.page.id); for (const entry of runtime.sharing.peerViewing.values()) visibleViews.add(entry.view.id);
      for (const [id, deadline] of runtime.cache.preparedViews) { if (deadline > Date.now()) visibleViews.add(id); else runtime.cache.preparedViews.delete(id); }
      runtime.state.data.views = runtime.state.data.views.filter(view => visibleViews.has(view.id)); runtime.cache.pruneMedia();
      const expiresAt = Date.now() + 30 * DAY;
      const evicted = await scope.wait(runtime.storage.cache(snapshot.account.id, 'directory', offlineDirectory(runtime.state.data, expiresAt), expiresAt));
      if (this.session !== requestRuntimeDevice) return;
      runtime.cache.evictCachedContent(evicted);
      this.directoryExpiresAt = 0;
      runtime.state.connection.service = 'ready'; runtime.state.connection.networkOnline = true; runtime.emit();
    } catch (error) { scope.check();
      if (this.session !== requestRuntimeDevice) return;
      if (error instanceof ApiError && error.status === 401 && requestRuntimeDevice !== this.pendingDevice) await scope.wait(this.expireRuntimeDevice());
      else runtime.state.connection.service = 'unavailable';
      runtime.emit(); throw error;
    } finally { if (this.snapshotPresence === presence) this.snapshotPresence = undefined; }
  }
