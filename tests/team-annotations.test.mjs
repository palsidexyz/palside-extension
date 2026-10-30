import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import { productionModules } from './helpers/production-module.mjs';
import { endpointsById } from '../packages/shared/src/contracts/endpoints.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as social from '../apps/extension/src/domain/annotations/social.ts';
import { pruneTeamItems, upsertTeamItem } from '../apps/extension/src/runtime/annotations/team-items.ts';
import { messageExpiry } from '../apps/extension/src/runtime/chat/message-expiry.ts';
import { commandError } from '../apps/extension/src/runtime/composition/commands.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { readView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { retainedViews } from '../apps/extension/src/runtime/viewing/view-retention.ts';
import { characterLength, emptyDraft, readQuoteRange } from '../apps/extension/src/domain/chat/model.ts';
import { clearCache } from '../apps/extension/src/runtime/media/local-data.ts';
import { requireEncryptedSend, teamSendGuard } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { installEncryptedRoom } from './helpers/encrypted-room.mjs';

const asset = 'Ethereum:0x1111111111111111111111111111111111111111';
const day = 86_400_000;
const url = 'https://docs.example.com/guide?version=2#/install';
const target = { kind: 'quote', exact: 'Public text', prefix: '', suffix: '' };
const plain = value => JSON.parse(JSON.stringify(value));

function serviceClass(file, name, globals = {}) {
  const context = { requireEncryptedSend, teamSendGuard, ...languageGlobals, ...social, readView, retainedViews, characterLength, emptyDraft, readQuoteRange, clearCache, Blob, messageExpiry, pruneTeamItems, upsertTeamItem, commandError, text: value => typeof value === 'string' ? value : '', DAY: day, Date, Intl, URL, crypto, setTimeout, clearTimeout, ...globals };
  const paths = { interactions: 'annotations/interactions', timeline: 'chat/timeline', cache: 'media/cache', dispatch: 'composition/dispatch' };
  return productionModules(context)(`apps/extension/src/runtime/${paths[file]}.ts`)[name];
}

const TeamInteractions = serviceClass('interactions', 'TeamInteractions');
const TimelineRuntime = serviceClass('timeline', 'TimelineRuntime');
const LocalDataRuntime = serviceClass('cache', 'LocalDataRuntime');
const RuntimeCommands = serviceClass('dispatch', 'RuntimeCommands');

function fixture(timelineGlobals) {
  const writes = new Map(); const sent = []; const removed = [];
  const session = { account: { id: 'alice' } };
  const team = id => ({ id, roomId: `!${id}:example.com`, joined: true, retentionDays: 2, memberIds: ['alice', 'bob'], people: [{ id: 'alice', matrixId: '@alice:example.com' }, { id: 'bob', matrixId: '@bob:example.com' }], periods: [{ joinedAt: 0, leftAt: null }] });
  const runtime = {
    state: { items: social.emptyItems(), remoteTeams: [team('one'), team('two')], data: { self: 'alice', pendingInvite: undefined, teams: [], people: [], messages: [], views: [] }, drafts: {} },
    auth: { session, directoryExpiresAt: 0, scope: () => ({ check() {}, current: () => true, wait: promise => promise }), requireConnection() {}, client: { sendEvent: async (room, type, content) => { sent.push({ room, type, content }); return { event_id: `$${sent.length}` }; } } },
    storage: { put: async () => {}, get: async key => writes.get(key.replace('alice:cache:', ''))?.value, cache: async (account, id, value, expiresAt) => { writes.set(id, value instanceof Blob ? { account, value, expiresAt } : plain({ account, value, expiresAt })); return []; }, remove: async key => { removed.push(key); writes.delete(key.replace('alice:cache:', '')); }, cleanup: async () => {} },
    sending: { outgoing: new Map(), inFlight: new Set() },
    sharing: { peerViewing: new Map() },
    rooms: { async clearLocal() {} },
    emit() {},
  };
  installEncryptedRoom(runtime.auth.client);
  runtime.interactions = new TeamInteractions(runtime);
  runtime.timeline = new (timelineGlobals ? serviceClass('timeline', 'TimelineRuntime', timelineGlobals) : TimelineRuntime)(runtime);
  runtime.cache = new LocalDataRuntime(runtime);
  runtime.cache.pruneViews = () => false;
  return { runtime, writes, sent, removed };
}

function event(type, content, { id = '$incoming', team = 'one', timestamp = Date.now(), expiresAt, sender = '@bob:example.com', redacted = false } = {}) {
  return { status: undefined, getType: () => type, getContent: () => content, getRoomId: () => `!${team}:example.com`, getId: () => id, getTs: () => timestamp, getUnsigned: () => ({ 'xyz.palside.expires_at': expiresAt }), getSender: () => sender, isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false, isRedaction: () => false, isRedacted: () => redacted };
}

