import test from 'node:test';
import assert from 'node:assert/strict';


test('sharing and favorites use equal public page keys', async () => {
  const { publicShareUrl, pageKey } = await import('../packages/shared/src/navigation.ts');
  const { pageScopeUrl, readFavorites } = await import('../apps/extension/src/domain/annotations/interaction.ts');
  for (const tail of ['?ref=alice&x=1', '?referral=a&referrer=b&utm_source=c&x=1#part', '?UTM_campaign=c&REF=a&x=1#/route?ref=meaningful', '?x=1&x=2&order=desc#part']) {
    const url = `https://example.com/article${tail}`;
    const expected = publicShareUrl(url);
    assert.deepEqual([readFavorites({ sites: [], pages: [{ url, title: 'Article' }] }).pages[0].url, pageScopeUrl(url), pageKey(url)], Array(3).fill(expected));
  }
  assert.notEqual(pageScopeUrl('https://example.com/?x=1'), pageScopeUrl('https://example.com/?x=2'));
  assert.notEqual(pageScopeUrl('https://example.com/#one'), pageScopeUrl('https://example.com/#two'));
});

test('a call is answered on the same page or on the same token anywhere', async () => {
  const { reachedCall } = await import('../apps/extension/src/domain/annotations/social.ts');
  const token = { kind: 'asset', chain: 'Ethereum', address: '0x1111111111111111111111111111111111111111', url: 'https://dexscreener.com/ethereum/0x1111111111111111111111111111111111111111' };
  assert.ok(reachedCall(token, { kind: 'asset', chain: 'Ethereum', address: '0x1111111111111111111111111111111111111111', url: 'https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111' }));
  assert.ok(!reachedCall(token, { kind: 'asset', chain: 'Ethereum', address: '0x2222222222222222222222222222222222222222', url: 'https://gmgn.ai/eth/token/0x2222222222222222222222222222222222222222' }));
  const post = { kind: 'website', url: 'https://x.com/robin/status/1' };
  assert.ok(reachedCall(post, { kind: 'website', url: 'https://www.x.com/robin/status/1?utm_source=a' }));
  assert.ok(!reachedCall(post, { kind: 'website', url: 'https://x.com/robin/status/2' }));
});

test('喊来看 mentions the people it calls, so it notifies them under 仅 @ too, never under 关闭 or from a muted squad', async () => {
  const { notificationTarget } = await import('../apps/extension/src/runtime/chat/notification-policy.ts');
  const now = 10_000_000;
  const call = (mentionIds, kind = 'all') => ({ id: 'm', teamId: 't', author: 'robin', text: '', time: '', status: 'sent', timestamp: now, call: kind, mentionIds, attachment: { kind: 'asset', assetId: 'x', view: { url: 'https://x.com' } } });
  const state = (notifications, message, muted = false) => ({
    authenticated: true, account: { id: 'me' }, preferences: { notifications, notificationPreview: false },
    remoteTeams: [{ id: 't', joined: true, preferences: { muted, readIds: [] } }], data: { messages: [message] },
  });
  const identity = { accountId: 'me', teamId: 't', messageId: 'm', preview: false };
  assert.ok(notificationTarget(state('all', call(['me', 'mia'])), identity, now)?.mentioned);
  assert.ok(notificationTarget(state('mentions', call(['me', 'mia'])), identity, now));
  assert.ok(notificationTarget(state('mentions', call(['me'], 'one')), identity, now));
  assert.equal(notificationTarget(state('mentions', call(['mia'], 'one')), identity, now), undefined);
  assert.equal(notificationTarget(state('off', call(['me'])), identity, now), undefined);
  assert.equal(notificationTarget(state('all', call(['me']), true), identity, now), undefined);
});

test('a call travels only on a page card', async () => {
  const { parseCommand } = await import('../apps/extension/src/runtime/transport/command-map.ts');
  const message = { id: 'm', teamId: 't', author: 'me', text: '', time: '', status: 'sending', call: 'all', mentionIds: ['mia'] };
  assert.ok(parseCommand({ name: 'send', payload: { revision: -1, message: { ...message, attachment: { kind: 'asset', assetId: 'x', view: { url: 'https://x.com' } } } } }));
  assert.throws(() => parseCommand({ name: 'send', payload: { revision: -1, message } }));
  assert.throws(() => parseCommand({ name: 'send', payload: { revision: -1, message: { ...message, call: 'loud', attachment: { kind: 'asset', assetId: 'x' } } } }));
  for (const name of ['poke', 'poke-open', 'dismiss-poke']) assert.throws(() => parseCommand({ name, payload: { teamId: 't' } }));
});
