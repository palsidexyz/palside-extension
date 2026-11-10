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
