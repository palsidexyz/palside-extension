import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
import { TEAM_MEMBER_LIMIT } from '@palside/shared/rules/teams';

const root = 'apps/extension/src/features/palside/teams/';
const choice = call => JSON.parse(JSON.stringify(call));
function panel() {
  const refs = []; let cursor = 0;
  const calls = [];
  const load = productionModules({
    useRef: value => refs[cursor++] ??= { current: value },
    useEffect: fn => { fn(); }, message: key => key,
  });
  const { useTeamActions } = load(root + 'use-team-actions.ts');
  const { createLiveTeamActions } = load(root + 'live-actions.ts');
  const view = {
    data: { self: 'self' }, current: 'b',
    teams: ['a', 'b', 'c'].map(id => ({ id, name: id, owner: 'owner', joined: true, memberIds: ['self'], published: true, recruitmentExpiresAt: Date.now() + 10000 })),
    requests: [], setNotice: value => calls.push(['notice', value]),
    setEditing: value => calls.push(['editing', value]), setMemberFilter: value => calls.push(['filter', value]),
    setConfirmation: value => { view.confirmation = value; },
    live: { state: { preferences: {} }, command: async (...args) => { calls.push(args); return { done: true }; } },
  };
  const state = { view, setKeptTeams: update => update(new Set()) };
  let actions;
  function Render() {
    cursor = 0; view.team = view.teams.find(team => team.id === view.current) ?? view.teams[0];
    actions = { go: to => calls.push(['go', to]), run: async (...args) => { calls.push(args); return { done: true }; }, ...useTeamActions(state, () => actions), ...createLiveTeamActions(state, () => actions) };
    return actions;
  }
  return { view, calls, Render, get actions() { return actions; } };
}

test('exit uses explicit panel selection recency', () => {
  const p = panel();
  p.Render().chooseTeam('c'); p.Render().chooseTeam('a'); p.Render().chooseTeam('c'); p.Render().chooseTeam('b');
  p.calls.length = 0;
  p.Render().exitTeam('b', 'left');
  assert.deepEqual(choice(p.calls[0]), ['preferences', { accountId: 'self', current: 'c' }]);
  assert.deepEqual(p.calls.at(-1), ['notice', 'left']);
});

test('exit ignores ineligible selections, falls back to list order, and clears when none remain', () => {
  const p = panel();
  p.Render().chooseTeam('c');
  p.view.teams = p.view.teams.map(team => team.id === 'c' ? { ...team, joined: false } : team);
  p.calls.length = 0;
  p.Render().exitTeam('b', 'left');
  assert.deepEqual(choice(p.calls[0]), ['preferences', { accountId: 'self', current: 'a' }]);
  p.view.teams = p.view.teams.map(team => ({ ...team, joined: false }));
  p.calls.length = 0;
  p.Render().exitTeam('a', 'left');
  assert.deepEqual(choice(p.calls[0]), ['preferences', { accountId: 'self', current: '' }]);
});

test('history is isolated between panel sessions and no-history fallback follows list order', () => {
  const first = panel(); first.Render().chooseTeam('c');
  const second = panel(); second.Render().exitTeam('b', 'left');
  assert.deepEqual(choice(second.calls[0]), ['preferences', { accountId: 'self', current: 'a' }]);
  first.calls.length = 0; first.Render().exitTeam('b', 'left');
  assert.deepEqual(choice(first.calls[0]), ['preferences', { accountId: 'self', current: 'c' }]);
});

test('a deferred leave uses the latest eligible squads and selections', async () => {
  const p = panel();
  let resolve;
  p.view.live.command = () => new Promise(yes => { resolve = yes; });
  p.Render().chooseTeam('c'); p.Render().leave();
  const leaving = p.view.confirmation.confirm();
  p.view.teams = p.view.teams.filter(team => team.id !== 'c');
  p.Render(); p.calls.length = 0;
  resolve(); await leaving;
  assert.deepEqual(choice(p.calls[0]), ['preferences', { accountId: 'self', current: 'a' }]);
});

test('approval capacity guard uses the shared member limit', () => {
  const p = panel();
  p.view.teams[1] = { ...p.view.teams[1], owner: 'self', memberCount: TEAM_MEMBER_LIMIT };
  p.view.requests = [{ id: 'request', teamId: 'b', personId: 'new', createdAt: Date.now(), expiresAt: Date.now() + 10000 }];
  p.Render().approve('request', true);
  assert.deepEqual(p.calls.at(-1), ['notice', 'extension.copy.teamFull']);
});
