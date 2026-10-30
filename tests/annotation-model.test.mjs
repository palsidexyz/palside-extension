import test from 'node:test';
import assert from 'node:assert/strict';
import { STICKY_EVENT, readTeamEvent, teamEventContent, visibleStickies, stickyTargetKey } from '../apps/extension/src/domain/annotations/social.ts';

import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { TeamInteractions } = await import('../apps/extension/src/runtime/annotations/interactions.ts');
const { resolveStickies } = await import('../apps/extension/src/domain/annotations/social.ts');
hooks.deregister();

const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
const target = { kind: 'quote', exact: 'A useful public sentence', prefix: 'Read ', suffix: ' here' };
const base = { id: '$root', teamId: 'team', author: 'alice', asset, url: 'https://example.com/article?q=one', site: 'example.com', target, text: '', timestamp: 1, expiresAt: 100 };
const edit = (id, baseRevision, text) => ({ ...base, id, edits: base.id, baseRevision, text, timestamp: 10 });

test('a public quote is a persistent mark with or without an asset or comment', () => {
  for (const scope of [asset, undefined]) {
    const content = teamEventContent(scope, { ...base, text: '' });
    const mark = readTeamEvent(STICKY_EVENT, content);
    assert.equal(mark.text, ''); assert.equal(mark.asset, scope); assert.deepEqual(mark.target, target);
    assert.equal(mark.url, base.url);
  }
});

test('persistent marks require public exact sources and cannot hide unsupported target types', () => {
  for (const patch of [{ url: 'http://localhost/private' }, { site: 'other.example' }, { target: { kind: 'region', selector: 'canvas', x: .5, y: .5 } }, { target: { kind: 'address', text: '0x1111111111111111111111111111111111111111' } }, { target: undefined, text: '' }]) {
    assert.equal(readTeamEvent(STICKY_EVENT, teamEventContent(asset, { ...base, ...patch })), undefined);
  }
  assert.equal(readTeamEvent(STICKY_EVENT, teamEventContent(undefined, { text: 'No source' })), undefined);
  assert.equal(readTeamEvent(STICKY_EVENT, teamEventContent(asset, { text: 'Whole asset note' })).text, 'Whole asset note');
});

test('source scope preserves query and hash while asset lists aggregate all sources', () => {
  const otherPage = { ...base, id: '$other', url: 'https://example.com/article?q=two' };
  const items = { stickies: [base, otherPage] };
  assert.equal(visibleStickies(items, 'team', asset, 5).length, 2);
  assert.deepEqual(visibleStickies(items, 'team', { asset, url: base.url }, 5).map(item => item.id), ['$root']);
  assert.equal(visibleStickies(items, 'other-team', { url: base.url }, 5).length, 0);
  assert.equal(visibleStickies(items, 'team', { url: `${base.url}#different` }, 5).length, 0);
  assert.equal(stickyTargetKey(base), stickyTargetKey({ ...base, url: `${base.url}&utm_source=test` }));
  assert.notEqual(stickyTargetKey(base), stickyTargetKey(otherPage));
});

test('edit base revisions select a deterministic branch independent of delivery order', () => {
  const a = edit('$a', '$root', 'branch A'), b = edit('$b', '$root', 'branch B');
  const a2 = edit('$a2', '$a', 'A revision 2'), b2 = edit('$b2', '$b', 'B revision 2');
  const spoof = { ...edit('$0', '$root', 'spoof'), author: 'bob' };
  for (const records of [[base, a, b, a2, b2, spoof], [b2, b, spoof, a2, a, base], [a2, b2, base, b, a]]) {
    const [value] = resolveStickies(records, 20);
    assert.equal(value.id, '$root'); assert.equal(value.revision, '$a2'); assert.equal(value.text, 'A revision 2'); assert.equal(value.conflicted, undefined);
    const [conflict] = resolveStickies([base, a, b], 20);
    assert.equal(conflict.conflicted, true);
  }
});

