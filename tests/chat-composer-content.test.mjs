import { productionModules } from './helpers/production-module.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assetView } from '../apps/extension/src/domain/assets/model.ts';
import { canSend } from '../apps/extension/src/domain/chat/model.ts';
import { sharedTokens } from '../apps/extension/src/domain/assets/shared-tokens.ts';
import { publicShareUrl } from '../packages/shared/src/navigation.ts';

// Execute the production declarations while supplying their React/host boundary.
function declaration(file, name) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../apps/extension/src/features/palside/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing production function ${name}`);
  return found.getText(source).replace(/^export /, '');
}
function execute(source, name, context) {
  return vm.runInNewContext(ts.transpileModule(`${source}\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment' } }).outputText, context);
}
const sharedSource = declaration('assets/shared-content.tsx', 'SharedContent');
const plain = value => JSON.parse(JSON.stringify(value));
function sender(live = true) {
  const calls = [];
  const context = {
    disconnected: false, draftConflict: false, canWrite: true, canSend,
    current: 'team', data: { self: 'self' }, team: { memberIds: ['member'] },
    draft: { automaticCard: { url: 'https://a.test', assetId: 'a' }, dismissedUrls: ['https://b.test'], text: '  hello @Member @Out  ', attachment: { kind: 'image', src: 'blob:image' }, ref: { caption: 'quote' }, replyTo: 'parent', mentions: [{ id: 'member', label: 'Member' }, { id: 'outsider', label: 'Out' }, { id: 'member', label: 'Absent' }] },
    crypto: { randomUUID: () => 'message-id' }, Date: { now: () => 1234 },
    live: live ? { state: { drafts: { team: { revision: 7 } } } } : undefined,
    draftRevisions: { current: { team: 5 } }, draftQueue: { current: Promise.resolve() }, blockedDrafts: { current: new Set() },
    uiMessage: key => key, setNotice: value => calls.push(['notice', value]),
    guarded: async (name, payload, retry) => { calls.push([name, payload, retry]); return { eventId: 'event' }; },
    setMessages: update => calls.push(['messages', update([{ id: 'existing' }])]),
    setDrafts: update => calls.push(['drafts', update({ team: { text: 'old' }, other: { text: 'keep' } })]),
    emptyDraft: { text: '' }, pending: { current: new Set() }, mounted: { current: true }, deliver: async message => { calls.push(['deliver', message]); },
  };
  const load = productionModules({ crypto: context.crypto, Date: context.Date, message: key => key });
  const createActions = live ? load('apps/extension/src/features/palside/chat/live-actions.ts').createLiveDraftActions : load('apps/extension/src/features/palside/chat/memory-actions.ts').createMemoryDraftActions;
  return { context, calls, send: (...args) => createActions({ ...context, view: context }, () => context).send(...args) };
}
const expectedMessage = { id: 'message-id', teamId: 'team', author: 'self', text: 'hello @Member @Out', time: '', timestamp: 1234, attachment: { kind: 'image', src: 'blob:image' }, ref: { caption: 'quote' }, replyTo: 'parent', mentionIds: ['member'], status: 'sending' };

test('send uses the same message fields in live and preview and preserves preview drafts for other teams', async () => {
  for (const live of [true, false]) {
    const { send, calls } = sender(live);
    // The chat measures the composer for the send flight before anything is written or the draft clears.
    const prepared = [];
    assert.equal(await send(message => prepared.push([plain(message), calls.length])), true);
    assert.deepEqual(prepared, [[expectedMessage, 0]]);
    if (live) {
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'send');
      assert.deepEqual(plain(calls[0][1]), { message: expectedMessage, revision: 7 });
      assert.equal(typeof calls[0][2], 'function');
    } else {
      assert.deepEqual(plain(calls.slice(0, 2)), [['messages', [{ id: 'existing' }, expectedMessage]], ['drafts', { team: { text: '' }, other: { text: 'keep' } }]]);
      assert.deepEqual(plain(calls.find(call => call[0] === 'deliver')), ['deliver', expectedMessage]);
      assert.deepEqual(calls.map(call => call[0]), ['messages', 'drafts', 'messages', 'deliver', 'messages']);
    }
  }
});

