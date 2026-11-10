import { DAY_MS as day } from '@palside/shared/units';
import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import { productionModules } from './helpers/production-module.mjs';
import { endpointsById } from '../packages/shared/src/contracts/endpoints.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as social from '../apps/extension/src/domain/annotations/social.ts';
import { messageExpiry } from '../apps/extension/src/runtime/chat/message-expiry.ts';
import { commandError } from '../apps/extension/src/runtime/composition/commands.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { readView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { retainedViews } from '../apps/extension/src/runtime/viewing/view-retention.ts';
import { characterLength, emptyDraft, readQuoteRange } from '../apps/extension/src/domain/chat/model.ts';
import { clearCache } from '../apps/extension/src/runtime/media/local-data.ts';
import { requireEncryptedSend, teamSendGuard } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { installEncryptedRoom } from './helpers/encrypted-room.mjs';

const url = 'https://docs.example.com/guide?version=2#/install';
const plain = value => JSON.parse(JSON.stringify(value));

function serviceClass(file, name, globals = {}) {
  const context = { requireEncryptedSend, teamSendGuard, ...languageGlobals, ...social, readView, retainedViews, characterLength, emptyDraft, readQuoteRange, clearCache, Blob, messageExpiry, commandError, text: value => typeof value === 'string' ? value : '', DAY: day, Date, Intl, URL, crypto, setTimeout, clearTimeout, ...globals };
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
    state: { remoteTeams: [team('one'), team('two')], data: { self: 'alice', pendingInvite: undefined, teams: [], people: [], messages: [], views: [] }, drafts: {} },
    auth: { session, directoryExpiresAt: 0, scope: () => ({ check() {}, current: () => true, wait: promise => promise }), requireConnection() {}, client: { sendEvent: async (room, type, content) => { sent.push({ room, type, content }); return { event_id: `$${sent.length}` }; } } },
    storage: { put: async () => {}, get: async key => writes.get(key.replace('alice:cache:', ''))?.value, cache: async (account, id, value, expiresAt) => { writes.set(id, value instanceof Blob ? { account, value, expiresAt } : plain({ account, value, expiresAt })); return []; }, remove: async key => { removed.push(key); writes.delete(key.replace('alice:cache:', '')); }, cleanup: async () => {} },
    sending: { outgoing: new Map(), inFlight: new Set() },
    sharing: { peerViewing: new Map() },
    rooms: { async clearLocal() {} },
    tokens: { remember: () => false, apply: view => view },
    signals: { async pruneRecords() { return false; }, evicted() { return false; } },
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
});

