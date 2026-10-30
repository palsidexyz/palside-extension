import test from 'node:test';
import assert from 'node:assert/strict';
import { teamUnreadCounts, unreadMentions } from '../apps/extension/src/domain/chat/unread-mentions.ts';

const now = 20 * 86_400_000;
const message = (id, patch = {}) => ({ id, teamId: 'team', author: 'friend', status: 'sent', text: '', time: '12:00', timestamp: now - 10, expiresAt: now + 100, ...patch });

test('unread mentions exclude own, read, recalled, removed, expired and unsent messages', () => {
  const mentioned = (id, patch = {}) => message(id, { mentionIds: ['self'], ...patch });
  const messages = [mentioned('valid'), mentioned('read'), mentioned('own', { author: 'self' }), mentioned('recalled', { recalled: true }), mentioned('removed', { removedByOwner: true }), mentioned('expired', { expiresAt: now }), mentioned('older', { expiresAt: now - 1 }), message('not-mentioned'), mentioned('other', { mentionIds: ['someone-else'] }), ...['sending', 'waiting', 'failed', 'uncertain'].map(status => mentioned(status, { status }))];
  assert.deepEqual(unreadMentions(messages, 'self', ['read'], now).map(item => item.id), ['valid']);
});

test('historical unread mentions remain jumpable, read backfill stays excluded, sorting is stable and does not mutate input', () => {
  const messages = [message('z', { timestamp: 2, mentionIds: ['self'], liveArrival: true }), message('a', { timestamp: 2, mentionIds: ['self'] }), message('old', { timestamp: 1, mentionIds: ['self'], liveArrival: false }), message('read-backfill', { timestamp: 0, mentionIds: ['self'], liveArrival: false }), message('untimed', { timestamp: undefined, expiresAt: undefined, mentionIds: ['self'] })];
  const original = [...messages];
  assert.deepEqual(unreadMentions(messages, 'self', ['read-backfill'], now).map(item => item.id), ['untimed', 'old', 'a', 'z']);
  assert.deepEqual(messages, original);
  assert.deepEqual(unreadMentions(messages, 'self', messages.map(item => item.id), now), []);
});

test('team unread counts follow each team’s read IDs and count @me separately', () => {
  const now = 1_000;
  const base = { status: 'sent', author: 'other', text: '', time: '' };
  const messages = [
    { ...base, id: 'a1', teamId: 'a', mentionIds: ['self'] },
    { ...base, id: 'a2', teamId: 'a' },
    { ...base, id: 'a3', teamId: 'a', author: 'self' },
    { ...base, id: 'a4', teamId: 'a', recalled: true },
    { ...base, id: 'a5', teamId: 'a', expiresAt: now },
    { ...base, id: 'b1', teamId: 'b', mentionIds: ['self'] },
    { ...base, id: 'c1', teamId: 'c' },
  ];
  const counts = teamUnreadCounts(messages, 'self', new Map([['a', new Set(['a2'])], ['b', new Set()]]), now);
  assert.deepEqual(counts.get('a'), { unread: 1, mentions: 1 });
  assert.deepEqual(counts.get('b'), { unread: 1, mentions: 1 });
  assert.equal(counts.get('c'), undefined);
});