test('webpage scope preserves semantic query and hash while removing explicit tracking', () => {
  assert.equal(social.pageScopeUrl('https://DOCS.example.com:443/guide?version=2&ref=chapter&utm_source=x&fbclid=y&gclid=z#/install'), 'https://docs.example.com/guide?version=2#/install');
  for (const input of ['file:///guide', 'https://localhost/guide', 'https://192.168.1.2/guide', 'https://user:pass@example.com/guide', 'https://example.com/?session=secret', 'https://example.com/#/login?access_token=secret', undefined]) assert.equal(social.pageScopeUrl(input), undefined);
  assert.equal(social.stickyScopeMatches({ url }, { url: `${url}/other` }), false);
  assert.equal(social.stickyScopeMatches({ url }, { url: 'https://docs.example.com/guide?version=3#/install' }), false);
  assert.equal(social.stickyScopeMatches({ url }, { url: 'https://docs.example.com/guide?version=2&utm_medium=test#/install' }), true);
  assert.equal(social.stickyScopeMatches({}, {}), false);
});

test('stickies match assets across websites and preserve explicit webpage scope', () => {
  assert.equal(social.stickyScopeMatches({ asset, url }, asset), true);
  assert.equal(social.stickyScopeMatches({ asset, url }, { asset }), true);
  assert.equal(social.stickyScopeMatches({ asset, url }, { asset, url: 'https://other.example.com/token' }), false);
  assert.equal(social.stickyScopeMatches({ asset, url }, { url }), true);
  assert.equal(social.stickyScopeMatches({ url }, { asset, url }), false);
  const content = social.teamEventContent(asset, { text: 'same token', site: 'gmgn.ai', url });
  assert.equal(content.url, url);
  assert.deepEqual(social.readTeamEvent(social.STICKY_EVENT, content), { kind: 'sticky', asset, url, text: 'same token', site: 'gmgn.ai' });
});

test('webpage events require a public scope and matching site; unsupported event types are ignored', () => {
  const content = social.teamEventContent(undefined, { target, text: 'hello', site: 'docs.example.com', url });
  assert.deepEqual(social.readTeamEvent(social.STICKY_EVENT, content), { kind: 'sticky', url, target, text: 'hello', site: 'docs.example.com' });
  for (const invalid of [{ ...content, url: undefined }, { ...content, site: 'other.example.com' }, { ...content, asset: { chain: 'Ethereum', address: 'invalid' } }]) assert.equal(social.readTeamEvent(social.STICKY_EVENT, invalid), undefined);
  for (const type of ['com.palside.unknown', 'unknown-event', '', 42]) assert.equal(social.readTeamEvent(type, { asset: { chain: 'Ethereum', address: asset.split(':')[1] }, text: 'unsupported' }), undefined);
  assert.deepEqual(Object.keys(social.emptyItems()).sort(), ['stickies']);
});

test('runtime sends webpage stickies encrypted as a team event and persists URL scope', async () => {
  const { runtime, sent, writes } = fixture();
  await runtime.interactions.teamEvent('two', 'sticky', { target, url: 'https://docs.example.com/guide?version=2&utm_source=x#/install', site: 'docs.example.com', text: 'look here' });
  assert.equal(sent[0].room, '!two:example.com');
  assert.equal(sent[0].type, social.STICKY_EVENT);
  assert.equal(sent[0].content.url, url);
  const item = runtime.state.items.stickies[0];
  assert.equal(item.url, url);
  assert.equal(item.asset, undefined);
  assert.equal(item.teamId, 'two');
  assert.equal(item.expiresAt, item.timestamp + 2 * day);
  assert.equal(writes.get('item:$1').value.item.url, url);
  await assert.rejects(runtime.interactions.teamEvent('absent', 'sticky', { target, url, site: 'docs.example.com', text: 'no' }));
  await assert.rejects(runtime.interactions.teamEvent('one', 'unknown-kind', { asset, text: 'unsupported' }));
  assert.equal(sent.length, 1);
});

