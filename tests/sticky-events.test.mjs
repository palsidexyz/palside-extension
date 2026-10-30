import test from 'node:test';
import assert from 'node:assert/strict';
import { STICKY_EVENT, emptyItems, readRefTarget, readMessageRefTarget, readTeamEvent, teamEventContent } from '../apps/extension/src/domain/annotations/social.ts';
import { pruneTeamItems, upsertTeamItem } from '../apps/extension/src/runtime/annotations/team-items.ts';
const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
const target = { kind: 'region', selector: 'canvas', x: 0.25, y: 0.75 };
test('reference wire parsers reject unproduced variants and preserve quote, address and danmaku', () => {
  for (const value of [{ kind: 'row', key: 'trade' }, { kind: 'field', name: 'price' }, target]) {
    assert.equal(readRefTarget(value), undefined);
    assert.equal(readMessageRefTarget(value), undefined);
  }
  for (const value of [{ kind: 'address', text: '0x1111111111111111111111111111111111111111' }, { kind: 'quote', exact: 'Public text', prefix: '', suffix: '' }]) {
    assert.deepEqual(readRefTarget(value), value);
    assert.deepEqual(readMessageRefTarget(value), value);
  }
  const danmaku = { kind: 'danmaku', id: 'line', author: 'alice', name: 'Alice', at: 1 };
  assert.deepEqual(readMessageRefTarget(danmaku), danmaku);
  assert.equal(readRefTarget(danmaku), undefined);
});
test('persistent marks reject a chart coordinate instead of silently changing its meaning', () => { const content = teamEventContent(asset, { url: 'https://gmgn.ai/token', site: 'gmgn.ai', target, text: 'Watch' }); assert.equal(readTeamEvent(STICKY_EVENT, content), undefined); assert.deepEqual(readTeamEvent(STICKY_EVENT, teamEventContent(asset, { text: 'Watch' })), { kind: 'sticky', asset, text: 'Watch' }); });
test('sticky expiry is pruned', () => { let items = emptyItems(); items = upsertTeamItem(items, { id: 's', teamId: 'team', author: 'me', asset, text: 'x', timestamp: 1, expiresAt: 10 }); assert.equal(pruneTeamItems(items, 10).stickies.length, 0); });
