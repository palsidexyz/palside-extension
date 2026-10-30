import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { application, lobby } from '../packages/shared/src/contracts/team-model.ts';
import { ContractDecodeError } from '../packages/shared/src/contracts/validation.ts';

const team = { id: 'team', name: 'Team', description: '', avatarId: null, ownerName: 'Owner', memberCount: 1, publishedAt: 1, recruitmentExpiresAt: 100, node: 'https://api.test' };
const request = { teamId: team.id, accountId: 'applicant', note: '', createdAt: 1, expiresAt: 100, rejectedAt: null };

test('application and discovery contracts allow pending and rejected applications only', () => {
  for (const status of ['pending', 'rejected']) {
    const row = { ...request, status, rejectedAt: status === 'rejected' ? 2 : null };
    assert.equal(decodeContract(application, row).status, status);
    const result = decodeContract(lobby, { teams: [{ ...team, joined: false, application: status }], applications: [{ ...row, team }] });
    assert.equal(result.teams[0].application, status);
    assert.equal(result.applications[0].status, status);
  }
  assert.throws(() => decodeContract(application, { ...request, status: 'accepted' }), ContractDecodeError);
  assert.throws(() => decodeContract(lobby, { teams: [{ ...team, joined: false, application: 'accepted' }], applications: [] }), ContractDecodeError);
  assert.throws(() => decodeContract(lobby, { teams: [], applications: [{ ...request, status: 'accepted', team }] }), ContractDecodeError);
  const joined = decodeContract(lobby, { teams: [{ ...team, joined: true }], applications: [] });
  assert.equal(joined.teams[0].joined, true);
  assert.equal(joined.teams[0].application, undefined);
});
