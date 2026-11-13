import { errorMessage, message as uiMessage, MessageError } from '@palside/i18n';
import { ApiError } from '../transport/api';
import { parseInvitation } from '@palside/shared/navigation';
import type { Command } from '../transport/command-map';
import type { ApiResult } from '../transport/api';
import type { TeamDiscoverySort } from '@palside/shared/team-activity';
import { APPLICATION_COOLDOWN_MS } from '@palside/shared/rules/teams';
import { text } from '../composition/state';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';
import { signedIn } from '../composition/signed-in';

type TeamCommand<Name extends Command['name']> = Extract<Command, { name: Name }>;

/** Runs one team change on the service, then reloads the account's teams so every view shows the result. */
async function changeTeam(commands: RuntimeCommands, change: (runtime: RuntimeCommands['runtime']) => Promise<unknown>) {
  const { runtime, scope } = signedIn(commands);
  await scope.wait(change(runtime));
  await scope.wait(runtime.refresh());
  return { done: true } as const;
}

/** Opens a team after creating or joining it: the panel switches to it on this and the account's other devices. */
async function openTeam(commands: RuntimeCommands, scope: ReturnType<RuntimeCommands['runtime']['auth']['scope']>, teamId: string) {
  const runtime = commands.runtime;
  await scope.wait(runtime.refresh());
  runtime.state.preferences.current = teamId;
  await scope.wait(runtime.sharing.savePreferences());
}

const inviteUrl = (commands: RuntimeCommands, code: string) => new URL(`/invite/${code}`, commands.runtime.state.config.websiteUrl).href;
const validCode = (code: string) => /^[A-Za-z0-9_-]{32}$/.test(code);
const validTeamId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

export async function dismissInviteCommand(this: RuntimeCommands, command: TeamCommand<'dismiss-invite'>) {
  const url = text(command.payload.url);
  if (this.runtime.state.data.pendingInvite === url) this.inviteRequest++;
  await this.dismissInvite(url);
}

/** 申请加入 on the website: the panel opens that team's recruitment page. */
export async function externalTeamCommand(this: RuntimeCommands, command: TeamCommand<'external-team'>) {
  const id = text(command.payload.id);
  if (!validTeamId(id)) throw new MessageError(uiMessage('extension.runtime.invalidInvite'));
  this.runtime.state.data.openTeam = id;
  this.runtime.emit();
}

export async function dismissOpenTeamCommand(this: RuntimeCommands) {
  this.runtime.state.data.openTeam = undefined;
  this.runtime.emit();
}

/** 打开 palside on an invite page: the invite is checked, then kept (one at a time) until it is joined, dismissed or expires. */
export async function externalInviteCommand(this: RuntimeCommands, command: TeamCommand<'external-invite'>) {
  const runtime = this.runtime, code = text(command.payload.code);
  if (!validCode(code)) throw new MessageError(uiMessage('extension.runtime.invalidInvite'));
  const request = ++this.inviteRequest;
  if (runtime.state.data.pendingInvite) await this.dismissInvite(runtime.state.data.pendingInvite);
  if (request !== this.inviteRequest) return;
  const invite = await runtime.api.request('invites.preview', { params: { id: code } });
  const url = inviteUrl(this, code);
  if (request !== this.inviteRequest) return;
  await runtime.storage.put('pending-invite', '_device', 'invite', url, invite.expiresAt);
  if (request !== this.inviteRequest) { await runtime.storage.removeIfValue('pending-invite', url); return; }
  this.inviteExpiresAt = invite.expiresAt;
  runtime.state.data.pendingInvite = url;
  runtime.emit();
}

export async function createCommand(this: RuntimeCommands, command: TeamCommand<'create'>) {
  const { scope } = signedIn(this);
  const result = await scope.wait(this.mutate('teams.create', { body: { name: command.payload.name, description: command.payload.description } }));
  await openTeam(this, scope, result.teamId);
  return result;
}

