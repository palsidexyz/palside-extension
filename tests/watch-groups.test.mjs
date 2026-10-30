import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGroups, rankedKeys } from '../apps/extension/src/features/palside/viewing/watch-groups.ts';
import { pageView, validateView, readView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { identifyPage, websiteIdentity } from '../packages/shared/src/navigation.ts';
const address='So11111111111111111111111111111111111111112';
const token=host=>pageView(identifyPage(`https://${host}/${host==='gmgn.ai'?'sol/token':'tokens/sol'}/${address}`,[host]),{name:'SOL'});
const person=(id,view)=>({id,name:id,viewing:view.id});
test('token grouping retains per-site sources and deduplicates accounts without changing snapshots',()=>{
 const a=token('gmgn.ai'), b=token('fomo.family'); const groups=watchGroups([person('a',a),person('b',b),person('a',b)],[a,b]);
 assert.equal(groups.length,1);assert.equal(groups[0].members.length,2);assert.deepEqual(groups[0].sources.map(s=>s.members.length),[1,1]);assert.equal(a.name,'SOL');
 const conflict={...b,name:'IMPOSTOR'};assert.equal(watchGroups([person('a',a),person('b',b)],[a,conflict])[0].view.name,'So1111…1112');
});
test('same website groups distinct page links and site-only viewers without inventing shared-page counts',()=>{
 const a=pageView(websiteIdentity('https://x.com/alice/status/1','page'));
 const b=pageView(websiteIdentity('https://x.com/bob/status/2','page'));
 const c=pageView(websiteIdentity('https://x.com/messages/3','site'));
 const group=watchGroups([person('a',a),person('b',b),person('c',c)],[a,b,c])[0];
 assert.equal(group.members.length,3);assert.equal(group.sources.length,3);assert.equal(group.sources.at(-1).url,'https://x.com/');assert.ok(!JSON.stringify(c).includes('messages'));
});
test('rank changes move larger groups first and preserve existing ties before newcomers',()=>{
 const g=(key,n)=>({key,members:Array(n)});
 assert.deepEqual(rankedKeys([g('a',3),g('b',4),g('x',1)],['a','b','x']),['b','a','x']);
 assert.deepEqual(rankedKeys([g('a',4),g('b',4),g('new',4)],['b','a']),['b','a','new']);
});
test('pool snapshots are rejected while direct assets preserve only allowed public image sources',async()=>{
 const pool=identifyPage(`https://axiom.trade/meme/HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF?chain=sol`,['axiom.trade']);
 assert.equal(validateView({...pool,kind:'asset',chain:'Solana',address,id:`Solana:${address}`,name:'Frozen',source:'AXIOM',url:pool.url,color:'#e9edf0',glyph:'F'}),undefined);
 const snapshot=token('gmgn.ai');
 const fetcher=globalThis.fetch;globalThis.fetch=()=>{throw Error('receiver network');};
 try {
  assert.equal((await readView(snapshot)).name,'SOL');
  const logo='https://cdn.dexscreener.com/cms/images/a.png';
  assert.equal((await readView({...snapshot,logo})).logo,logo);
  assert.equal(validateView({...snapshot,logo:'https://untrusted.invalid/tracking.png'}).logo,undefined);
  assert.equal(validateView({...snapshot,chain:'Base'}),undefined);
 } finally {globalThis.fetch=fetcher;}
});
test('snapshots reject absent version, mismatched direct identity and hidden site paths',()=>{
 const view=token('gmgn.ai');assert.equal(validateView({...view,version:undefined}),undefined);
 assert.equal(validateView({...view,address:'11111111111111111111111111111111'}),undefined);
 const website=pageView(websiteIdentity('https://x.com/messages'));
 assert.equal(validateView({...website,url:'https://x.com/messages'}),undefined);
 assert.equal(validateView(website).disclosure,'site');
});

test('malformed remote contract types are rejected without throwing or changing identity',()=>{
 const view=token('gmgn.ai');
 for(const address of [[view.address], {value:view.address}, 123, true, null]) assert.equal(validateView({...view,address}),undefined);
});
