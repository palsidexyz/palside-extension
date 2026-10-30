import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
import { TEAM_MEMBER_LIMIT } from '../packages/shared/src/contracts/limits.ts';

const root = 'apps/extension/src/features/palside/teams/';
function panel(live = false) {
  const refs = []; let cursor = 0;
  const calls = [];
  const load = productionModules({
    useRef: value => refs[cursor++] ??= { current: value },
    useEffect: fn => { fn(); }, message: key => key,
  });
  const { useTeamActions } = load(root + 'use-team-actions.ts');
  const adapter = load(root + (live ? 'live-actions.ts' : 'memory-actions.ts'))[live ? 'createLiveTeamActions' : 'createMemoryTeamActions'];
  const view = {
    data: { self: 'self' }, current: 'b',
    teams: ['a', 'b', 'c'].map(id => ({ id, name: id, owner: 'owner', joined: true, memberIds: ['self'], published: true, recruitmentExpiresAt: Date.now() + 10000 })),
    requests: [], setNotice: value => calls.push(['notice', value]),
    setEditing: value => calls.push(['editing', value]), setMemberFilter: value => calls.push(['filter', value]),
    setConfirmation: value => { view.confirmation = value; }, setMessages: () => {},
    setTeams: update => { view.teams = update(view.teams); },
    ...(live ? { live: { state: { preferences: {} }, command: async (...args) => { calls.push(args); return { done: true }; } } } : {}),
  };
  const state = { view, setKeptTeams: update => update(new Set()), setCurrent: id => { view.current = id; calls.push(['current', id]); }, setRequests: update => { view.requests = update(view.requests); } };
  let actions;
  function Render() {
    cursor = 0; view.team = view.teams.find(team => team.id === view.current) ?? view.teams[0];
    actions = { go: to => calls.push(['go', to]), run: async (...args) => { calls.push(args); return { done: true }; }, ...useTeamActions(state, () => actions), ...adapter(state, () => actions) };
    return actions;
  }
  return { view, calls, Render, get actions() { return actions; } };
}

for (const live of [false, true]) test(`exit uses explicit panel selection recency in ${live ? 'live' : 'memory'} actions`, () => {
  const p = panel(live);
  p.Render().chooseTeam('c'); p.Render().chooseTeam('a'); p.Render().chooseTeam('c'); p.Render().chooseTeam('b');
  p.calls.length = 0;
  p.Render().exitTeam('b', 'left');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0])), live ? ['preferences', { accountId: 'self', current: 'c' }] : ['current', 'c']);
  assert.deepEqual(p.calls.at(-1), ['notice', 'left']);
});

test('exit ignores ineligible selections, falls back to list order, and clears when none remain', () => {
  const p = panel();
  p.Render().chooseTeam('c');
  p.view.teams = p.view.teams.map(team => team.id === 'c' ? { ...team, joined: false } : team);
  p.calls.length = 0;
  p.Render().exitTeam('b', 'left');
  assert.deepEqual(p.calls[0], ['current', 'a']);
  p.view.teams = p.view.teams.map(team => ({ ...team, joined: false }));
  p.calls.length = 0;
  p.Render().exitTeam('a', 'left');
  assert.deepEqual(p.calls[0], ['current', '']);
});

test('history is isolated between panel sessions and no-history fallback follows list order', () => {
  const first = panel(); first.Render().chooseTeam('c');
  const second = panel(); second.Render().exitTeam('b', 'left');
  assert.deepEqual(second.calls[0], ['current', 'a']);
  first.calls.length = 0; first.Render().exitTeam('b', 'left');
  assert.deepEqual(first.calls[0], ['current', 'c']);
});

test('a deferred leave uses the latest eligible squads and selections', async () => {
  const p = panel(true);
  let resolve;
  p.view.live.command = () => new Promise(yes => { resolve = yes; });
  p.Render().chooseTeam('c'); p.Render().leave();
  const leaving = p.view.confirmation.confirm();
  p.view.teams = p.view.teams.filter(team => team.id !== 'c');
  p.Render(); p.calls.length = 0;
  resolve(); await leaving;
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0])), ['preferences', { accountId: 'self', current: 'a' }]);
});

test('join and approval capacity guards use the shared member limit', () => {
  for (const live of [false, true]) {
    const p = panel(live);
    p.view.teams[0] = { ...p.view.teams[0], joined: false, memberCount: TEAM_MEMBER_LIMIT };
    p.Render().joinTeam('a');
    assert.deepEqual(p.calls.at(-1), ['notice', 'extension.copy.joinLimit']);
    p.view.teams[1] = { ...p.view.teams[1], owner: 'self', memberCount: TEAM_MEMBER_LIMIT };
    p.view.requests = [{ id: 'request', teamId: 'b', personId: 'new', createdAt: Date.now(), expiresAt: Date.now() + 10000 }];
    p.Render().approve('request', true);
    assert.deepEqual(p.calls.at(-1), ['notice', 'extension.copy.teamFull']);
    if (!live) {
      p.Render().requestTeam('a', 'hello');
      assert.deepEqual(p.calls.at(-1), ['notice', 'extension.copy.joinLimit']);
    }
  }
});