test('team-event commands accept stickies and reject unsupported event kinds before sending', async () => {
  const { runtime, sent, writes } = fixture();
  runtime.initialise = async () => {};
  const dispatch = new RuntimeCommands(runtime);
  for (const kind of ['danmaku', 'unknown-kind', '']) {
    await assert.rejects(dispatch.execute({ name: 'team-event', payload: { teamId: 'one', kind, asset, text: 'unsupported' } }));
    await assert.rejects(runtime.interactions.teamEvent('one', kind, { asset, text: 'unsupported' }));
  }
  assert.equal(sent.length, 0);
  assert.equal(writes.size, 0);
  const result = await dispatch.execute({ name: 'team-event', payload: { teamId: 'one', kind: 'sticky', asset, text: 'saved' } });
  assert.equal(result.id, '$1');
  assert.equal(sent[0].type, social.STICKY_EVENT);
  assert.equal(runtime.state.items.stickies[0].text, 'saved');
  assert.equal(writes.get('item:$1').value.kind, 'stickies');
});

test('received URL events stay separated by team, honor membership and expiry, and survive in cache', async () => {
  const { runtime, writes } = fixture();
  const content = social.teamEventContent(undefined, { target, url, site: 'docs.example.com', text: 'received' });
  await runtime.timeline.consume(event(social.STICKY_EVENT, content, { id: '$one' }), true);
  await runtime.timeline.consume(event(social.STICKY_EVENT, content, { id: '$two', team: 'two' }));
  await runtime.timeline.consume(event(social.STICKY_EVENT, content, { id: '$expired', timestamp: Date.now() - 3 * day }));
  await runtime.timeline.consume(event(social.STICKY_EVENT, content, { id: '$outsider', sender: '@outside:example.com' }));
  await runtime.timeline.consume(event(social.STICKY_EVENT, content, { id: '$removed', redacted: true }));
  assert.deepEqual(plain(runtime.state.items.stickies.map(item => [item.id, item.teamId, item.url]).sort(([a], [b]) => a.localeCompare(b))), [['$one', 'one', url], ['$two', 'two', url]]);
  assert.equal(writes.get('item:$two').value.item.url, url);
  const readable = pruneTeamItems(runtime.state.items, Date.now(), id => id === 'two');
  assert.deepEqual(plain(readable.stickies.map(item => item.id)), ['$two']);
});

test('shortening retention removes webpage stickies from memory and durable cache', async () => {
  const { runtime, removed } = fixture();
  const timestamp = Date.now() - 3 * day;
  runtime.interactions.upsertSticky({ target, id: '$stale', teamId: 'one', author: 'bob', url, site: 'docs.example.com', text: 'old', timestamp, expiresAt: timestamp + 7 * day });
  await runtime.cache.expireLocalContent();
  assert.equal(runtime.state.items.stickies.length, 0);
  assert.ok(removed.includes('alice:cache:item:$stale'));
});

test('cold-start social cache survives unknown membership but expires and is removed after confirmed revocation', async () => {
  const { runtime, writes, removed } = fixture();
  const now = Date.now();
  const base = { teamId: 'one', author: 'alice', timestamp: now, expiresAt: now + day, url, target, site: 'docs.example.com', text: 'cached' };
  runtime.state.remoteTeams = [];
  runtime.auth.snapshotAt = 0;
  runtime.interactions.upsertSticky({ ...base, id: '$sticky' });
  runtime.interactions.upsertSticky({ ...base, id: '$expired', timestamp: now - 2 * day, expiresAt: now - 1 });
  await runtime.cache.expireLocalContent();
  assert.deepEqual(plain(runtime.interactions.stickyRecords.map(item => item.id)), ['$sticky']);
  assert.equal(runtime.state.items.stickies.length, 1);
  assert.ok(!writes.has('item:$sticky'), 'maintenance must not recreate cached content');
  assert.ok(removed.includes('alice:cache:item:$expired'));
  assert.ok(!removed.includes('alice:cache:item:$sticky'));
  await assert.rejects(runtime.interactions.teamEvent('one', 'sticky', { target, url, site: 'docs.example.com', text: 'cannot send from cache' }));

  runtime.auth.snapshotAt = now;
  await runtime.cache.expireLocalContent();
  assert.equal(runtime.interactions.stickyRecords.length, 0);
  assert.equal(runtime.state.items.stickies.length, 0);
  assert.ok(removed.includes('alice:cache:item:$sticky'));
});

