import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessageEdit, canSend, characterLength, recallMessage } from '../apps/extension/src/domain/chat/model.ts';
import { quotedText } from '../apps/extension/src/features/palside/chat/quotes.ts';
import { relatedMessages } from '../apps/extension/src/domain/assets/model.ts';
const message = (id, fields = {}) => ({ id, teamId:'t', author:'self', text:'hello', status:'sent', time:'12:00', ...fields });
test('related asset search includes direct replies but never viewing badges or recursive replies', () => {
  const data = [message('card',{attachment:{kind:'asset',assetId:'a'}}),message('direct',{replyTo:'card'}),message('nested',{replyTo:'direct'}),message('viewing',{viewing:'a'})];
  assert.deepEqual(relatedMessages(data,'a').map(m=>m.id),['card','direct']);
  assert.deepEqual(relatedMessages(recallMessage(data,'card'),'a'),[]);
  assert.equal(quotedText(recallMessage(data,'card')[0]),'Original message unsent');
});
test('late edits cannot revive a recalled message or replace frozen attachment', () => {
  const original=[message('one',{attachment:{kind:'asset',assetId:'b'},replyTo:'prior'})];
  const changed=applyMessageEdit(original,'one','self','updated');
  assert.equal(changed[0].attachment.assetId,'b');
  assert.deepEqual(changed[0].attachment,{kind:'asset',assetId:'b'});
  assert.equal(changed[0].replyTo,'prior');
  const recalled=recallMessage(changed,'one');
  assert.deepEqual(applyMessageEdit(recalled,'one','self','late'),recalled);
  assert.equal(recalled[0].attachment,undefined);
  assert.deepEqual(applyMessageEdit(original,'one','stranger','no'),original);
});
test('message limits preserve composed Chinese and emoji and allow attachment-only sends', () => {
  assert.equal(characterLength('你好👨‍👩‍👧‍👦'),3);
  assert.equal(canSend({text:' \n '}),false);
  assert.equal(canSend({text:'',attachment:{kind:'asset',assetId:'a'}}),true);
  assert.equal(canSend({text:'👨‍👩‍👧‍👦'.repeat(4000)}),true);
  assert.equal(canSend({text:'你'.repeat(4001)}),false);
});
test('owner removal has a distinct quote and cannot be revived by late edits', () => {
  const original = [message('one', { attachment: { kind: 'asset', assetId: 'a' }, replyTo: 'prior' })];
  const removed = recallMessage(original, 'one', 'owner');
  assert.equal(removed[0].removedByOwner, true);
  assert.equal(quotedText(removed[0]), 'Original message removed by the captain');
  assert.equal(removed[0].text, '');
  assert.equal(removed[0].attachment, undefined);
  assert.equal(removed[0].replyTo, undefined);
  assert.deepEqual(applyMessageEdit(removed, 'one', 'self', 'late'), removed);
  assert.equal(recallMessage(removed, 'one')[0].removedByOwner, true);
  assert.equal(quotedText(recallMessage(original, 'one', 'self')[0]), 'Original message unsent');
});
test('quotes show proven local expiry without retaining or inventing unavailable original text', () => {
  const original = message('original', { text: 'old body', expiresAt: 2000 });
  assert.equal(quotedText(original, undefined, 1999), 'old body');
  assert.equal(quotedText(original, undefined, 2000), 'Original message expired');
  assert.equal(quotedText(undefined, 2000, 2000), 'Original message expired');
  assert.equal(quotedText(undefined, 2000, 1999), 'Original message unavailable');
  assert.equal(quotedText(undefined, undefined, 2000), 'Original message unavailable');
  assert.equal(quotedText(undefined, NaN, 2000), 'Original message unavailable');
  assert.equal(quotedText({ ...original, recalled: true, removedByOwner: true }, undefined, 1999), 'Original message removed by the captain');
});
