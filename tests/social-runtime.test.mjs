import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePoke } from '../apps/extension/src/runtime/annotations/team-items.ts';


test('poke merge groups sender and view', () => {
  const view = { version: 1, id: 'a', kind: 'asset', chain: 'Ethereum', address: '0x1', url: 'https://x.test/a', name: 'A', source: 'x.test', color: '#fff', glyph: 'A' };
  const first = { id: '1', teamId: 't', from: 'a', view, at: 10, count: 1 };
  const merged = mergePoke([first], { ...first, id: '2', at: 20 }, 20);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 2);
});

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

test('喊你来看 arrives on service time, so the two devices\' own clocks never decide', async () => {
  const { readPokeWire } = await import('../apps/extension/src/domain/annotations/social.ts');
  const service = 1_000_000;
  const wire = sentAt => readPokeWire({ id: 'p', teamId: 't', view: {}, sentAt }, service);
  assert.ok(wire(service - 15_000));
  assert.equal(wire(service - 15_001), undefined);
  assert.ok(wire(service + 5_000));
  assert.equal(wire(service + 5_001), undefined);
  assert.equal(readPokeWire({ id: '', teamId: 't', sentAt: service }, service), undefined);
});

test('a call is answered on the same page or on the same token anywhere', async () => {
  const { reachedPoke } = await import('../apps/extension/src/domain/annotations/social.ts');
  const token = { kind: 'asset', chain: 'Ethereum', address: '0x1111111111111111111111111111111111111111', url: 'https://dexscreener.com/ethereum/0x1111111111111111111111111111111111111111' };
  assert.ok(reachedPoke(token, { kind: 'asset', chain: 'Ethereum', address: '0x1111111111111111111111111111111111111111', url: 'https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111' }));
  assert.ok(!reachedPoke(token, { kind: 'asset', chain: 'Ethereum', address: '0x2222222222222222222222222222222222222222', url: 'https://gmgn.ai/eth/token/0x2222222222222222222222222222222222222222' }));
  const post = { kind: 'website', url: 'https://x.com/robin/status/1' };
  assert.ok(reachedPoke(post, { kind: 'website', url: 'https://www.x.com/robin/status/1?utm_source=a' }));
  assert.ok(!reachedPoke(post, { kind: 'website', url: 'https://x.com/robin/status/2' }));
});

test('喊你来看 notifies under every 通知 choice but off, never from a muted squad, and only while it waits', async () => {
  const { pokeNotificationTarget } = await import('../apps/extension/src/runtime/chat/notification-policy.ts');
  const { POKE_DISPLAY } = await import('../apps/extension/src/domain/annotations/social.ts');
  const now = 10_000_000;
  const state = (notifications, muted = false, at = now) => ({
    authenticated: true, account: { id: 'me' }, preferences: { notifications, notificationPreview: false },
    remoteTeams: [{ id: 't', joined: true, preferences: { muted } }],
    pokes: [{ id: 'p', teamId: 't', from: 'robin', view: { url: 'https://x.com' }, at, count: 1 }],
  });
  const identity = { accountId: 'me', teamId: 't', pokeId: 'p', preview: false };
  assert.ok(pokeNotificationTarget(state('all'), identity, now));
  assert.ok(pokeNotificationTarget(state('mentions'), identity, now));
  assert.equal(pokeNotificationTarget(state('off'), identity, now), undefined);
  assert.equal(pokeNotificationTarget(state('all', true), identity, now), undefined);
  assert.equal(pokeNotificationTarget(state('all', false, now - POKE_DISPLAY), identity, now), undefined);
  assert.equal(pokeNotificationTarget(state('all'), { ...identity, pokeId: 'other' }, now), undefined);
});
