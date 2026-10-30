import { errorMessage,message as uiMessage,MessageError } from '@palside/i18n';
import { ApiError } from '../transport/api';
import { parseInvitation } from '@palside/shared/navigation';
import type { Command } from '../transport/command-map';
import { DAY,text } from '../composition/state';
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

const lobbyRequests = new WeakMap<RuntimeCommands, symbol>();

export async function lobbyCommand(this: RuntimeCommands, command: Extract<Command, { name: 'lobby' }>) {
  const runtime = this.runtime;
  if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
  const scope = runtime.auth.scope();
  const session = runtime.auth.session;
  const request = Symbol();
  lobbyRequests.set(this, request);
  const current = () => lobbyRequests.get(this) === request && runtime.auth.session === session;
  const p = command.payload ?? {};
  try {
    const result = await scope.wait(runtime.api.request('teams.lobby', { query: { q: p.q ?? '', sort: p.sort ?? 'heat' } }));
    if (!current()) return;
    // Preserve the server's discovery order; application-only teams remain available in My Applications.
    const listings = new Map(result.teams.map(team => [team.id, team]));
    for (const application of result.applications) {
      if (!listings.has(application.teamId)) listings.set(application.teamId, { ...application.team, joined: false });
    }
    const applications = new Map(result.applications.map(application => [application.teamId, application]));
    const teams = await scope.wait(Promise.all([...listings.values()].map(async t => {
      const application = applications.get(t.id);
      return { id: t.id, name: t.name, description: t.description, owner: t.owner?.id ?? '', ownerName: t.ownerName, ownerAvatar: await scope.wait(runtime.cache.avatar(t.owner?.avatarId ?? null)), memberCount: t.memberCount, memberIds: [], joined: false, published: (t.recruitmentExpiresAt ?? 0) > Date.now(), publishedAt: t.publishedAt ?? undefined, recruitmentExpiresAt: t.recruitmentExpiresAt ?? undefined, activity: t.activity, muted: false, unread: 0, requested: application?.status === 'pending', avatar: await scope.wait(runtime.cache.avatar(t.avatarId)), applicationStatus: application?.status, applicationExpiresAt: application?.expiresAt, applicationRetryAt: application?.rejectedAt ? application.rejectedAt + DAY : undefined };
    })));
    if (!current()) return;
    runtime.state.lobbyTeams = teams;
    runtime.emit();
    return result;
  } catch (error) {
    scope.check();
    if (!current()) return;
    throw error;
  }
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
} satisfies HandlerRegistry;