test('send snapshots content and revision before waiting and checks newly blocked drafts after the queue', async () => {
  for (const blocked of [false, true]) {
    const { context, calls, send } = sender();
    let release;
    context.draftQueue.current = new Promise(resolve => { release = resolve; });
    const pending = send();
    assert.deepEqual(calls, []);
    context.draft = { text: 'new text' };
    context.live.state.drafts.team.revision = 99;
    context.draftRevisions.current.team = 100;
    if (blocked) context.blockedDrafts.current.add('team');
    release();
    assert.equal(await pending, !blocked);
    if (blocked) assert.deepEqual(calls, [['notice', 'extension.copy.chooseDraftFirst']]);
    else assert.deepEqual(plain(calls[0][1]), { message: expectedMessage, revision: 7 });
  }
});

test('send guards, revision maximum, failure results and queue rejection retain their contracts', async () => {
  for (const live of [true, false]) {
    for (const patch of [{ disconnected: true }, { draftConflict: true }, { canWrite: false }, { draft: { text: '  ' } }, { draft: { text: 'x'.repeat(4001) } }]) {
      const { context, calls, send } = sender(live);
      Object.assign(context, patch);
      assert.equal(await send(), false);
      assert.deepEqual(calls, patch.draftConflict ? [['notice', 'extension.copy.chooseDraftFirst']] : []);
    }
  }
  for (const result of [undefined, {}, { eventId: '' }, { eventId: 'ok' }]) {
    const { context, send } = sender();
    context.draftRevisions.current.team = 10;
    context.guarded = async (_, payload) => { assert.equal(payload.revision, 10); return result; };
    assert.equal(await send(), Boolean(result?.eventId));
  }
  const preview = sender(false);
  preview.context.deliver = async () => { throw new Error('delivery failed'); };
  assert.equal(await preview.send(), false);
  const rejected = sender();
  rejected.context.draftQueue.current = Promise.reject(new Error('queue failed'));
  await assert.rejects(rejected.send(), /queue failed/);
  assert.deepEqual(rejected.calls, []);
});

function renderer() {
  let order = 'recent';
  const calls = { tokens: 0, urls: 0, views: 0 };
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(value => value !== false && value != null) });
  const component = execute(sharedSource, 'SharedContent', {
    h, Fragment: 'Fragment', useTranslations: () => key => key, useId: () => 'tabs', useState: () => [order, value => { order = value; }],
    s: new Proxy({}, { get: (_, key) => key }), Tabs: 'Tabs', HistoryMore: 'HistoryMore', EmptyState: 'EmptyState', Coins: 'Coins', ImageIcon: 'ImageIcon', AssetCard: 'AssetCard', Button: 'Button', MessageImage: 'MessageImage', ArrowUpRight: 'ArrowUpRight', Link2: 'Link2',
    sharedTokens: input => { calls.tokens++; return sharedTokens(input); },
    publicShareUrl: value => { calls.urls++; return publicShareUrl(value); },
    assetView: value => { calls.views++; return assetView(value); },
  });
  const jumps = [];
  return { calls, jumps, render: c => component({ c, onJump: id => jumps.push(id) }) };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, predicate))];
}
const message = (id, patch = {}) => ({ id, teamId: 'team', author: 'friend', text: '', status: 'sent', time: '12:00', timestamp: 10, ...patch });
const token = { id: 'token', kind: 'asset', chain: 'Ethereum', address: `0x${'a'.repeat(40)}`, name: 'Token', url: 'https://example.com/token' };
const card = view => ({ kind: 'asset', assetId: view.id, view });
function controller(messages) {
  return { current: 'team', currentMessages: messages, sharedCategory: 'assets', now: 100, people: [{ id: 'friend', name: 'Friend' }], setSharedCategory(value) { this.sharedCategory = value; }, copy() {}, selectAsset() {}, live: { state: { items: { stances: [] } } } };
}