test('recall strips quoted content and mentions for live events and historical replay', async () => {
  for (const mode of ['live', 'historical', 'before-original']) {
    const { runtime, writes } = fixture();
    runtime.cache.pruneViews = LocalDataRuntime.prototype.pruneViews;
    const content = { msgtype: 'm.text', body: 'hello', 'm.mentions': { user_ids: ['@alice:example.com'] }, 'm.relates_to': { 'm.in_reply_to': { event_id: '$reply' } }, 'com.palside.reply_range': { start: 1, end: 3, base: 0 }, 'com.palside.ref': { target: { kind: 'quote', exact: 'private quote', prefix: '', suffix: '' }, caption: 'private caption', view: { version: 1, kind: 'website', disclosure: 'page', name: 'source', url } } };
    const original = event('m.room.message', content);
    if (mode === 'live') { await runtime.timeline.consume(original); assert.ok(runtime.state.data.messages[0].ref); assert.deepEqual(plain(runtime.state.data.messages[0].replyRange), { start: 1, end: 3, base: 0 }); }
    if (mode !== 'historical') await runtime.timeline.consume({ ...event('m.room.redaction', { reason: 'author' }, { id: '$redaction' }), isRedaction: () => true, getAssociatedId: () => '$incoming' });
    await runtime.timeline.consume({ ...original, isRedacted: () => mode === 'historical', getRedactionEvent: () => ({ content: { reason: 'author' } }) });
    const message = runtime.state.data.messages[0];
    assert.equal(message.recalled, true);
    for (const field of ['ref', 'attachment', 'replyTo', 'replyRange', 'replyToExpiresAt']) assert.equal(message[field], undefined, `${mode}: ${field}`);
    assert.deepEqual(plain(message.mentionIds), []);
    const cached = writes.get('$incoming').value;
    assert.equal(cached.message.ref, undefined);
    assert.deepEqual(plain(runtime.state.data.views), []);
    assert.deepEqual(cached.views, []);
  }
});

test('edited originals cannot restore stale mentions or supersede a newer cached edit', async () => {
  for (const cachedOnly of [false, true]) {
    const { runtime } = fixture();
    const now = Date.now();
    const original = event('m.room.message', { body: '@alice old', 'm.mentions': { user_ids: ['@alice:example.com'] } }, { timestamp: now });
    await runtime.timeline.consume(original);
    await runtime.timeline.consume(event('m.room.message', { 'm.relates_to': { rel_type: 'm.replace', event_id: '$incoming' }, 'm.new_content': { body: 'edited' } }, { id: '$edit', timestamp: now + 1 }));
    if (cachedOnly) runtime.timeline.edits.clear();
    await runtime.timeline.consume(original);
    assert.equal(runtime.state.data.messages[0].text, 'edited');
    assert.deepEqual(plain(runtime.state.data.messages[0].mentionIds), []);
    runtime.state.data.messages[0].text = 'newest cached'; runtime.state.data.messages[0].editedAt = now + 10;
    await runtime.timeline.consume(original);
    assert.equal(runtime.state.data.messages[0].text, 'newest cached');
  }
});

test('clear-cache preserves reading state and drafts while releasing images and notifying panels', async () => {
  const { runtime, writes } = fixture();
  let emits = 0;
  runtime.emit = () => { emits++; };
  runtime.initialise = async () => {};
  runtime.storage.clearCache = async () => writes.clear();
  runtime.storage.cacheBytes = async () => writes.size;
  runtime.storage.get = async key => writes.get(key.replace('alice:cache:', ''))?.value;
  const image = URL.createObjectURL(new Blob(['image']));
  const owner = URL.createObjectURL(new Blob(['owner']));
  runtime.cache.mediaUrls.set('event:$image', image); runtime.cache.mediaUrls.set('avatar:owner', owner);
  const now = Date.now();
  runtime.state.data.messages.push({ id: '$image', teamId: 'one', text: 'keep', timestamp: now, expiresAt: now + day, attachment: { kind: 'image', src: image } });
  runtime.state.lobbyTeams = [{ id: 'lobby', ownerAvatar: owner }];
  runtime.state.drafts.one = { revision: 1, updatedAt: now, value: { text: 'unsent' } };
  await runtime.timeline.consume(event(social.STICKY_EVENT, social.teamEventContent(undefined, { target, url, site: 'docs.example.com', text: 'keep interaction' })));
  const dispatch = new RuntimeCommands(runtime);
  assert.deepEqual(plain(await dispatch.execute({ name: 'clear-cache' })), { bytes: 0 });
  assert.equal(runtime.state.data.messages[0].text, 'keep');
  assert.equal(runtime.state.data.messages[0].attachment.src, '');
  assert.equal(runtime.state.lobbyTeams[0].ownerAvatar, undefined);
  assert.equal(runtime.state.drafts.one.value.text, 'unsent');
  assert.equal(runtime.cache.mediaUrls.size, 0);
  await assert.rejects(fetch(image)); await assert.rejects(fetch(owner));
  assert.ok(emits > 0);
  await runtime.cache.expireLocalContent(); await runtime.cache.expireLocalContent();
  assert.equal(writes.size, 0);
  assert.equal(runtime.state.items.stickies.length, 1);
});

