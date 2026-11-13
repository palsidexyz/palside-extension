import test from 'node:test';
import assert from 'node:assert/strict';
import { searchMessages, searchNeedle, searchableMessages } from '../apps/extension/src/domain/chat/search.ts';

const view = { id: 'Base:0xAbC', kind: 'asset', name: 'PONS', chain: 'Base', address: '0xAbCdEf' };
const messages = [
  { id: 'a', teamId: 't', author: 'p', text: '看 pons 这根线', time: '', status: 'sent', timestamp: 1 },
  { id: 'b', teamId: 't', author: 'p', text: '', time: '', status: 'sent', timestamp: 2, attachment: { kind: 'asset', assetId: view.id, view } },
  { id: 'c', teamId: 't', author: 'p', text: 'pons 撤回了', time: '', status: 'sent', timestamp: 3, recalled: true },
  { id: 'd', teamId: 't', author: 'p', text: 'pons 发送中', time: '', status: 'pending', timestamp: 4 },
  { id: 'e', teamId: 't', author: 'p', text: '别的话题', time: '', status: 'sent', timestamp: 5 },
];

test('a search reads only sent, readable messages, newest first', () => {
  assert.deepEqual(searchableMessages(messages).map(m => m.id), ['e', 'b', 'a']);
  assert.deepEqual(searchMessages(messages, '').map(hit => [hit.message.id, hit.field]), [['e', 'none'], ['b', 'none'], ['a', 'none']]);
});

test('the query is trimmed and case-folded, and a card matches by name or address', () => {
  assert.equal(searchNeedle('  PONS '), 'pons');
  assert.deepEqual(searchMessages(messages, 'PONS ').map(hit => [hit.message.id, hit.field]), [['b', 'card'], ['a', 'text']]);
  assert.deepEqual(searchMessages(messages, '0xabcdef').map(hit => hit.message.id), ['b']);
  assert.deepEqual(searchMessages(messages, '没有').map(hit => hit.message.id), []);
});
