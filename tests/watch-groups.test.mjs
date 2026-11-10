import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGroups, rankedKeys, placeSlots, overtake, stickyFaces } from '../apps/extension/src/features/palside/viewing/watch-groups.ts';
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
test('each page of a website is its own card, the same page gathers people, and a site-only share stands apart',()=>{
 const a=pageView(websiteIdentity('https://x.com/alice/status/1','page'));
 const b=pageView(websiteIdentity('https://x.com/bob/status/2','page'));
 const c=pageView(websiteIdentity('https://x.com/messages/3','site'));
 const same=pageView(websiteIdentity('https://www.x.com/alice/status/1/#top','page'));
 const groups=watchGroups([person('a',a),person('b',b),person('c',c),person('d',same)],[a,b,c,same]);
 assert.equal(groups.length,3);assert.deepEqual(groups.map(group=>group.members.length),[2,1,1]);
 assert.equal(groups.at(-1).sources[0].url,'https://x.com/');assert.ok(!JSON.stringify(c).includes('messages'));
});
test('rank changes move larger groups first and preserve existing ties before newcomers',()=>{
 const g=(key,n)=>({key,members:Array(n)});
 assert.deepEqual(rankedKeys([g('a',3),g('b',4),g('x',1)],['a','b','x']),['b','a','x']);
 assert.deepEqual(rankedKeys([g('a',4),g('b',4),g('new',4)],['b','a']),['b','a','new']);
});
test('pool snapshots are rejected and direct assets never carry a token icon',async()=>{
 const pool=identifyPage(`https://axiom.trade/meme/HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF?chain=sol`,['axiom.trade']);
 assert.equal(validateView({...pool,kind:'asset',chain:'Solana',address,id:`Solana:${address}`,name:'Frozen',source:'AXIOM',url:pool.url,color:'#e9edf0',glyph:'F'}),undefined);
 const snapshot=token('gmgn.ai');
 const fetcher=globalThis.fetch;globalThis.fetch=()=>{throw Error('receiver network');};
 try {
  assert.equal((await readView(snapshot)).name,'SOL');
  const logo='https://cdn.dexscreener.com/cms/images/a.png';
  assert.equal((await readView({...snapshot,logo})).logo,undefined);
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

test('places keep their page while anyone is on it, and an emptied place takes the next page in place',()=>{
 let n=0; const next=()=>++n;
 const first=placeSlots([],['pons','x','cat'],next); assert.deepEqual(first,[{id:1,key:'pons'},{id:2,key:'x'}]);
 assert.deepEqual(placeSlots(first,['x','pons','cat'],next),first,'a rank change never swaps places');
 assert.deepEqual(placeSlots(first,['pons','cat'],next),[{id:1,key:'pons'},{id:2,key:'cat'}],'the emptied place keeps its id and takes the busiest hidden page');
 assert.deepEqual(placeSlots([{id:1,key:'pons'}],['dex'],next),[{id:1,key:'dex'}],'one person switching pages changes one chip in place');
 assert.deepEqual(placeSlots(first,['x'],next),[{id:2,key:'x'}],'a place with nothing to take closes');
 assert.deepEqual(placeSlots([{id:2,key:'x'}],['x','new'],next),[{id:2,key:'x'},{id:3,key:'new'}],'new pages fill from the right');
});
test('a hidden page overtakes only the quieter place, and only when clearly ahead',()=>{
 const g=(key,n)=>({key,members:Array(n)}); const slots=[{id:1,key:'a'},{id:2,key:'b'}];
 assert.equal(overtake(slots,[g('a',9),g('b',2),g('c',3)],['a','c','b']),undefined,'one ahead is not enough');
 assert.deepEqual(overtake(slots,[g('a',9),g('b',2),g('c',4)],['a','c','b']),{id:2,key:'c'});
 assert.equal(overtake(slots,[g('a',9),g('b',2)],['a','b']),undefined);
});
test('faces keep their places: the next person takes a leaver\'s place and the user leads',()=>{
 assert.deepEqual(stickyFaces([],['a','b','c'],'me'),['a','b']);
 assert.deepEqual(stickyFaces(['a','b'],['b','c','a2'],'me'),['c','b'],'b stays where it was');
 assert.deepEqual(stickyFaces(['a','b'],['a','b','c','d'],'me'),['a','b'],'others arriving only grow the count');
 assert.deepEqual(stickyFaces(['a','b'],['a','b','me'],'me'),['me','b'],'the user takes the first place');
 assert.deepEqual(stickyFaces(['a'],['a','me'],'me'),['me','a'],'with room, the user leads and nobody is hidden');
 assert.deepEqual(stickyFaces(['me','b'],['a','b'],'me'),['a','b'],'the user leaving gives the place back by team order');
 assert.deepEqual(stickyFaces(['a','b'],['b'],'me'),['b']);
});
test('跟看: the followed teammate takes a face, after the user, and the other face keeps its place',()=>{
 assert.deepEqual(stickyFaces(['a','b'],['a','b','f'],'me',2,'f'),['f','b'],'full: the followed takes the first non-leader face');
 assert.deepEqual(stickyFaces(['a','b'],['a','b','f','me'],'me',2,'f'),['me','f'],'the user and the followed both show, user first');
 assert.deepEqual(stickyFaces(['a'],['a','f'],'me',2,'f'),['f','a']);
 assert.deepEqual(stickyFaces(['f','b'],['f','b'],'me',2,'f'),['f','b'],'already shown stays');
 assert.deepEqual(stickyFaces(['a','b'],['a','b'],'me',2,'f'),['a','b'],'no effect when the followed is elsewhere');
});