test('retention maintenance writes only changed existing items and applies media evictions', async () => {
  const { runtime, writes } = fixture();
  const timestamp = Date.now();
  runtime.interactions.upsertSticky({ asset, text: 'cached', id: '$item', teamId: 'one', timestamp, expiresAt: timestamp + 7 * day });
  writes.set('item:$item', { value: {} });
  runtime.storage.get = async key => writes.get(key.replace('alice:cache:', ''))?.value;
  const src = URL.createObjectURL(new Blob(['image']));
  runtime.cache.mediaUrls.set('event:$image', src);
  runtime.state.data.messages.push({ id: '$image', teamId: 'one', timestamp, expiresAt: timestamp + day, attachment: { kind: 'image', src } });
  let calls = 0;
  runtime.storage.cache = async (account, id, value) => { calls++; writes.set(id, { value }); return ['alice:cache:media:event:$image']; };
  await runtime.cache.expireLocalContent();
  assert.equal(calls, 1);
  assert.equal(runtime.state.data.messages[0].attachment.src, '');
  await assert.rejects(fetch(src));
  await runtime.cache.expireLocalContent();
  assert.equal(calls, 1);
});

test('retention maintenance resolves replies after all deadlines, within each team and using the first duplicate', async () => {
  for (const originalsFirst of [false, true]) {
    const { runtime } = fixture();
    runtime.auth.session = undefined;
    const timestamp = Date.now();
    const original = { id: '$original', teamId: 'one', timestamp, expiresAt: timestamp + 7 * day };
    const duplicate = { ...original, expiresAt: timestamp + day };
    const otherTeam = { ...original, teamId: 'two', expiresAt: timestamp + day / 2 };
    const reply = { id: '$reply', teamId: 'one', timestamp, expiresAt: timestamp + 7 * day, replyTo: '$original' };
    const otherReply = { ...reply, id: '$other-reply', teamId: 'two' };
    const missing = { ...reply, id: '$missing', replyTo: '$absent', replyToExpiresAt: timestamp + day / 4 };
    const crossTeam = { ...reply, id: '$cross-team', teamId: 'three', replyToExpiresAt: timestamp + day / 8 };
    const originals = [otherTeam, original, duplicate];
    const replies = [reply, otherReply, missing, crossTeam];
    runtime.state.data.messages = originalsFirst ? [...originals, ...replies] : [...replies, ...originals];
    await runtime.cache.expireLocalContent();
    assert.equal(original.expiresAt, timestamp + 2 * day);
    assert.equal(reply.replyToExpiresAt, timestamp + 2 * day);
    assert.equal(otherReply.replyToExpiresAt, timestamp + day / 2);
    assert.equal(missing.replyToExpiresAt, timestamp + day / 4);
    assert.equal(crossTeam.replyToExpiresAt, timestamp + day / 8);
  }
});

test('shortened messages persist once in first-change order and unchanged maintenance does not emit', async () => {
  const { runtime, writes } = fixture();
  const timestamp = Date.now();
  const replyOnly = { id: '$reply-only', teamId: 'one', timestamp, expiresAt: timestamp + day, replyTo: '$original' };
  const reply = { ...replyOnly, id: '$reply', expiresAt: timestamp + 7 * day };
  const original = { id: '$original', teamId: 'one', timestamp, expiresAt: timestamp + 7 * day };
  runtime.state.data.messages = [replyOnly, reply, original];
  for (const message of runtime.state.data.messages) {
    runtime.cache.eventTimes.set(message.id, timestamp);
    writes.set(message.id, { value: { message } });
  }
  runtime.storage.get = async key => writes.get(key.replace('alice:cache:', ''))?.value;
  const cached = [];
  const cache = runtime.storage.cache;
  runtime.storage.cache = async (...args) => { cached.push(args[1]); return cache(...args); };
  let emits = 0;
  runtime.emit = () => { emits++; };
  await runtime.cache.expireLocalContent();
  assert.deepEqual(cached, ['$reply', '$original', '$reply-only']);
  assert.equal(writes.get('$reply').value.message.replyToExpiresAt, timestamp + 2 * day);
  assert.equal(writes.get('$reply-only').value.message.replyToExpiresAt, timestamp + 2 * day);
  assert.equal(emits, 1);
  await runtime.cache.expireLocalContent();
  assert.deepEqual(cached, ['$reply', '$original', '$reply-only']);
  assert.equal(emits, 1);
});

