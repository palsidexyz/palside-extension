import { decodeContract, ContractDecodeError } from '../packages/shared/src/contracts/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { application, applicationsPage, lobby } from '../packages/shared/src/contracts/team-model.ts';
import { LOBBY_RESULT_LIMIT } from '@palside/shared/rules/teams';

const team = { id: 'team', name: 'Team', description: '', avatarId: null, ownerName: 'Owner', memberCount: 1, publishedAt: 1, recruitmentExpiresAt: 100, node: 'https://api.test' };
const request = { teamId: team.id, accountId: 'applicant', note: '', createdAt: 1, expiresAt: 100, rejectedAt: null };

test('application and discovery contracts allow pending and rejected applications only', () => {
  for (const status of ['pending', 'rejected']) {
    const row = { ...request, status, rejectedAt: status === 'rejected' ? 2 : null };
    assert.equal(decodeContract(application, row).status, status);
    assert.equal(decodeContract(lobby, { teams: [{ ...team, joined: false, application: status }], next: null }).teams[0].application, status);
    assert.equal(decodeContract(applicationsPage, { applications: [{ ...row, team }], next: 'cursor' }).applications[0].status, status);
  }
  assert.throws(() => decodeContract(application, { ...request, status: 'accepted' }), ContractDecodeError);
  assert.throws(() => decodeContract(lobby, { teams: [{ ...team, joined: false, application: 'accepted' }], next: null }), ContractDecodeError);
  assert.throws(() => decodeContract(applicationsPage, { applications: [{ ...request, status: 'accepted', team }], next: null }), ContractDecodeError);
  const joined = decodeContract(lobby, { teams: [{ ...team, joined: true }], next: null });
  assert.equal(joined.teams[0].joined, true);
  assert.equal(joined.teams[0].application, undefined);
});

test('lobby pages hold at most one page and carry an opaque next cursor', () => {
  const row = { ...team, joined: false };
  assert.equal(decodeContract(lobby, { teams: Array.from({ length: LOBBY_RESULT_LIMIT }, (_, index) => ({ ...row, id: `t${index}` })), next: 'abc_-1' }).next, 'abc_-1');
  assert.throws(() => decodeContract(lobby, { teams: Array.from({ length: LOBBY_RESULT_LIMIT + 1 }, () => row), next: null }), ContractDecodeError);
  for (const next of ['', 'a+b', 'a/b', 'a='.repeat(1)]) assert.throws(() => decodeContract(lobby, { teams: [], next }), ContractDecodeError);
  assert.throws(() => decodeContract(lobby, { teams: [] }), ContractDecodeError);
});