test('recall strips quoted content and mentions for live events and historical replay', async () => {
  for (const mode of ['live', 'historical', 'before-original']) {
    const { runtime, writes } = fixture();
    runtime.cache.pruneViews = LocalDataRuntime.prototype.pruneViews;
    const content = { msgtype: 'm.text', body: 'hello', 'm.mentions': { user_ids: ['@alice:example.com'] }, 'm.relates_to': { 'm.in_reply_to': { event_id: '$reply' } }, 'com.palside.reply_range': { start: 1, end: 3, base: 0 } };
    const original = event('m.room.message', content);
    if (mode === 'live') { await runtime.timeline.consume(original); assert.deepEqual(plain(runtime.state.data.messages[0].replyRange), { start: 1, end: 3, base: 0 }); }
    if (mode !== 'historical') await runtime.timeline.consume({ ...event('m.room.redaction', { reason: 'author' }, { id: '$redaction' }), isRedaction: () => true, getAssociatedId: () => '$incoming' });
    await runtime.timeline.consume({ ...original, isRedacted: () => mode === 'historical', getRedactionEvent: () => ({ content: { reason: 'author' } }) });
    const message = runtime.state.data.messages[0];
    assert.equal(message.recalled, true);
    for (const field of ['attachment', 'replyTo', 'replyRange', 'replyToExpiresAt']) assert.equal(message[field], undefined, `${mode}: ${field}`);
    assert.deepEqual(plain(message.mentionIds), []);
    const cached = writes.get('$incoming').value;
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

test('two readers of one media item share a single download', async () => {
  const { runtime, writes } = fixture();
  let loads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = async () => { loads++; await gate; return new Blob(['image']); };
  const expiresAt = () => Date.now() + day;
  const first = runtime.cache.cachedMedia('m1', load, expiresAt), second = runtime.cache.cachedMedia('m1', load, expiresAt);
  await new Promise(resolve => setTimeout(resolve, 0)); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(loads, 1); assert.equal(a, b); assert.ok(writes.has('media:m1'));
  assert.equal(await runtime.cache.cachedMedia('m1', load, expiresAt), a, 'a finished read is served from memory');
  assert.equal(loads, 1);
});

test('clear-cache preserves reading state and drafts while releasing images and notifying panels', async () => {
  const { runtime, writes } = fixture();
  let emits = 0, refreshes = 0;
  runtime.emit = () => { emits++; };
  runtime.auth.requestRefresh = () => { refreshes++; };
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
  const dispatch = new RuntimeCommands(runtime);
  assert.deepEqual(plain(await dispatch.execute({ name: 'clear-cache' })), { bytes: 0 });
  assert.equal(runtime.state.data.messages[0].text, 'keep');
  assert.equal(runtime.state.data.messages[0].attachment.src, '');
  assert.equal(runtime.state.lobbyTeams[0].ownerAvatar, undefined);
  assert.equal(runtime.state.drafts.one.value.text, 'unsent');
  assert.equal(runtime.cache.mediaUrls.size, 0);
  await assert.rejects(fetch(image)); await assert.rejects(fetch(owner));
  assert.ok(emits > 0);
  assert.equal(refreshes, 1, 'released profile pictures are read again');
  await runtime.cache.expireLocalContent(); await runtime.cache.expireLocalContent();
  assert.equal(writes.size, 0);
});

test('retention maintenance writes only changed existing items and applies media evictions', async () => {
  const { runtime, writes } = fixture();
  const timestamp = Date.now();
  runtime.storage.get = async key => writes.get(key.replace('alice:cache:', ''))?.value;
  const src = URL.createObjectURL(new Blob(['image']));
  runtime.cache.mediaUrls.set('event:$image', src);
  // A cached message whose stored deadline is past the squad's 2-day retention is rewritten once.
  runtime.state.data.messages.push({ id: '$image', teamId: 'one', timestamp, expiresAt: timestamp + 7 * day, attachment: { kind: 'image', src } });
  runtime.cache.eventTimes.set('$image', timestamp);
  writes.set('$image', { value: {} });
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

test('incoming interaction cache pressure evicts messages and releases their displayed media', async () => {
  const { runtime } = fixture();
  const src = URL.createObjectURL(new Blob(['image']));
  runtime.cache.mediaUrls.set('event:$old', src);
  runtime.cache.eventTimes.set('$old', Date.now());
  runtime.state.data.messages.push({ id: '$old', teamId: 'one', attachment: { kind: 'image', src } });
  runtime.storage.cache = async () => ['alice:cache:$old'];
  await runtime.timeline.consume(event('m.room.message', { msgtype: 'm.text', body: 'new' }));
  assert.deepEqual(plain(runtime.state.data.messages.map(message => message.id)), ['$incoming']);
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

test('read-only teams can clear local drafts and normalize transported nulls', async () => {
  const { runtime } = fixture();
  runtime.initialise = async () => {};
  runtime.state.remoteTeams = [];
  let stored;
  runtime.storage.updateDraft = async (account, team, patch, revision) => { stored = patch; return { value: patch, revision: revision + 1 }; };
  const dispatch = new RuntimeCommands(runtime);
  await dispatch.execute({ name: 'draft', payload: { accountId: 'alice', teamId: 'one', revision: 2, patch: { text: '', attachment: null, replyTo: null, mentions: [] } } });
  assert.equal(stored.attachment, undefined); assert.equal(stored.replyTo, undefined);
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

test('plaintext messages never enter the encrypted team content state', async () => {
  const { runtime, writes } = fixture();
  await runtime.timeline.consume({ ...event('m.room.message', { msgtype: 'm.text', body: 'plain' }), isEncrypted: () => false });
  assert.equal(runtime.state.data.messages.length, 0);
  assert.equal(writes.size, 0);
});

const accessChanges = {
  removed: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.filter(team => team.id !== 'one'); },
  room: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, roomId: '!replacement:example.com' } : team); },
  periods: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, periods: [{ joinedAt: Date.now(), leftAt: null }] } : team); },
  retention: runtime => { runtime.state.remoteTeams = runtime.state.remoteTeams.map(team => team.id === 'one' ? { ...team, retentionDays: 1 } : team); },
};

for (const [change, revoke] of Object.entries(accessChanges)) {
  for (const preparation of ['decrypt', 'asset', 'media']) {
    test(`receive access recheck rejects ${change} access during ${preparation} preparation`, async () => {
      const entered = Promise.withResolvers(), release = Promise.withResolvers();
      const wait = async () => { entered.resolve(); await release.promise; };
      const view = { version: 1, kind: 'website', disclosure: 'page', name: 'source', url };
      const content = { msgtype: 'm.text', body: 'private' };
      if (preparation === 'asset') content['com.palside.asset'] = view;
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

test('跟看 heartbeats from a squad member make a follower; their scroll is kept per leader; strangers and repeats are dropped', () => {
  const { runtime } = fixture();
  const session = runtime.auth.session;
  const follow = (content, sender = '@bob:example.com') => ({ ...event('com.palside.follow', { id: crypto.randomUUID(), teamId: 'one', sentAt: Date.now(), ...content }, { sender }) });
  const watch = follow({ kind: 'watch', on: true });
  runtime.interactions.consumeFollow(watch, session);
  runtime.interactions.consumeFollow(watch, session);
  runtime.interactions.consumeFollow(follow({ kind: 'watch', on: true }, '@mallory:example.com'), session);
  assert.deepEqual(plain(runtime.state.followers).map(item => [item.teamId, item.personId]), [['one', 'bob']]);
  runtime.interactions.consumeFollow(follow({ kind: 'scroll', url: 'https://gmgn.ai/sol/token/abc', y: 0.25 }), session);
  runtime.interactions.consumeFollow(follow({ kind: 'scroll', url: 'https://gmgn.ai/sol/token/abc', y: 0.5 }), session);
  assert.deepEqual(plain(runtime.state.leadScrolls).map(item => [item.personId, item.y]), [['bob', 0.5]]);
  runtime.interactions.consumeFollow(follow({ kind: 'tabs', gen: 'generation', open: ['tab-one-id'] }), session);
  runtime.interactions.consumeFollow(follow({ kind: 'tabs', gen: 'generation', open: ['tab-one-id', 'tab-two-id'], front: { tab: 'tab-two-id', url: 'https://gmgn.ai/sol/token/abc' } }), session);
  assert.deepEqual(plain(runtime.state.leadTabs).map(item => [item.personId, item.gen, item.open.length, item.front?.tab]), [['bob', 'generation', 2, 'tab-two-id']], 'the newest snapshot per teammate replaces the last');
  runtime.interactions.consumeFollow(follow({ kind: 'watch', on: false }), session);
  assert.deepEqual(plain(runtime.state.followers), []);
  runtime.interactions.reset();
});