test('sticky pruning preserves record order and references and emits after cache removals', async () => {
  const { runtime, removed } = fixture();
  const timestamp = Date.now();
  const first = { id: '$first', teamId: 'one', asset, text: 'first', timestamp, expiresAt: timestamp + day };
  const expired = { ...first, id: '$expired', expiresAt: timestamp - 1 };
  const revoked = { ...first, id: '$revoked', teamId: 'absent' };
  const last = { ...first, id: '$last', timestamp: timestamp + 1 };
  for (const item of [first, expired, revoked, last]) runtime.interactions.upsertSticky(item);
  let emits = 0;
  runtime.emit = () => { emits++; };
  const remove = runtime.storage.remove;
  runtime.storage.remove = async key => { assert.equal(emits, 0); await remove(key); };
  await runtime.cache.expireLocalContent();
  const retained = runtime.interactions.stickyRecords;
  assert.deepEqual(plain(retained.map(item => item.id)), ['$first', '$last']);
  assert.equal(retained[0], first);
  assert.equal(retained[1], last);
  assert.deepEqual(plain(runtime.state.items.stickies.map(item => item.id)), ['$last', '$first']);
  assert.deepEqual(removed, ['alice:cache:item:$expired', 'alice:cache:item:$revoked']);
  assert.equal(emits, 1);
  await runtime.cache.expireLocalContent();
  assert.equal(emits, 1);
});

test('sticky cache removal rechecks retained items after each asynchronous removal', async () => {
  const { runtime, removed } = fixture();
  const timestamp = Date.now();
  for (const id of ['$first', '$restored']) runtime.interactions.upsertSticky({ id, teamId: 'one', asset, text: 'cached', timestamp, expiresAt: timestamp - 1 });
  const remove = runtime.storage.remove;
  runtime.storage.remove = async key => {
    await remove(key);
    if (key === 'alice:cache:item:$first') runtime.interactions.upsertSticky({ id: '$restored', teamId: 'one', asset, text: 'restored', timestamp, expiresAt: timestamp + day });
  };
  runtime.storage.get = async () => undefined;
  await runtime.cache.expireLocalContent();
  assert.deepEqual(removed, ['alice:cache:item:$first']);
  assert.deepEqual(plain(runtime.interactions.stickyRecords.map(item => item.id)), ['$restored']);
  assert.deepEqual(plain(runtime.state.items.stickies.map(item => item.id)), ['$restored']);
});

test('incoming interaction cache pressure evicts messages and releases their displayed media', async () => {
  const { runtime } = fixture();
  const src = URL.createObjectURL(new Blob(['image']));
  runtime.cache.mediaUrls.set('event:$old', src);
  runtime.cache.eventTimes.set('$old', Date.now());
  runtime.state.data.messages.push({ id: '$old', teamId: 'one', attachment: { kind: 'image', src } });
  runtime.storage.cache = async () => ['alice:cache:$old'];
  await runtime.timeline.consume(event(social.STICKY_EVENT, social.teamEventContent(undefined, { target, url, site: 'docs.example.com', text: 'new' })));
  assert.equal(runtime.state.data.messages.length, 0);
  assert.equal(runtime.state.history.one.loaded, false);
  assert.equal(runtime.cache.mediaUrls.size, 0);
  await assert.rejects(fetch(src));
});

test('profile command uses the same grapheme limits as profile inputs', async () => {
  const { runtime } = fixture(); const requests = [];
  runtime.initialise = async () => {}; runtime.refresh = async () => {};
  runtime.api = { request: async (path, options) => { decodeContract(endpointsById[path].body.schema, JSON.parse(JSON.stringify(options.body))); requests.push({ path, ...options }); } };
  const dispatch = new RuntimeCommands(runtime);
  const grapheme = '👨‍👩‍👧‍👦';
  await dispatch.execute({ name: 'profile', payload: { bio: grapheme.repeat(40), tags: [{ text: grapheme.repeat(12) }, { text: 'é'.repeat(12) }] } });
  assert.equal(requests.length, 1);
  for (const payload of [{ bio: grapheme.repeat(41) }, { tags: [{ text: grapheme.repeat(13) }] }, { tags: Array(6).fill({ text: 'tag' }) }]) await assert.rejects(dispatch.execute({ name: 'profile', payload }));
  assert.equal(requests.length, 1);
});

