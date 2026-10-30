import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionQuery, insertMention, messageParts } from '../apps/extension/src/domain/chat/mentions.ts';
const person = {id:'a',name:'小 王'};
test('mention completion replaces only the token at the caret and retains suffix', () => {
  assert.deepEqual(mentionQuery('你好 @小 后文',5),{start:3,end:5,query:'小'});
  assert.equal(mentionQuery('test@example',12), undefined);
  assert.deepEqual(mentionQuery('你好@小',4),{start:2,end:4,query:'小'});
  assert.equal(mentionQuery('@小 王',4), undefined);
  const result = insertMention({text:'你好 @小 后文'},person,3,5);
  assert.equal(result.text,'你好 @小 王  后文'); assert.equal(result.caret,8);
  assert.deepEqual(result.mentions,[{id:'a',label:'小 王'}]);
});
test('only actual mention identities become links and URL contents remain intact', () => {
  const people = [person,{id:'b',name:'小'}];
  assert.deepEqual(messageParts('@小 王 https://site.test/@小 @小王',people,['a','b']), [{text:'@小 王',personId:'a'},{text:' '},{text:'https://site.test/@小',url:true},{text:' @小王'}]);
  assert.deepEqual(messageParts('@小 王',people,[]),[{text:'@小 王'}]);
});
