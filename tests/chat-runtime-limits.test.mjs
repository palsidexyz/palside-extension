import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';
import { CHAT_TEXT_MAX } from '@palside/shared/rules/messages';
const load = productionModules({ readView: async () => undefined });
const { TimelineRuntime } = load('apps/extension/src/runtime/chat/timeline.ts');
const { externalShareCommand } = load('apps/extension/src/runtime/chat/command-handlers.ts');
const emoji = '👩🏽‍💻';
test('external shares keep whole graphemes and use the send limit for combined drafts', async () => {
  const runtime = { auth: { scope: () => ({ wait: p => p }) }, state: { remoteTeams: [] }, emit() {} };
  await externalShareCommand.call({ runtime }, { payload: { text: emoji.repeat(CHAT_TEXT_MAX + 1) } });
  assert.equal(runtime.state.pendingShare, emoji.repeat(CHAT_TEXT_MAX));
  runtime.auth.session = { account: { id: 'self' } };
  runtime.state.remoteTeams = [{ id: 'one', joined: true }];
  runtime.state.drafts = { one: { value: { text: 'already' } } };
  await externalShareCommand.call({ runtime }, { payload: { text: emoji.repeat(CHAT_TEXT_MAX), teamId: 'one', accountId: 'self' } });
  assert.equal(runtime.state.notice.key, 'extension.runtime.selectionTooLong');
});
function fixture() {
  const team = { id: 'one', roomId: 'room', joined: true, retentionDays: 1, people: [{ id: 'peer', matrixId: '@peer' }] };
  const runtime = { auth: { session: { account: { id: 'self' } }, scope: () => ({ wait: p => p, check() {} }) }, state: { remoteTeams: [team], data: { messages: [] } }, cache: { readableTeam: () => team, expiresAt: () => Date.now() + 10000, cachedMedia: async () => 'blob:test', eventTimes: new Map(), cacheMessage: async () => {} }, sending: { outgoing: new Map() }, emit() {} };
  const timeline = new TimelineRuntime(runtime);
  const event = (content, id = '$message', timestamp = Date.now()) => ({ getRoomId: () => 'room', getId: () => id, getTs: () => timestamp, getType: () => 'm.room.message', getSender: () => '@peer', getUnsigned: () => ({}), getContent: () => content, isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false, isRedaction: () => false, isRedacted: () => false });
  return { timeline, runtime, event };
}
for (const kind of ['text', 'image', 'failed-image']) test(`receive cap applies to ${kind} without splitting emoji`, async () => {
  const f = fixture(); const body = emoji.repeat(CHAT_TEXT_MAX * 2 + 1);
  if (kind === 'failed-image') f.runtime.cache.cachedMedia = async () => { throw Error('offline'); };
  const content = kind === 'text' ? { msgtype: 'm.text', body } : { msgtype: 'm.image', body: 'file', 'com.palside.caption': body, file: { 'com.palside.media': 'media' }, info: { mimetype: 'image/png' } };
  await f.timeline.consume(f.event(content)); assert.equal(f.runtime.state.data.messages[0].text, emoji.repeat(CHAT_TEXT_MAX * 2));
  const replacement = { ...content, body, 'com.palside.caption': body };
  await f.timeline.consume(f.event({ 'm.relates_to': { rel_type: 'm.replace', event_id: '$message' }, 'm.new_content': replacement }, '$edit', Date.now() + 1));
  assert.equal(f.runtime.state.data.messages[0].text, emoji.repeat(CHAT_TEXT_MAX * 2));
  assert.equal(f.timeline.edits.get('$message').text, emoji.repeat(CHAT_TEXT_MAX * 2));
});