test('read-only teams can clear local drafts and normalize transported null references', async () => {
  const { runtime } = fixture();
  runtime.initialise = async () => {};
  runtime.state.remoteTeams = [];
  let stored;
  runtime.storage.updateDraft = async (account, team, patch, revision) => { stored = patch; return { value: patch, revision: revision + 1 }; };
  const dispatch = new RuntimeCommands(runtime);
  await dispatch.execute({ name: 'draft', payload: { accountId: 'alice', teamId: 'one', revision: 2, patch: { text: '', attachment: null, ref: null, replyTo: null, mentions: [] } } });
  assert.equal(stored.ref, undefined); assert.equal(stored.attachment, undefined); assert.equal(stored.replyTo, undefined);
  assert.equal(runtime.state.drafts.one.revision, 3);
});

test('failed cache clearing leaves active image URLs intact', async () => {
  const { runtime } = fixture();
  const src = URL.createObjectURL(new Blob(['active']));
  runtime.cache.mediaUrls.set('event:$image', src);
  runtime.storage.clearCache = async () => { throw new Error('storage failure'); };
  await assert.rejects(runtime.cache.clear(), /storage failure/);
  assert.equal(await (await fetch(src)).text(), 'active');
  URL.revokeObjectURL(src);
});

test('plaintext social events never enter the encrypted team content state', async () => {
  const { runtime, writes } = fixture();
  const content = social.teamEventContent(undefined, { target, url, site: 'docs.example.com', text: 'plain' });
  await runtime.timeline.consume({ ...event(social.STICKY_EVENT, content), isEncrypted: () => false });
  assert.equal(runtime.state.items.stickies.length, 0);
  assert.equal(writes.size, 0);
});

const accessChanges = {
  removed: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.filter(team => team.id !== 'one'); },
  room: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, roomId: '!replacement:example.com' } : team); },
  periods: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, periods: [{ joinedAt: Date.now(), leftAt: null }] } : team); },
  retention: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, retentionDays: 1 } : team); },
};

for (const [change, revoke] of Object.entries(accessChanges)) {
  for (const preparation of ['decrypt', 'asset', 'reference', 'media']) {
    test(`receive access recheck rejects ${change} access during ${preparation} preparation`, async () => {
      const entered = Promise.withResolvers(), release = Promise.withResolvers();
      const wait = async () => { entered.resolve(); await release.promise; };
      const view = { version: 1, kind: 'website', disclosure: 'page', name: 'source', url };
      const content = { msgtype: 'm.text', body: 'private' };
      if (preparation === 'asset') content['com.palside.asset'] = view;
      if (preparation === 'reference') content['com.palside.ref'] = { target, caption: 'quote', view };
      if (preparation === 'media') Object.assign(content, { msgtype: 'm.image', file: { 'com.palside.media': 'encrypted-image' }, info: { mimetype: 'image/png' } });
      const { runtime, writes } = fixture({
        readView: async value => { if (value === view) await wait(); return readView(value); },
        decryptAttachment: async () => { await wait(); return new ArrayBuffer(1); },
      });
      runtime.auth.client.decryptEventIfNeeded = wait;
      runtime.api = { media: async () => new ArrayBuffer(1) };
      const cache = runtime.storage.cache, cached = [];
      runtime.storage.cache = async (...args) => { cached.push(args[1]); return cache(...args); };
      let published = false;
      runtime.emit = () => { published ||= runtime.state.data.messages.length > 0 || runtime.state.data.views.length > 0; };
      const incoming = event('m.room.message', content, { timestamp: Date.now() - 1.5 * day });
      incoming.shouldAttemptDecryption = () => preparation === 'decrypt';
      const receiving = runtime.timeline.consume(incoming, true);
      await entered.promise;
      revoke(runtime);
      release.resolve();
      await receiving;
      assert.equal(published, false);
      assert.equal(runtime.state.data.messages.length, 0);
      assert.equal(runtime.state.data.views.length, 0);
      assert.equal(runtime.cache.mediaUrls.size, 0);
      assert.equal(writes.size, 0);
      assert.deepEqual(cached, []);
    });
  }
}

test('receive access recheck keeps left-squad history inside membership periods', async () => {
  const { runtime, writes } = fixture({ decryptAttachment: async () => new ArrayBuffer(1) });
  const now = Date.now(), timestamp = now - day;
  runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => ({ ...team, joined: false, periods: [{ joinedAt: now - 1.5 * day, leftAt: now - day / 2 }] }));
  runtime.api = { media: async () => new ArrayBuffer(1) };
  await runtime.timeline.consume(event('m.room.message', { msgtype: 'm.image', file: { 'com.palside.media': 'image' }, info: { mimetype: 'image/png' }, 'com.palside.caption': 'history' }, { timestamp }));
  assert.equal(runtime.state.data.messages[0].text, 'history');
  assert.equal(writes.get('$incoming').value.message.timestamp, timestamp);
  assert.ok(writes.get('media:event:$incoming').value instanceof Blob);
  assert.equal(runtime.cache.mediaUrls.size, 1);
  await runtime.timeline.consume(event('m.room.message', { body: 'before joining' }, { id: '$before', timestamp: now - 1.75 * day }));
  await runtime.timeline.consume(event('m.room.message', { body: 'after leaving' }, { id: '$after', timestamp: now - day / 4 }));
  assert.deepEqual(plain(runtime.state.data.messages.map(message => message.id)), ['$incoming']);
  runtime.state.data.messages = []; runtime.cache.pruneMedia();
});

