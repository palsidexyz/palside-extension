import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyWithMembership, publicTeams } from '../apps/extension/src/domain/teams/lobby-values.ts';

const listing = { id: 'team', name: 'Public team', description: 'Public recruitment', owner: 'current-owner', memberIds: [], memberCount: 2, joined: false, published: true, publishedAt: 10, recruitmentExpiresAt: 1000, muted: false, unread: 0 };

test('read-only membership cannot hide public recruitment or overwrite its public fields', () => {
  const archived = { ...listing, name: 'Archived name', owner: 'old-owner', memberIds: ['private-member'], published: false, recruitmentExpiresAt: undefined, readonly: true };
  const result = lobbyWithMembership([listing], [archived]);
  assert.equal(publicTeams(result, '', 100).length, 1);
  assert.equal(result[0].joined, false);
  assert.equal(result[0].name, 'Public team');
  assert.equal(result[0].owner, 'current-owner');
  assert.deepEqual(result[0].memberIds, []);
  assert.equal(archived.name, 'Archived name');
  assert.equal(archived.published, false);
});

test('approval immediately replaces pending application with joined without selecting the room', () => {
  const pending = { ...listing, requested: true, applicationStatus: 'pending', applicationExpiresAt: 1000 };
  const result = lobbyWithMembership([pending], [{ ...listing, joined: true, memberCount: 3 }]);
  assert.equal(result[0].joined, true);
  assert.equal(result[0].requested, false);
  assert.equal(result[0].memberCount, 3, 'approved membership supplies the updated count');
  assert.equal(pending.requested, true);
  assert.deepEqual(lobbyWithMembership([], [{ ...listing, joined: true }]), [], 'private membership is not a public listing');
});
