import { errorMessage,message as uiMessage,MessageError } from '@palside/i18n';
import { ApiError } from '../transport/api';
import { parseInvitation } from '@palside/shared/navigation';
import type { Command } from '../transport/command-map';
import type { ApiResult } from '../transport/api';
import type { TeamDiscoverySort } from '@palside/shared/team-activity';
import { APPLICATION_COOLDOWN_MS } from '@palside/shared/rules/teams';
import { text } from '../composition/state';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function dismissInviteCommand(this: RuntimeCommands, command: Extract<Command, { name: "dismiss-invite" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
 if (runtime.state.data.pendingInvite === p.url) this.inviteRequest++; await this.dismissInvite(text(p.url)); return;
}

export async function externalTeamCommand(this: RuntimeCommands, command: Extract<Command, { name: "external-team" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
 const id = text(p.id); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new MessageError(uiMessage('extension.runtime.invalidInvite')); runtime.state.data.openTeam = id; runtime.emit(); return;
}

export async function dismissOpenTeamCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
 runtime.state.data.openTeam = undefined; runtime.emit(); return;
}

export async function externalInviteCommand(this: RuntimeCommands, command: Extract<Command, { name: "external-invite" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      const code = text(p.code); if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw new MessageError(uiMessage('extension.runtime.invalidInvite'));
      const request = ++this.inviteRequest;
      if (runtime.state.data.pendingInvite) await this.dismissInvite(runtime.state.data.pendingInvite);
      if (request !== this.inviteRequest) return;
      const invite = await runtime.api.request('invites.preview', { params: { id: code } }); const url = new URL(`/invite/${code}`, runtime.state.config.websiteUrl).href;
      if (request !== this.inviteRequest) return;
      await runtime.storage.put('pending-invite', '_device', 'invite', url, invite.expiresAt);
      if (request !== this.inviteRequest) { await runtime.storage.removeIfValue('pending-invite', url); return; }
      this.inviteExpiresAt = invite.expiresAt; runtime.state.data.pendingInvite = url; runtime.emit(); return;
}

export async function createCommand(this: RuntimeCommands, command: Extract<Command, { name: "create" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const result = await scope.wait(this.mutate('teams.create', { body: { name: p.name, description: p.description } })); await scope.wait(runtime.refresh()); runtime.state.preferences.current = result.teamId; await scope.wait(runtime.sharing.savePreferences()); return result;
}

export async function invitePreviewCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-preview" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();

      const invite = parseInvitation(text(p.url), runtime.state.config.websiteUrl); if (!invite) throw new MessageError(uiMessage('extension.runtime.pasteFullInvite'));
      try { const result = await scope.wait(runtime.api.request('invites.preview', { params: { id: invite } })); return { ...result, passwordRequired: result.passwordRequired === true && result.alreadyMember !== true, alreadyMember: result.alreadyMember === true, lockedUntil: typeof result.lockedUntil === 'number' && Number.isFinite(result.lockedUntil) ? result.lockedUntil : null, invite }; }
      catch (error) { scope.check(); if (error instanceof ApiError && error.status === 404) await scope.wait(this.dismissInvite(new URL(`/invite/${invite}`, runtime.state.config.websiteUrl).href)); throw error; }
}

export async function joinCommand(this: RuntimeCommands, command: Extract<Command, { name: "join" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const result = await scope.wait(this.mutate('invites.join', { body: { invite: p.invite, ...(typeof p.password === 'string' ? { password: p.password } : {}) } })); await scope.wait(this.dismissInvite(new URL(`/invite/${text(p.invite)}`, runtime.state.config.websiteUrl).href)); await scope.wait(runtime.refresh()); runtime.state.preferences.current = result.teamId; await scope.wait(runtime.sharing.savePreferences()); return result;
}

export async function retentionCommand(this: RuntimeCommands, command: Extract<Command, { name: "retention" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.retention', { params: { id: teamId }, body: { retentionDays: p.retentionDays } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function teamCommand(this: RuntimeCommands, command: Extract<Command, { name: "team" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.update', { params: { id: teamId }, body: { name: p.name, description: p.description } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function dissolveCommand(this: RuntimeCommands, command: Extract<Command, { name: "dissolve" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.dissolve', { params: { id: teamId } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function transferCommand(this: RuntimeCommands, command: Extract<Command, { name: "transfer" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
 const result = await scope.wait(runtime.api.request('teams.transfer', { params: { id: teamId }, body: { action: p.action, accountId: p.accountId } })); if ('accepted' in result && result.accepted === false && result.reason) runtime.state.notice = errorMessage({ code: result.reason });
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function leaveCommand(this: RuntimeCommands, command: Extract<Command, { name: "leave" | "remove" | "unban" | "recruitment" }>) {
    const { name } = command; const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request(({ leave: 'teams.leave', remove: 'teams.remove', unban: 'teams.unban', recruitment: 'teams.recruitment' } as const)[name as 'leave' | 'remove' | 'unban' | 'recruitment'], { params: { id: teamId }, body: command.name === 'leave' ? {} : command.name === 'recruitment' ? { active: command.payload.active } : { accountId: command.payload.accountId } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function applyCommand(this: RuntimeCommands, command: Extract<Command, { name: "apply" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.apply', { params: { id: teamId }, body: { note: p.note } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function cancelApplicationCommand(this: RuntimeCommands, command: Extract<Command, { name: "cancel-application" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.cancelApplication', { params: { id: teamId } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function decideCommand(this: RuntimeCommands, command: Extract<Command, { name: "decide" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(this.mutate('teams.decideApplication', { params: { id: teamId }, body: { accountId: p.accountId, accept: p.accept } }));
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function teamPreferencesCommand(this: RuntimeCommands, command: Extract<Command, { name: "team-preferences" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 const teamId = text('teamId' in p ? p.teamId : undefined);
await scope.wait(runtime.api.request('teams.preferences', { params: { id: teamId }, body: { muted: p.muted, readIds: p.readIds } }));
    // A saved mute settles the switch now; the wider refresh follows without holding it.
    if (typeof p.muted === 'boolean') {
      const muted = p.muted, remote = runtime.state.remoteTeams.find(t => t.id === teamId);
      if (remote) remote.preferences = { ...remote.preferences, muted };
      runtime.state.data.teams = runtime.state.data.teams.map(t => t.id === teamId ? { ...t, muted } : t); runtime.emit();
      void runtime.refresh().catch(() => {}); return { done: true };
    }
    await scope.wait(runtime.refresh()); return { done: true };
}

export async function invitationCommand(this: RuntimeCommands, command: Extract<Command, { name: "invitation" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      const session = runtime.auth.session;
      const result = 'password' in p ? await scope.wait(runtime.api.request('invites.password', { params: { id: teamId }, body: { password: typeof p.password === 'string' ? p.password : null } }))
        : p.action ? await scope.wait(this.mutate('invites.linkAction', { params: { id: teamId }, body: { action: p.action } })) : await scope.wait(runtime.api.request('invites.link', { params: { id: teamId } }));
      if (runtime.auth.session !== session || !runtime.state.remoteTeams.some(team => team.id === teamId && team.joined && team.ownerId === id)) return;
      runtime.state.invitations[teamId] = result; runtime.emit(); return result;
}

type LobbyList = 'teams' | 'applications';
/** Whether each lobby list has another page; returned by `lobby` and `lobby-more`. */
export type LobbyPaging = { hasMore: Record<LobbyList, boolean> };
type LobbyContext = {
  session: unknown; q: string; sort: TeamDiscoverySort; version: number; next: Record<LobbyList, string | null>;
  listings: ApiResult<'teams.lobby'>['teams']; applications: ApiResult<'teams.applications'>['applications'];
  loading: Partial<Record<LobbyList, Promise<LobbyPaging | undefined>>>;
};
const lobbies = new WeakMap<RuntimeCommands, LobbyContext>();
const paging = (lobby: LobbyContext): LobbyPaging => ({ hasMore: { teams: lobby.next.teams !== null, applications: lobby.next.applications !== null } });

/** Rebuilds the displayed lobby from every loaded page; a newer search or page wins. */
async function publishLobby(commands: RuntimeCommands, lobby: LobbyContext) {
  const runtime = commands.runtime;
  const scope = runtime.auth.scope();
  const version = ++lobby.version;
  const current = () => lobbies.get(commands) === lobby && lobby.version === version && runtime.auth.session === lobby.session;
  // Preserve the server's discovery order; application-only teams remain available in My Applications.
  const listings = new Map(lobby.listings.map(team => [team.id, team]));
  for (const application of lobby.applications) {
    if (!listings.has(application.teamId)) listings.set(application.teamId, { ...application.team, joined: false });
  }
  const applications = new Map(lobby.applications.map(application => [application.teamId, application]));
  const listed = new Set(lobby.listings.map(team => team.id)), applied = new Map(lobby.applications.map((application, index) => [application.teamId, index]));
  const teams = await scope.wait(Promise.all([...listings.values()].map(async t => {
    const application = applications.get(t.id);
    const status = application?.status ?? t.application;
    const rejectedAt = application?.rejectedAt ?? t.applicationRejectedAt;
    return { listed: listed.has(t.id), appliedOrder: applied.get(t.id), id: t.id, name: t.name, description: t.description, owner: t.owner?.id ?? '', ownerName: t.ownerName, ownerAvatar: await scope.wait(runtime.cache.avatar(t.owner?.avatarId ?? null)), memberCount: t.memberCount, memberIds: [], joined: false, published: (t.recruitmentExpiresAt ?? 0) > Date.now(), publishedAt: t.publishedAt ?? undefined, recruitmentExpiresAt: t.recruitmentExpiresAt ?? undefined, activity: t.activity, muted: false, unread: 0, requested: status === 'pending', avatar: await scope.wait(runtime.cache.avatar(t.avatarId)), applicationStatus: status, applicationExpiresAt: application?.expiresAt ?? t.applicationExpiresAt, applicationRetryAt: rejectedAt != null ? rejectedAt + APPLICATION_COOLDOWN_MS : undefined };
  })));
  if (!current()) return;
  runtime.state.lobbyTeams = teams;
  runtime.emit();
  return paging(lobby);
}

/** Loads the first page of recruiting teams and of this account's applications, replacing any earlier search. */
export async function lobbyCommand(this: RuntimeCommands, command: Extract<Command, { name: 'lobby' }>) {
  const runtime = this.runtime;
  if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
  const scope = runtime.auth.scope();
  const p = command.payload ?? {};
  const lobby: LobbyContext = { session: runtime.auth.session, q: p.q ?? '', sort: p.sort ?? 'heat', version: 0, next: { teams: null, applications: null }, listings: [], applications: [], loading: {} };
  lobbies.set(this, lobby);
  try {
    const [teams, applications] = await scope.wait(Promise.all([
      runtime.api.request('teams.lobby', { query: { q: lobby.q, sort: lobby.sort } }),
      runtime.api.request('teams.applications', { query: {} }),
    ]));
    if (lobbies.get(this) !== lobby) return;
    Object.assign(lobby, { listings: teams.teams, applications: applications.applications, next: { teams: teams.next, applications: applications.next } });
    return await publishLobby(this, lobby);
  } catch (error) {
    scope.check();
    if (lobbies.get(this) !== lobby) return;
    throw error;
  }
}

/** Appends the next page of one lobby list; concurrent calls for the same list share one request. */
export async function lobbyMoreCommand(this: RuntimeCommands, command: Extract<Command, { name: 'lobby-more' }>) {
  const runtime = this.runtime;
  const lobby = lobbies.get(this);
  if (!lobby || runtime.auth.session !== lobby.session) return;
  const { list } = command.payload;
  const after = lobby.next[list];
  if (after === null) return paging(lobby);
  const scope = runtime.auth.scope();
  lobby.loading[list] ??= (async () => {
    try {
      if (list === 'teams') {
        const page = await scope.wait(runtime.api.request('teams.lobby', { query: { q: lobby.q, sort: lobby.sort, after } }));
        if (lobbies.get(this) !== lobby) return;
        const known = new Set(lobby.listings.map(team => team.id));
        lobby.listings = [...lobby.listings, ...page.teams.filter(team => !known.has(team.id))]; lobby.next.teams = page.next;
      } else {
        const page = await scope.wait(runtime.api.request('teams.applications', { query: { after } }));
        if (lobbies.get(this) !== lobby) return;
        const known = new Set(lobby.applications.map(application => application.teamId));
        lobby.applications = [...lobby.applications, ...page.applications.filter(application => !known.has(application.teamId))]; lobby.next.applications = page.next;
      }
      const result = await publishLobby(this, lobby);
      if (lobbies.get(this) !== lobby) return;
      return result ?? paging(lobby);
    } catch (error) {
      scope.check();
      if (lobbies.get(this) !== lobby) return;
      throw error;
    } finally { delete lobby.loading[list]; }
  })();
  return await lobby.loading[list];
}

export const teamsHandlers = {
  'dismiss-invite': dismissInviteCommand,
  'external-team': externalTeamCommand,
  'dismiss-open-team': dismissOpenTeamCommand,
  'external-invite': externalInviteCommand,
  'create': createCommand,
  'invite-preview': invitePreviewCommand,
  'join': joinCommand,
  'retention': retentionCommand,
  'team': teamCommand,
  'dissolve': dissolveCommand,
  'transfer': transferCommand,
  'leave': leaveCommand,
  'remove': leaveCommand,
  'unban': leaveCommand,
  'recruitment': leaveCommand,
  'apply': applyCommand,
  'cancel-application': cancelApplicationCommand,
  'decide': decideCommand,
  'team-preferences': teamPreferencesCommand,
  'invitation': invitationCommand,
  'lobby': lobbyCommand,
  'lobby-more': lobbyMoreCommand,
} satisfies HandlerRegistry;