test('receive access recheck applies a shorter valid retention deadline to messages and media', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { runtime, writes } = fixture({ decryptAttachment: async () => { entered.resolve(); await release.promise; return new ArrayBuffer(1); } });
  const timestamp = Date.now() - day / 2;
  runtime.api = { media: async () => new ArrayBuffer(1) };
  const receiving = runtime.timeline.consume(event('m.room.message', { msgtype: 'm.image', file: { 'com.palside.media': 'image' }, info: { mimetype: 'image/png' } }, { timestamp }));
  await entered.promise;
  accessChanges.retention(runtime);
  release.resolve(); await receiving;
  assert.equal(runtime.state.data.messages[0].expiresAt, timestamp + day);
  assert.equal(writes.get('$incoming').expiresAt, timestamp + day);
  assert.equal(writes.get('media:event:$incoming').expiresAt, timestamp + day);
  runtime.state.data.messages = []; runtime.cache.pruneMedia();
});

for (const phase of ['read', 'write']) {
  test(`receive access recheck rejects media when access changes during storage ${phase}`, async () => {
    const { runtime, writes } = fixture({ decryptAttachment: async () => new ArrayBuffer(1) });
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    runtime.api = { media: async () => new ArrayBuffer(1) };
    const operation = phase === 'read' ? 'get' : 'cache', original = runtime.storage[operation];
    runtime.storage[operation] = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
    const receiving = runtime.timeline.consume(event('m.room.message', { msgtype: 'm.image', file: { 'com.palside.media': 'image' }, info: { mimetype: 'image/png' } }));
    await entered.promise;
    accessChanges.removed(runtime);
    release.resolve(); await receiving;
    assert.equal(writes.size, 0);
    assert.equal(runtime.cache.mediaUrls.size, 0);
    assert.equal(runtime.state.data.messages.length, 0);
  });
}

for (const [change, revoke] of Object.entries(accessChanges)) {
  test(`receive access recheck filters ${change} access before flushing a history cache page`, async () => {
    const { runtime, writes } = fixture();
    runtime.storage.cacheMany = async (account, entries) => { for (const entry of entries) await runtime.storage.cache(account, entry.id, entry.value, entry.expiresAt); return []; };
    await runtime.cache.cachePage(async () => {
      await runtime.timeline.consume(event('m.room.message', { body: 'history' }, { timestamp: Date.now() - 1.5 * day }));
      assert.equal(runtime.state.data.messages.length, 1);
      revoke(runtime);
    });
    assert.equal(writes.size, 0);
  });
}

for (const batched of [false, true]) {
  test(`receive access recheck clears revoked content after ${batched ? 'batched' : 'individual'} message cache writes`, async () => {
    const { runtime, writes } = fixture({ decryptAttachment: async () => new ArrayBuffer(1) });
    runtime.cache.pruneViews = LocalDataRuntime.prototype.pruneViews;
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const cache = runtime.storage.cache;
    runtime.storage.cache = async (...args) => {
      if (args[1] === '$incoming') { entered.resolve(); await release.promise; }
      return cache(...args);
    };
    runtime.storage.cacheMany = async (account, entries) => { for (const entry of entries) await runtime.storage.cache(account, entry.id, entry.value, entry.expiresAt); return []; };
    runtime.api = { media: async () => new ArrayBuffer(1) };
    const receive = () => runtime.timeline.consume(event('m.room.message', {
      msgtype: 'm.image', file: { 'com.palside.media': 'image' }, info: { mimetype: 'image/png' },
      'com.palside.ref': { target, caption: 'quote', view: { version: 1, kind: 'website', disclosure: 'page', name: 'source', url } },
    }));
    const receiving = batched ? runtime.cache.cachePage(receive) : receive();
    await entered.promise;
    accessChanges.removed(runtime);
    release.resolve(); await receiving;
    assert.equal(runtime.state.data.messages.length, 0);
    assert.equal(runtime.state.data.views.length, 0);
    assert.equal(runtime.cache.mediaUrls.size, 0);
    assert.equal(writes.size, 0);
  });
}