test('shared categories render current data, attribution and text-before-attachment URL priority', () => {
  const c = controller([
    message('text-old', { text: 'https://example.com/same https://example.com/old', timestamp: 1 }),
    message('asset', { attachment: card(token), timestamp: 2 }),
    message('image', { attachment: { kind: 'image', src: 'blob:image' }, timestamp: 3 }),
    message('web-new', { attachment: card({ id: 'web', kind: 'website', url: 'https://example.com/same' }), timestamp: 4 }),
    message('text-new', { text: 'https://example.com/old', timestamp: 5 }),
    message('recalled', { text: 'https://example.com/recalled', recalled: true }),
    message('pending', { text: 'https://example.com/pending', status: 'sending' }),
  ]);
  const r = renderer();
  let tree = r.render(c);
  assert.deepEqual(nodes(tree, n => n.type === 'AssetCard').map(n => n.props.view.id), ['token']);
  assert.deepEqual(r.calls, { tokens: 1, urls: 0, views: 0 });
  c.sharedCategory = 'images';
  tree = r.render(c);
  assert.deepEqual(nodes(tree, n => n.type === 'MessageImage').map(n => n.props.id), ['image']);
  assert.deepEqual(r.calls, { tokens: 1, urls: 0, views: 0 });
  c.sharedCategory = 'links';
  tree = r.render(c);
  assert.deepEqual(nodes(tree, n => n.type === 'a').map(n => n.props.href), ['https://example.com/old', 'https://example.com/same']);
  const attributions = nodes(tree, n => n.props.className === 'sharedAttribution');
  assert.equal(attributions.length, 2);
  for (const attribution of attributions) {
    assert.equal(nodes(attribution, n => n.type === 'small')[0].children[0], 'Friend · 12:00');
    nodes(attribution, n => n.type === 'Button')[0].props.onClick();
  }
  assert.deepEqual(r.jumps, ['text-new', 'text-old']);
  assert.equal(r.calls.tokens, 1);
  c.currentMessages = [message('fresh', { attachment: { kind: 'image', src: 'blob:fresh' } })];
  c.sharedCategory = 'images';
  assert.deepEqual(nodes(r.render(c), n => n.type === 'MessageImage').map(n => n.props.id), ['fresh']);
  c.currentMessages = [];
  assert.equal(nodes(r.render(c), n => n.type === 'EmptyState')[0].props.title, 'extension.dynamic.noImages');
  c.sharedCategory = 'assets';
  assert.equal(nodes(r.render(c), n => n.type === 'EmptyState')[0].props.title, 'extension.dynamic.noTokens');
  c.sharedCategory = 'links';
  assert.equal(nodes(r.render(c), n => n.type === 'EmptyState')[0].props.title, 'extension.dynamic.noLinks');
});

test('shared token order survives category switches while newest messages and attribution are recomputed', () => {
  const other = { ...token, id: 'other', address: `0x${'b'.repeat(40)}` };
  const c = controller([message('a1', { attachment: card(token), timestamp: 1 }), message('a2', { attachment: card(token), timestamp: 2 }), message('b', { attachment: card(other), timestamp: 3 })]);
  const r = renderer();
  let tree = r.render(c);
  const ids = value => nodes(value, n => n.type === 'AssetCard').map(n => n.props.view.id);
  assert.deepEqual(ids(tree), ['other', 'token']);
  nodes(tree, n => n.type === 'button' && n.children.includes('extension.sharedTokens.discussed'))[0].props.onClick();
  assert.deepEqual(ids(r.render(c)), ['token', 'other']);
  c.sharedCategory = 'links';
  r.render(c);
  c.currentMessages = [message('new-b', { attachment: card(other), author: 'unknown', timestamp: 4, time: '' })];
  c.sharedCategory = 'assets';
  tree = r.render(c);
  assert.deepEqual(ids(tree), ['other']);
  assert.equal(nodes(tree, n => n.type === 'button' && n.children.includes('extension.sharedTokens.discussed'))[0].props['aria-pressed'], true);
  assert.equal(nodes(tree, n => n.type === 'small')[0].children[0], 'extension.copy.teamMembers');
  nodes(tree, n => n.type === 'Button' && n.children.includes('extension.copy.viewMessage'))[0].props.onClick();
  assert.deepEqual(r.jumps, ['new-b']);
});