export async function invitePreviewCommand(this: RuntimeCommands, command: TeamCommand<'invite-preview'>) {
  const { runtime, scope } = signedIn(this);
  const invite = parseInvitation(text(command.payload.url), runtime.state.config.websiteUrl);
  if (!invite) throw new MessageError(uiMessage('extension.runtime.pasteFullInvite'));
  try {
    const result = await scope.wait(runtime.api.request('invites.preview', { params: { id: invite } }));
    const alreadyMember = result.alreadyMember === true;
    const lockedUntil = typeof result.lockedUntil === 'number' && Number.isFinite(result.lockedUntil) ? result.lockedUntil : null;
    return { ...result, passwordRequired: result.passwordRequired === true && !alreadyMember, alreadyMember, lockedUntil, invite };
  } catch (error) {
    scope.check();
    // A link the service cannot find is forgotten, so the panel stops offering it.
    if (error instanceof ApiError && error.status === 404) await scope.wait(this.dismissInvite(inviteUrl(this, invite)));
    throw error;
  }
}

export async function joinCommand(this: RuntimeCommands, command: TeamCommand<'join'>) {
  const { scope } = signedIn(this);
  const { invite, password } = command.payload;
  const result = await scope.wait(this.mutate('invites.join', { body: { invite, ...(typeof password === 'string' ? { password } : {}) } }));
  await scope.wait(this.dismissInvite(inviteUrl(this, text(invite))));
  await openTeam(this, scope, result.teamId);
  return result;
}

export function retentionCommand(this: RuntimeCommands, command: TeamCommand<'retention'>) {
  const { teamId, retentionDays } = command.payload;
  return changeTeam(this, runtime => runtime.api.request('teams.retention', { params: { id: teamId }, body: { retentionDays } }));
}

export function teamCommand(this: RuntimeCommands, command: TeamCommand<'team'>) {
  const { teamId, name, description } = command.payload;
  return changeTeam(this, runtime => runtime.api.request('teams.update', { params: { id: teamId }, body: { name, description } }));
}

export function dissolveCommand(this: RuntimeCommands, command: TeamCommand<'dissolve'>) {
  return changeTeam(this, runtime => runtime.api.request('teams.dissolve', { params: { id: command.payload.teamId } }));
}

/** 转让: request, accept, reject or cancel. An accept the service refuses (the conditions stopped holding) says why. */
export function transferCommand(this: RuntimeCommands, command: TeamCommand<'transfer'>) {
  const { teamId, action, accountId } = command.payload;
  return changeTeam(this, async runtime => {
    const result = await runtime.api.request('teams.transfer', { params: { id: teamId }, body: { action, accountId } });
    if ('accepted' in result && result.accepted === false && result.reason) runtime.state.notice = errorMessage({ code: result.reason });
  });
}

export function leaveCommand(this: RuntimeCommands, command: TeamCommand<'leave'>) {
  return changeTeam(this, runtime => runtime.api.request('teams.leave', { params: { id: command.payload.teamId }, body: {} }));
}

export function memberCommand(this: RuntimeCommands, command: TeamCommand<'remove' | 'unban'>) {
  const { teamId, accountId } = command.payload;
  return changeTeam(this, runtime => runtime.api.request(command.name === 'remove' ? 'teams.remove' : 'teams.unban', { params: { id: teamId }, body: { accountId } }));
}

export function recruitmentCommand(this: RuntimeCommands, command: TeamCommand<'recruitment'>) {
  const { teamId, active } = command.payload;
  return changeTeam(this, runtime => runtime.api.request('teams.recruitment', { params: { id: teamId }, body: { active } }));
}

export function applyCommand(this: RuntimeCommands, command: TeamCommand<'apply'>) {
  const { teamId, note } = command.payload;
  return changeTeam(this, runtime => runtime.api.request('teams.apply', { params: { id: teamId }, body: { note } }));
}

