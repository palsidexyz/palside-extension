import { DAY_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { APPLICATION_COOLDOWN_MS } from '@palside/shared/rules/teams';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/runtime/')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { lobbyCommand, lobbyMoreCommand, lobbyCloseCommand, refreshLobbyApplications } = await import('../apps/extension/src/runtime/teams/command-handlers.ts');
const { Api } = await import('../apps/extension/src/runtime/transport/api.ts');
hooks.deregister();

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const team = (id, patch = {}) => ({ id, name: id, description: '', avatarId: null, ownerName: 'Owner', memberCount: 2, publishedAt: 1, recruitmentExpiresAt: Date.now() + DAY_MS, node: 'test', joined: false, ...patch });
const result = (...teams) => ({ teams, next: null });
const noApplications = { applications: [], next: null };
const done = { hasMore: { teams: false, applications: false } };
function fixture(request) {
  let emits = 0;
  const runtime = {
    auth: { session: {}, scope() {
      const session = this.session;
      const current = () => this.session === session;
      const check = () => { if (!current()) throw Error('scope changed'); };
      return { current, check, async wait(work) { const value = await work; check(); return value; } };
    } },
    api: { request: (id, options) => id === 'teams.applications' ? Promise.resolve(noApplications) : request(id, options) }, cache: { avatar: async id => id ? `blob:${id}` : undefined },
    state: { lobbyTeams: [] }, emit: () => { emits++; },
  };
  const commands = { runtime };
  return { runtime, commands, run: payload => lobbyCommand.call(commands, { name: 'lobby', ...(payload === undefined ? {} : { payload }) }), more: list => lobbyMoreCommand.call(commands, { name: 'lobby-more', payload: { list } }), emits: () => emits };
}

test('lobby sends search and sort through the real API contract and defaults existing callers to heat', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(new URL(url)); return Response.json(new URL(url).pathname === '/lobby/applications' ? noApplications : result(team('a', { activity: { level: 1, rank: 1, isNew: false } }))); });
  const f = fixture(); f.runtime.api = new Api('https://api.test');
  for (const payload of [undefined, {}, { q: '小队 & %_', sort: 'latest' }, { q: '' }, { sort: 'heat' }]) assert.deepEqual(await f.run(payload), done);
  assert.equal(calls.filter(url => url.pathname === '/lobby/applications').length, 5);
  assert.deepEqual(calls.filter(url => url.pathname === '/lobby').map(url => [url.pathname, url.searchParams.get('q'), url.searchParams.get('sort')]), [
    ['/lobby', '', 'heat'], ['/lobby', '', 'heat'], ['/lobby', '小队 & %_', 'latest'], ['/lobby', '', 'heat'], ['/lobby', '', 'heat'],
  ]);
  assert.deepEqual(f.runtime.state.lobbyTeams[0].activity, { level: 1, rank: 1, isNew: false });
});

test('lobby keeps server order, activity and application state without duplicating teams', async () => {
  const activity = { level: 2, rank: 2, isNew: false };
  const onlyApplication = team('closed', { activity: { level: 1, rank: null, isNew: true }, recruitmentExpiresAt: null });
  delete onlyApplication.joined;
  const response = result(team('first'), team('applied', { activity, avatarId: 'avatar', owner: { id: 'owner', avatarId: 'portrait' } }));
  const applications = { applications: [
    { teamId: 'applied', team: team('applied', { name: 'old snapshot' }), status: 'pending', expiresAt: 123 },
    { teamId: 'closed', team: onlyApplication, status: 'rejected', expiresAt: 456, rejectedAt: 100 },
  ], next: null };
  const f = fixture(async () => response); f.runtime.api.request = async id => id === 'teams.applications' ? applications : response;
  assert.deepEqual(await f.run(), done);
  const teams = f.runtime.state.lobbyTeams;
  assert.deepEqual(teams.map(row => row.id), ['first', 'applied', 'closed']);
  assert.equal(teams[1].name, 'applied');
  assert.deepEqual(teams[1].activity, activity);
  assert.equal(teams[1].requested, true);
  assert.equal(teams[1].applicationExpiresAt, 123);
  assert.equal(teams[1].avatar, 'blob:avatar');
  assert.equal(teams[1].ownerAvatar, 'blob:portrait');
  assert.equal(teams[2].applicationStatus, 'rejected');
  assert.equal(teams[2].applicationRetryAt, 100 + APPLICATION_COOLDOWN_MS);
  assert.equal(teams[2].published, false);
  assert.deepEqual(teams[2].activity, onlyApplication.activity);
  assert.equal(teams[0].activity, undefined);
  assert.equal(f.emits(), 1);
});

