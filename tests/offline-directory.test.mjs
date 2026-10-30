import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineDirectory, usableDirectory } from '../apps/extension/src/runtime/account/offline-directory.ts';
const data = {self:'a',teams:[{id:'t',name:'Team',description:'',owner:'a',memberIds:['a'],joined:true,muted:false,unread:9,published:true,avatar:'blob:old',roomId:'private-room',requests:['private']}],people:[{id:'a',name:'A',color:'#eee',avatar:'blob:old',presence:'active',viewing:'v',email:'private'}]};
test('offline directory retains display identity, never live signals, credentials or governance data',()=>{
  const saved=offlineDirectory(data,200);
  assert.equal(saved.teams[0].name,'Team');
  assert.equal(saved.teams[0].unread,0);
  assert.equal(saved.teams[0].published,false);
  for(const key of ['avatar','roomId','requests']) assert.equal(key in saved.teams[0],false);
  assert.deepEqual(saved.people,[{id:'a',name:'A',color:'#eee'}]);
  saved.teams[0].memberIds.push('b');
  assert.deepEqual(data.teams[0].memberIds,['a']);
});
test('offline directory is account scoped and expired metadata is never restored',()=>{
  const saved=offlineDirectory(data,200);
  assert.equal(usableDirectory(saved,'b',100),undefined);
  assert.equal(usableDirectory(saved,'a',200),undefined);
  assert.equal(usableDirectory(undefined,'a',100),undefined);
  assert.equal(usableDirectory(saved,'a',199).teams[0].id,'t');
});