export function cancelApplicationCommand(this: RuntimeCommands, command: TeamCommand<'cancel-application'>) {
  return changeTeam(this, runtime => runtime.api.request('teams.cancelApplication', { params: { id: command.payload.teamId } }));
}

export function decideCommand(this: RuntimeCommands, command: TeamCommand<'decide'>) {
  const { teamId, accountId, accept } = command.payload;
  return changeTeam(this, () => this.mutate('teams.decideApplication', { params: { id: teamId }, body: { accountId, accept } }));
}

/** 静音 and read marks. The service saved exactly this: it applies here at once, and the account's other devices get a refresh push. */
export async function teamPreferencesCommand(this: RuntimeCommands, command: TeamCommand<'team-preferences'>) {
  const { runtime, scope } = signedIn(this);
  const { teamId, muted, readIds } = command.payload;
  await scope.wait(runtime.api.request('teams.preferences', { params: { id: teamId }, body: { muted, readIds } }));
  const read = Array.isArray(readIds) ? readIds.filter((id): id is string => typeof id === 'string') : [];
  const remote = runtime.state.remoteTeams.find(team => team.id === teamId);
  if (remote) remote.preferences = { ...remote.preferences, ...(typeof muted === 'boolean' ? { muted } : {}), readIds: [...new Set([...remote.preferences.readIds, ...read])] };
  if (typeof muted === 'boolean') runtime.state.data.teams = runtime.state.data.teams.map(team => team.id === teamId ? { ...team, muted } : team);
  runtime.emit();
  return { done: true } as const;
}

/** The captain's invite link and join password: read, regenerate, revoke, or set the password (`null` turns it off). */
export async function invitationCommand(this: RuntimeCommands, command: TeamCommand<'invitation'>) {
  const { runtime, session, scope } = signedIn(this);
  const p = command.payload, teamId = p.teamId;
  const result = 'password' in p ? await scope.wait(runtime.api.request('invites.password', { params: { id: teamId }, body: { password: typeof p.password === 'string' ? p.password : null } }))
    : p.action ? await scope.wait(this.mutate('invites.linkAction', { params: { id: teamId }, body: { action: p.action } }))
      : await scope.wait(runtime.api.request('invites.link', { params: { id: teamId } }));
  if (runtime.auth.session !== session || !runtime.state.remoteTeams.some(team => team.id === teamId && team.joined && team.ownerId === session.account.id)) return;
  runtime.state.invitations[teamId] = result;
  runtime.emit();
  return result;
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
  const { scope } = signedIn(this);
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

/**
 * A captain approved, rejected or the application expired on another device: the open lobby's 我的申请 reloads its first page, so the
 * applicant never acts on a stale row.
 */
export async function refreshLobbyApplications(commands: RuntimeCommands) {
  const runtime = commands.runtime, lobby = lobbies.get(commands);
  if (!lobby || runtime.auth.session !== lobby.session || lobby.loading.applications) return;
  const scope = runtime.auth.scope();
  const applications = await scope.wait(runtime.api.request('teams.applications', { query: {} }));
  if (lobbies.get(commands) !== lobby || runtime.auth.session !== lobby.session) return;
  lobby.applications = applications.applications; lobby.next.applications = applications.next;
  await publishLobby(commands, lobby);
}

/** The lobby left the screen: account changes stop reloading its 我的申请; the next visit loads it afresh. */
export async function lobbyCloseCommand(this: RuntimeCommands) { lobbies.delete(this); }

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
  'remove': memberCommand,
  'unban': memberCommand,
  'recruitment': recruitmentCommand,
  'apply': applyCommand,
  'cancel-application': cancelApplicationCommand,
  'decide': decideCommand,
  'team-preferences': teamPreferencesCommand,
  'invitation': invitationCommand,
  'lobby': lobbyCommand,
  'lobby-more': lobbyMoreCommand,
  'lobby-close': lobbyCloseCommand,
} satisfies HandlerRegistry;
