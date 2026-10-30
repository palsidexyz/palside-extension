import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyItems, teamEventContent, readTeamEvent, STICKY_EVENT } from '../apps/extension/src/domain/annotations/social.ts';
import { mergePoke, pruneTeamItems, upsertTeamItem } from '../apps/extension/src/runtime/annotations/team-items.ts';

import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
const { sessionScope } = await import('../apps/extension/src/runtime/account/session.ts');
const { resolveStickies } = await import('../apps/extension/src/domain/annotations/social.ts');
hooks.deregister();

test('team item helpers upsert and prune', () => {
  const item = { id: '1', teamId: 't', author: 'a', asset: 'Ethereum:0x1', timestamp: 1, expiresAt: 100, text: 'x' };
  let items = upsertTeamItem(emptyItems(), item);
  assert.equal(items.stickies.length, 1);
  assert.equal(pruneTeamItems(items, 101, id => id === 't').stickies.length, 0);
});

test('poke merge groups sender and view', () => {
  const view = { version: 1, id: 'a', kind: 'asset', chain: 'Ethereum', address: '0x1', url: 'https://x.test/a', name: 'A', source: 'x.test', color: '#fff', glyph: 'A' };
  const first = { id: '1', teamId: 't', from: 'a', view, at: 10, count: 1 };
  const merged = mergePoke([first], { ...first, id: '2', at: 20 }, 20);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 2);
});

test('sticky event content round trips without leaking unrelated payload fields', () => {
  const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
  const content = teamEventContent(asset, { text: 'hello', site: 'gmgn.ai' });
  assert.deepEqual(readTeamEvent(STICKY_EVENT, content), { kind: 'sticky', asset, text: 'hello', site: 'gmgn.ai' });
  assert.equal('value' in content, false);
});

const poolUrl = 'https://dexscreener.com/solana/So11111111111111111111111111111111111111112';
const assetView = (url = poolUrl) => ({ version: 1, id: 'Solana:So11111111111111111111111111111111111111112', kind: 'asset', chain: 'Solana', address: 'So11111111111111111111111111111111111111112', url, name: 'SOL', source: 'DEX Screener', color: '#fff', glyph: 'S' });
const refPayload = { teamId: 'team', target: { kind: 'quote', exact: 'quoted', prefix: '', suffix: '' }, caption: 'quoted', url: poolUrl };
function referenceFixture(views, prepareView) {
  const writes = [];
  const runtime = {
    initialise: async () => {}, emit() {},
    auth: { session: { account: { id: 'self' } }, scope: () => sessionScope(() => true, () => Error('changed')) },
    state: { remoteTeams: [{ id: 'team', joined: true }], drafts: {}, data: { views, messages: [] } },
    sharing: { prepareView },
    storage: { async updateDraft(account, team, patch, revision, empty) {
      writes.push({ account, team, patch, revision });
      return { value: { ...empty, ...patch }, revision: revision + 1, updatedAt: 1 };
    } },
  };
  const commands = new RuntimeCommands(runtime);
  return { runtime, writes, attach: (payload = refPayload) => commands.execute({ name: 'attach-ref', payload }) };
}
function assertReference(f, result, view) {
  assert.deepEqual(result.value.ref, { target: refPayload.target, caption: refPayload.caption, view });
  assert.deepEqual(f.writes, [{ account: 'self', team: 'team', patch: { ref: result.value.ref }, revision: 0 }]);
  assert.equal(f.runtime.state.drafts.team, result);
}

test('attach-ref accepts a pool page when a matching view is known', async () => {
  const known = assetView();
  const f = referenceFixture([known], async () => assert.fail('A known pool does not need preparation'));
  assertReference(f, await f.attach(), known);
});

test('attach-ref completes a pool reference with the prepared asset', async () => {
  const calls = [];
  const prepared = assetView('https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112');
  const f = referenceFixture([], async url => { calls.push(url); return prepared; });
  assertReference(f, await f.attach(), { ...prepared, url: poolUrl });
  assert.deepEqual(calls, [poolUrl]);
});

test('attach-ref keeps a page reference when a pool page has no confirmed asset', async () => {
  const calls = [];
  const page = { kind: 'website', url: poolUrl, name: 'DEX Screener' };
  const f = referenceFixture([], async url => { calls.push(url); return page; });
  assertReference(f, await f.attach(), page);
  assert.deepEqual(calls, [poolUrl, poolUrl]);
});

test('attach-ref accepts a direct asset page', async () => {
  const url = 'https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112';
  const known = assetView(url);
  const f = referenceFixture([known], async () => assert.fail('A known asset does not need preparation'));
  assertReference(f, await f.attach({ ...refPayload, url }), known);
});

test('sticky edits only apply from the original author', async () => {
  const base = { id: 's', teamId: 'team', author: 'a', asset: 'Ethereum:0x1', text: 'original', timestamp: 1, expiresAt: 100 };
  const edit = { id: 'e', teamId: 'team', author: 'a', asset: base.asset, text: 'edited', edits: 's', baseRevision: 's', timestamp: 2, expiresAt: 100 };
  const bad = { id: 'b', teamId: 'team', author: 'b', asset: base.asset, text: 'bad', edits: 's', baseRevision: 's', timestamp: 3, expiresAt: 100 };
  const result = resolveStickies([base, edit, bad], 10);
  assert.deepEqual(result.map(item => [item.id, item.text]), [['s', 'edited']]);
});

test('sharing, favorites, references and sticky scope use equal public page keys', async () => {
  const { publicShareUrl, pageKey, websiteIdentity } = await import('../packages/shared/src/navigation.ts');
  const { pageScopeUrl, readFavorites } = await import('../apps/extension/src/domain/annotations/interaction.ts');
  for (const tail of ['?ref=alice&x=1', '?referral=a&referrer=b&utm_source=c&x=1#part', '?UTM_campaign=c&REF=a&x=1#/route?ref=meaningful', '?x=1&x=2&order=desc#part']) {
    const url = `https://example.com/article${tail}`;
    const expected = publicShareUrl(url);
    const f = referenceFixture([], async source => ({ kind: 'website', url: websiteIdentity(source, 'page').url }));
    const reference = (await f.attach({ ...refPayload, url })).value.ref.view.url;
    assert.deepEqual([readFavorites({ sites: [], pages: [{ url, title: 'Article' }] }).pages[0].url, reference, pageScopeUrl(url), pageKey(url)], Array(4).fill(expected));
  }
  assert.notEqual(pageScopeUrl('https://example.com/?x=1'), pageScopeUrl('https://example.com/?x=2'));
  assert.notEqual(pageScopeUrl('https://example.com/#one'), pageScopeUrl('https://example.com/#two'));
});
