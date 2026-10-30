import { productionModules } from './helpers/production-module.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../apps/extension/src/runtime/transport/api.ts';
import { connectLiveEvents } from '../apps/extension/src/runtime/transport/live-events.ts';
import { completeTeamStart, startedTeams } from '../apps/extension/src/runtime/teams/onboarding.ts';
import { sessionScope } from '../apps/extension/src/runtime/account/session.ts';
import { parseInvitation } from '../packages/shared/src/navigation.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { connectionStatus } from '../apps/extension/src/runtime/transport/connection.ts';
import { defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures } from '../apps/extension/src/domain/annotations/interaction.ts';

const context = {
  ...languageGlobals, connectLiveEvents, connectionStatus, defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures, ApiError, completeTeamStart, startedTeams, sessionScope, parseInvitation,
  text: value => typeof value === 'string' ? value : '', DAY: 86_400_000, Date, URL,
  DeviceCleanup: class {}, uniqueMediaIds: () => new Set(), color: () => '#eee',
  pruneTeamItems: items => items, offlineDirectory: () => ({}),
};
const load = productionModules(context);
const { RuntimeCommands } = load('apps/extension/src/runtime/composition/dispatch.ts');
const { SharingRuntime } = load('apps/extension/src/runtime/viewing/sharing.ts');
const { SessionRuntime } = load('apps/extension/src/runtime/account/session-lifecycle.ts');
const { emptyState } = load('apps/extension/src/runtime/composition/state.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const invite = 'a'.repeat(32), inviteUrl = `https://palside.test/invite/${invite}`;

function fixture() {
  const stored = new Map(), writes = [];
  const runtime = {
    state: { rooms: emptyState().rooms, config: { websiteUrl: 'https://palside.test' }, preferences: { current: 'team', startedTeams: [], web: { share: true, interact: true } }, toggles: { share: false, interact: false }, remoteTeams: [{ id: 'team', joined: true }], data: { pendingInvite: inviteUrl, teams: [], people: [], messages: [], views: [] }, items: {}, drafts: {}, connection: {} },
    emit() {}, initialise: async () => {},
    storage: {
      get: async key => stored.get(key),
      put: async (key, account, kind, value) => { stored.set(key, structuredClone(value)); writes.push({ key, account, kind, value: structuredClone(value) }); },
      removeIfValue: async () => {}, remove: async () => {}, cache: async () => [],
    },
    cache: { avatar: async () => undefined, expireLocalContent: async () => {}, eventTimes: new Map(), evictCachedContent() {}, preparedViews: new Map(), pruneMedia() {} },
    timeline: { edits: new Map() }, sending: { outgoing: new Map() },
    api: { request: async () => { throw new Error('Unexpected API call'); } },
  };
  runtime.auth = new SessionRuntime(runtime);
  runtime.auth.session = { account: { id: 'alice', nickname: 'Alice' } };
  runtime.state.account = runtime.auth.session.account;
  runtime.sharing = new SharingRuntime(runtime);
  runtime.dispatch = new RuntimeCommands(runtime);
  runtime.refresh = () => runtime.auth.refresh();
  return { runtime, stored, writes };
}

test('invite preview preserves membership and lock expiry; existing membership needs no password', async () => {
  const { runtime } = fixture();
  runtime.api.request = async () => ({ team: { id: 'team' }, expiresAt: 100, passwordRequired: true, alreadyMember: true, lockedUntil: null });
  const member = await runtime.dispatch.execute({ name: 'invite-preview', payload: { url: inviteUrl } });
  assert.equal(member.alreadyMember, true); assert.equal(member.passwordRequired, false); assert.equal(member.invite, invite);
  runtime.api.request = async () => ({ team: { id: 'team' }, passwordRequired: true, lockedUntil: 12345 });
  const locked = await runtime.dispatch.execute({ name: 'invite-preview', payload: { url: inviteUrl } });
  assert.equal(locked.lockedUntil, 12345); assert.equal(locked.alreadyMember, false);
});

test('already-member join still validates the invitation and selects its returned team', async () => {
  const { runtime, stored } = fixture();
  runtime.refresh = async () => {};
  let mutations = 0;
  runtime.dispatch.mutate = async (path, body) => { mutations++; assert.equal(path, 'invites.join'); assert.equal(body.body.invite, invite); return { teamId: 'joined', alreadyMember: true }; };
  const result = await runtime.dispatch.execute({ name: 'join', payload: { invite } });
  assert.equal(result.alreadyMember, true); assert.equal(mutations, 1);
  assert.equal(stored.get('alice:preferences').current, 'joined');
  runtime.dispatch.mutate = async () => { throw new ApiError(404, { error: 'INVITE_EXPIRED' }); };
  await assert.rejects(runtime.dispatch.execute({ name: 'join', payload: { invite } }), error => error.code === 'INVITE_EXPIRED');
  assert.equal(runtime.state.preferences.current, 'joined');
});

test('ApiError keeps lock and retry metadata without accepting invalid lock timestamps', () => {
  const error = new ApiError(403, { error: 'INVITE_PASSWORD_LOCKED', lockedUntil: 10000, retryAfterMs: 2500, remaining: 0 });
  assert.equal(error.lockedUntil, 10000); assert.equal(error.retryAfterMs, 2500); assert.equal(error.remaining, 0);
  assert.equal(new ApiError(403, { lockedUntil: Infinity }).lockedUntil, undefined);
});

test('completion persists once and stale preference commands cannot clear or invent it', async () => {
  const { runtime, stored, writes } = fixture();
  await completeTeamStart(runtime, 'team');
  await completeTeamStart(runtime, 'team');
  assert.equal(writes.length, 1);
  await runtime.dispatch.execute({ name: 'preferences', payload: { accountId: 'alice', startedTeams: ['invented'], current: 'team' } });
  assert.deepEqual(stored.get('alice:preferences').startedTeams, ['team']);
  assert.deepEqual(startedTeams(['team', 'team', null, '', 12]), ['team']);
});

test('completion queues after an older preference write and remains durable', async () => {
  const { runtime, stored } = fixture(), blocked = deferred();
  const put = runtime.storage.put;
  let first = true;
  runtime.storage.put = async (...args) => { if (first) { first = false; await blocked.promise; } return put(...args); };
  const old = runtime.dispatch.execute({ name: 'preferences', payload: { accountId: 'alice', current: 'team' } });
  await Promise.resolve(); await Promise.resolve();
  const completion = completeTeamStart(runtime, 'team');
  blocked.resolve(); await Promise.all([old, completion]);
  assert.deepEqual(stored.get('alice:preferences').startedTeams, ['team']);
});

test('failed completion write retries without forgetting the mark', async () => {
  const { runtime, stored } = fixture();
  const put = runtime.storage.put;
  runtime.storage.put = async () => { throw new Error('storage blocked'); };
  await assert.rejects(completeTeamStart(runtime, 'team'), /storage blocked/);
  assert.deepEqual(runtime.state.preferences.startedTeams, ['team']);
  runtime.storage.put = put;
  await completeTeamStart(runtime, 'team');
  assert.deepEqual(stored.get('alice:preferences').startedTeams, ['team']);
});

test('queued completion cannot write into a replacement account', async () => {
  const { runtime, stored } = fixture(), blocked = deferred();
  runtime.sharing.preferencesQueue = blocked.promise;
  const completing = completeTeamStart(runtime, 'team');
  const rejected = assert.rejects(completing, error => error.text?.key === 'extension.runtime.loginChanged');
  runtime.auth.generation++;
  runtime.auth.session = { account: { id: 'bob' } };
  runtime.state.preferences = { current: '', startedTeams: [] };
  blocked.resolve(); await rejected;
  assert.equal(stored.size, 0); assert.deepEqual(runtime.state.preferences.startedTeams, []);
});

test('only trusted membership refresh completes the empty-team checklist', async () => {
  const { runtime, stored } = fixture();
  const team = { id: 'team', joined: true, memberCount: 2, memberIds: ['alice', 'bob'], people: [], requests: [], periods: [], preferences: { muted: 0, readIds: [] } };
  runtime.api.request = async () => ({ account: runtime.auth.session.account, teams: [team] });
  await runtime.auth.refresh();
  assert.deepEqual(plain(stored.get('alice:preferences').startedTeams), ['team']);
  const other = fixture();
  other.runtime.api.request = async () => { throw new Error('offline'); };
  await assert.rejects(other.runtime.auth.refresh(), /offline/);
  assert.equal(other.stored.size, 0);
});

test('a snapshot superseded during persistence does not mark cold-start membership as known', async () => {
  const { runtime } = fixture(), blocked = deferred(), entered = deferred();
  runtime.state.remoteTeams = [];
  runtime.api.request = async () => ({ account: runtime.auth.session.account, teams: [] });
  const put = runtime.storage.put;
  runtime.storage.put = async (...args) => { entered.resolve(); await blocked.promise; return put(...args); };
  const refreshing = runtime.auth.refresh();
  await entered.promise;
  runtime.auth.session = { ...runtime.auth.session };
  blocked.resolve();
  await refreshing;
  assert.equal(runtime.auth.snapshotAt, 0);
  assert.deepEqual(plain(runtime.state.remoteTeams), []);
  await runtime.auth.refresh();
  assert.ok(runtime.auth.snapshotAt > 0);
});

test('unsupported event kinds and mismatched-account selections are rejected before mutation', async () => {
  const { runtime } = fixture();
  let calls = 0;
  runtime.interactions = { teamEvent: async () => { calls++; } };
  for (const kind of ['danmaku', 'unknown-kind', '', 42]) await assert.rejects(runtime.dispatch.execute({ name: 'team-event', payload: { kind, teamId: 'team' } }));
  await assert.rejects(runtime.dispatch.execute({ name: 'team-event', payload: { kind: 'sticky', teamId: 'team', accountId: 'bob' } }));
  await assert.rejects(runtime.dispatch.execute({ name: 'attach-ref', payload: { teamId: 'team', accountId: 'bob' } }));
  assert.equal(calls, 0);
});

test('unknown commands and preference fields are rejected; observation follows 共享在看 启用 and its composer switch', async () => {
  const { runtime, stored } = fixture();
  await assert.rejects(runtime.dispatch.execute({ name: 'preferences', payload: { accountId: 'alice', unknownField: false } }));
  await assert.rejects(runtime.dispatch.execute({ name: 'unknown-command', payload: { accountId: 'alice' } }));
  await assert.rejects(runtime.dispatch.execute({ name: 'unknown-command', payload: { unknownFlag: true } }));
  await assert.rejects(runtime.dispatch.execute({ name: 'unknown-command', payload: { accountId: 'alice', unknownRules: { 'gmgn.ai': { share: true, interact: true } } } }));
  assert.equal(stored.has('alice:preferences'), false);
  Object.assign(runtime.state, { authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false } });
  runtime.state.preferences = { ...runtime.state.preferences, web: { share: true, interact: true } };
  runtime.state.toggles = { share: false, interact: false };
  assert.equal(Boolean(runtime.sharing.mayObserve()), false, 'the composer switch starts off');
  runtime.state.toggles = { share: true, interact: false };
  assert.equal(Boolean(runtime.sharing.mayObserve()), true);
  runtime.state.preferences = { ...runtime.state.preferences, web: { share: false, interact: true } };
  assert.equal(Boolean(runtime.sharing.mayObserve()), false, '禁用 stops it');
  runtime.state.preferences = { ...runtime.state.preferences, web: { share: true, interact: true } };
  runtime.state.connection = { ...runtime.state.connection, service: 'unavailable' };
  assert.equal(Boolean(runtime.sharing.mayObserve()), false);
});


test('a banned invite preview propagates the existing cannot-join error without submitting', async () => {
  const { runtime } = fixture(), calls = [];
  runtime.api.request = async endpoint => { calls.push(endpoint); throw new ApiError(403, { error: 'JOIN_BLOCKED' }); };
  await assert.rejects(runtime.dispatch.execute({ name: 'invite-preview', payload: { url: inviteUrl } }), { code: 'JOIN_BLOCKED' });
  assert.deepEqual(calls, ['invites.preview']);
});