test('a late lobby response cannot replace a newer search or load stale avatars', async () => {
  const old = deferred(); let calls = 0, avatars = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.resolve(result(team('new'))));
  f.runtime.cache.avatar = async () => { avatars++; };
  const pending = f.run({ q: 'old' });
  await f.run({ q: 'new', sort: 'latest' });
  const loaded = avatars;
  old.resolve(result(team('old')));
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(avatars, loaded);
  assert.equal(f.emits(), 1);
});

test('a lobby request waiting for avatars cannot overwrite a later request', async () => {
  const avatar = deferred(), started = deferred();
  const f = fixture(async (_id, options) => result(team(options.query.q, { avatarId: options.query.q })));
  f.runtime.cache.avatar = async id => {
    if (id === 'old') { started.resolve(); return avatar.promise; }
    return undefined;
  };
  const pending = f.run({ q: 'old' });
  await started.promise;
  await f.run({ q: 'new' });
  avatar.resolve('blob:old');
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(f.emits(), 1);
});

test('superseded request errors are ignored while current errors propagate', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.resolve(result(team('new'))));
  const pending = f.run({ q: 'old' });
  await f.run({ q: 'new' });
  old.reject(Error('old network failure'));
  assert.equal(await pending, undefined);
  f.runtime.api.request = async () => { throw Error('current network failure'); };
  await assert.rejects(f.run(), /current network failure/);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
  assert.equal(f.emits(), 1);
});

test('a newer failed search still prevents older success from replacing the displayed list', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(() => ++calls === 1 ? old.promise : Promise.reject(Error('offline')));
  const pending = f.run({ q: 'old' });
  await assert.rejects(f.run({ q: 'new' }), /offline/);
  old.resolve(result(team('old')));
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams, []);
  assert.equal(f.emits(), 0);
});

test('lobby requests are isolated per runtime and cannot publish across sessions', async () => {
  const pending = deferred();
  const first = fixture(() => pending.promise), second = fixture(async () => result(team('second')));
  const work = first.run();
  await second.run();
  pending.resolve(result(team('first')));
  await work;
  assert.equal(first.runtime.state.lobbyTeams[0].id, 'first');
  assert.equal(second.runtime.state.lobbyTeams[0].id, 'second');
  const stale = deferred(); first.runtime.api.request = () => stale.promise;
  const changed = first.run(); first.runtime.auth.session = {};
  stale.resolve(result(team('stale')));
  await assert.rejects(changed, /scope changed/);
  assert.equal(first.runtime.state.lobbyTeams[0].id, 'first');
  assert.equal(first.emits(), 1);
  first.runtime.auth.session = undefined;
  await assert.rejects(first.run());
});

test('lobby-more appends the next page of each list with the current search and stops at the end', async () => {
  const calls = [];
  const f = fixture(async () => {});
  f.runtime.api.request = async (id, options) => {
    calls.push([id, options.query]);
    if (id === 'teams.applications') return options.query.after ? { applications: [{ teamId: 'later', team: team('later'), status: 'pending', expiresAt: 9 }], next: null } : { applications: [], next: 'apps-1' };
    return options.query.after ? { teams: [team('b'), team('c')], next: null } : { teams: [team('a'), team('b')], next: 'teams-1' };
  };
  assert.deepEqual(await f.run({ q: 'x', sort: 'latest' }), { hasMore: { teams: true, applications: true } });
  assert.deepEqual(await f.more('teams'), { hasMore: { teams: false, applications: true } });
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(await f.more('applications'), done);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => [row.id, row.requested]), [['a', false], ['b', false], ['c', false], ['later', true]]);
  assert.deepEqual(await f.more('teams'), done);
  assert.deepEqual(calls, [
    ['teams.lobby', { q: 'x', sort: 'latest' }], ['teams.applications', {}],
    ['teams.lobby', { q: 'x', sort: 'latest', after: 'teams-1' }], ['teams.applications', { after: 'apps-1' }],
  ]);
});