test('orphaned, changed-source and missing-base edits cannot overwrite or resurrect a mark', () => {
  const patches = [edit('$orphan', '$unknown', 'orphan'), { ...edit('$source', '$root', 'source'), url: 'https://example.com/elsewhere' }, { ...edit('$bad', '$root', 'bad'), baseRevision: undefined }];
  assert.equal(resolveStickies([base, ...patches], 20)[0].text, '');
  assert.deepEqual(resolveStickies(patches, 20), []);
  assert.deepEqual(resolveStickies([base, edit('$late', '$root', 'late')], 100), []);
  assert.equal(readTeamEvent(STICKY_EVENT, teamEventContent(asset, { ...base, edits: '$root', text: 'no base' })), undefined);
});

test('UI and page projection retain the resolved entity without selecting revisions again', async () => {
  const { pageStickies } = await import('../apps/extension/src/runtime/browser/page-layer-host.ts');
  const resolved = { ...base, revision: '$a', text: 'resolved', conflicted: true };
  const state = { authenticated: true, preferences: { current: 'team', hiddenStickies: [] }, remoteTeams: [{ id: 'team', joined: true }], items: { stickies: [resolved] } };
  assert.equal(visibleStickies(state.items, 'team', { url: base.url }, 20)[0], resolved);
  assert.equal(pageStickies({ url: base.url }, state, 20)[0], resolved);
});

test('offscreen, UI and page projection share concurrent edit, deletion and team-scope vectors', async t => {
  const { pageStickies } = await import('../apps/extension/src/runtime/browser/page-layer-host.ts');
  t.mock.method(Date, 'now', () => 20);
  const a = edit('$a', '$root', 'A'), b = edit('$b', '$root', 'B');
  const denied = [{ ...edit('$0', '$root', 'wrong author'), author: 'bob' }, { ...edit('$1', '$root', 'wrong team'), teamId: 'elsewhere' }, { ...edit('$2', '$root', 'wrong target'), target: { ...target, exact: 'different sentence' } }];
  const vectors = [
    { records: [base, b, a, ...denied], expected: [['$root', '$a', 'A', true]] },
    { records: [a, ...denied, b, base, edit('$a2', '$a', 'A2')], expected: [['$root', '$a2', 'A2', undefined]] },
    { records: [base, a, b], deletion: { id: '$root', status: 'pending' }, expected: [['$root', '$a', 'A', true]] },
    { records: [base, a, b], deletion: { id: '$root', status: 'committed' }, expected: [] },
    { records: [base, a, b], deletion: { id: '$a', status: 'committed' }, expected: [['$root', '$b', 'B', undefined]] },
    { records: [a, b], expected: [] },
    { records: [{ ...base, expiresAt: 20 }, a, b], expected: [] },
  ];
  for (const vector of vectors) {
    const state = { authenticated: true, preferences: { current: 'team', hiddenStickies: [] }, remoteTeams: [{ id: 'team', joined: true }], items: { stickies: [] } };
    const interactions = new TeamInteractions({ state });
    interactions.stickyRecords = vector.records;
    if (vector.deletion) interactions.annotationDeletions.set(vector.deletion.id, { teamId: 'team', expiresAt: 100, ...vector.deletion });
    interactions.refreshStickies();
    for (const values of [state.items.stickies, visibleStickies(state.items, 'team', { url: base.url }, 20), pageStickies({ url: base.url }, state, 20)]) {
      assert.deepEqual(values.map(item => [item.id, item.revision, item.text, item.conflicted]), vector.expected);
      for (const item of values) assert.equal(item, state.items.stickies.find(value => value.id === item.id));
    }
    assert.deepEqual(visibleStickies(state.items, 'elsewhere', { url: base.url }, 20), []);
    state.preferences.hiddenStickies = ['$root'];
    assert.deepEqual(pageStickies({ url: base.url }, state, 20), []);
    state.remoteTeams[0].joined = false;
    assert.deepEqual(pageStickies({ url: base.url }, state, 20), []);
  }
});


test('sticky conflicts and equal timestamps use code-unit event ordering', () => {
  const upper = edit('$I', '$root', 'upper'), lower = edit('$i', '$root', 'lower');
  for (const branches of [[upper, lower], [lower, upper]]) {
    assert.equal(resolveStickies([base, ...branches], 20)[0].revision, '$I');
  }
  const originals = [{ ...base, id: '$I' }, { ...base, id: '$i' }];
  for (const records of [originals, [...originals].reverse()]) {
    assert.deepEqual(resolveStickies(records, 20).map(item => item.id), ['$i', '$I']);
  }
});