test('concurrent lobby-more calls share one request and a new search discards an older page', async () => {
  const page = deferred(); let pages = 0, query = 'old';
  const f = fixture(async () => {});
  f.runtime.api.request = async (id, options) => {
    if (id === 'teams.applications') return noApplications;
    if (options.query.after) { pages++; return page.promise; }
    return { teams: [team(options.query.q)], next: 'more' };
  };
  assert.equal(await f.more('teams'), undefined);
  await f.run({ q: query });
  const first = f.more('teams'), second = f.more('teams');
  query = 'new'; await f.run({ q: query });
  page.resolve({ teams: [team('stale')], next: null });
  assert.equal(await first, undefined); assert.equal(await second, undefined);
  assert.equal(pages, 1);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
});

test('recruiting rows retain application status and cooldown before their application page is loaded', async () => {
  const f = fixture(async () => result(
    team('pending', { application: 'pending', applicationExpiresAt: 200 }),
    team('rejected', { application: 'rejected', applicationExpiresAt: 300, applicationRejectedAt: 0 }),
  ));
  await f.run();
  assert.equal(f.runtime.state.lobbyTeams[0].requested, true);
  assert.equal(f.runtime.state.lobbyTeams[0].applicationExpiresAt, 200);
  assert.equal(f.runtime.state.lobbyTeams[1].applicationStatus, 'rejected');
  assert.equal(f.runtime.state.lobbyTeams[1].applicationRetryAt, APPLICATION_COOLDOWN_MS);
});

test('a page awaiting avatars cannot return stale paging state after a new search', async () => {
  const avatar = deferred(), started = deferred();
  const f = fixture(async (_id, { query }) => query.after ? { teams: [team('later', { avatarId: 'slow' })], next: 'more' } : { teams: [team(query.q)], next: query.q === 'old' ? 'more' : null });
  f.runtime.cache.avatar = async id => { if (id === 'slow') { started.resolve(); return avatar.promise; } };
  await f.run({ q: 'old' });
  const pending = f.more('teams');
  await started.promise;
  await f.run({ q: 'new' });
  avatar.resolve('blob:slow');
  assert.equal(await pending, undefined);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['new']);
});

test('a failed load-more keeps its cursor and can be retried', async () => {
  let fail = true;
  const f = fixture(async (_id, { query }) => {
    if (!query.after) return { teams: [team('first')], next: 'more' };
    if (fail) throw Error('offline');
    return result(team('second'));
  });
  await f.run();
  await assert.rejects(f.more('teams'), /offline/);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['first']);
  fail = false;
  assert.deepEqual(await f.more('teams'), done);
  assert.deepEqual(f.runtime.state.lobbyTeams.map(row => row.id), ['first', 'second']);
});

test('a decision made on another device reloads the open lobby’s applications; without an open lobby nothing is requested', async () => {
  const f = fixture(async () => result());
  let applications = { applications: [{ teamId: 'x', status: 'pending', team: team('x') }], next: null }, reads = 0;
  f.runtime.api.request = async id => { if (id === 'teams.applications') { reads++; return applications; } return result(); };
  await refreshLobbyApplications(f.commands);
  assert.equal(reads, 0, 'no lobby open yet');
  await f.run();
  assert.equal(f.runtime.state.lobbyTeams[0].applicationStatus, 'pending');
  applications = { applications: [], next: null };
  await refreshLobbyApplications(f.commands);
  assert.equal(reads, 2);
  assert.deepEqual(f.runtime.state.lobbyTeams, [], 'the approved application left 我的申请');
  await lobbyCloseCommand.call(f.commands);
  await refreshLobbyApplications(f.commands);
  assert.equal(reads, 2, 'a closed lobby is not reloaded');
});
