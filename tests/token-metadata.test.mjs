import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { identifyPage, shortAddress, publicShareUrl, websiteIdentity } from '../packages/shared/src/navigation.ts';
import { tokenName, resolveTokenMetadata } from '../apps/extension/src/runtime/viewing/token-page.ts';
import { pageName } from '../apps/extension/src/runtime/viewing/page-title.ts';
import { pageView, readView, validateView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { pageFavicon } from '../apps/extension/src/runtime/viewing/viewing.ts';
import { createTabObserver } from '../apps/extension/src/runtime/browser/tab-observer.ts';

const address='0x0000000000000000000000000000000000000001';
const url=`https://gmgn.ai/eth/token/${address}`;
const identity=identifyPage(url,['gmgn.ai']);
const source=ts.createSourceFile('sharing.ts',readFileSync('apps/extension/src/runtime/viewing/sharing.ts','utf8'),ts.ScriptTarget.Latest,true);
const classNode=source.statements.find(ts.isClassDeclaration);
const members=classNode.members.filter(n=>['localTokenMetadata','refreshTokenMetadata','prepareView'].includes(n.name?.getText(source))).map(n=>n.getText(source)).join('\n');
const context={tokenName,resolveTokenMetadata,pageView,readView,identifyPage,publicShareUrl,websiteIdentity,pageName,pageFavicon,URL,AbortController,setTimeout,clearTimeout,Date};
vm.runInNewContext(ts.transpileModule(`class Metadata { ${members} };globalThis.Metadata=Metadata;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
function fixture(reader){
 const instance=new context.Metadata();let emitted=0,published=0;
 const session={account:{id:'self'}};
 instance.runtime={auth:{session,scope:()=>({wait:p=>p})},state:{preferences:{current:'team'}},tokenPage:reader,cache:{upsertView(){}},emit:()=>emitted++};
 instance.page=pageView(identity);instance.pageObservation=1;instance.mayObserve=()=>true;instance.publishViewing=async()=>published++;
 return {instance,counts:()=>({emitted,published})};
}

test('asset resolver never uses a ticker title and snapshot validation rejects non-name market decorations',()=>{
 for(const value of ['↑','↓','↗','▲','$0.001','+12%','PEPE ↑','$0.001 ↑']) {
  assert.equal(tokenName(value),undefined);
  assert.equal(resolveTokenMetadata(identity,{name:value}).name,shortAddress(address));
  assert.equal(validateView({...pageView(identity),name:value}).name,shortAddress(address));
 }
 assert.equal(resolveTokenMetadata(identity,{name:'PONS'}).name,'PONS');
 assert.equal(tokenName('$CASHCAT'),'$CASHCAT');
 assert.equal(pageName('A post on X | X.com','x.com'),'A post on X');
});
test('unobserved assets use contract address while ordinary web pages retain title semantics',async()=>{
 let reads=0;const {instance}=fixture(async()=>{reads++;return {name:'PONS'};});
 const asset=await instance.prepareView(url,undefined,undefined,'↑ $0.1 | GMGN.AI');
 assert.equal(asset.name,shortAddress(address));assert.equal(reads,0);
 const article=await instance.prepareView('https://example.com/article',undefined,undefined,'An article | Example');
 assert.equal(article.name,'An article');
});
test('late contract header gets bounded retries and ticker refreshes recheck the host without republishing identical metadata',async()=>{
 let reads=0;const {instance,counts}=fixture(async()=>++reads===1?undefined:{name:'PONS'});
 const target={tabId:1,windowId:1};
 await instance.refreshTokenMetadata(identity,target);
 assert.equal(reads,2);assert.equal(instance.page.name,'PONS');assert.deepEqual(counts(),{emitted:1,published:1});
 for(let n=0;n<5;n++)await instance.refreshTokenMetadata(identity,target);
 assert.equal(reads,7);assert.deepEqual(counts(),{emitted:1,published:1});
});
test('failed metadata requests stop after two retries',async()=>{
 let reads=0;const {instance}=fixture(async()=>{reads++;return undefined;});
 const target={tabId:1,windowId:1};
 await instance.localTokenMetadata(identity,target,'viewing');
 assert.equal(reads,3);assert.equal(instance.page.name,shortAddress(address));
});
test('token-data revocation rejects a pending host result and frozen snapshots keep their metadata',async()=>{
 let finish;const {instance}=fixture(async()=>({name:'FROZEN'}));
 const target={tabId:1,windowId:1};
 const frozen=await instance.prepareView(url,undefined,target);
 instance.runtime.tokenPage=()=>new Promise(resolve=>{finish=resolve;});
 const pending=instance.localTokenMetadata(identity,target,'share');
 instance.runtime.state.preferences.tokenOff=['gmgn.ai'];
 finish({name:'LATE'});
 assert.equal(await pending,undefined);
 const disabled=await instance.prepareView(url,undefined,target);
 assert.equal(disabled.name,shortAddress(address));assert.equal(frozen.name,'FROZEN');
});
test('navigation during an async metadata read cannot rename the next token',async()=>{
 let resolve;const {instance,counts}=fixture(()=>new Promise(done=>{resolve=done;}));
 const request=instance.refreshTokenMetadata(identity,{tabId:1,windowId:1});
 instance.page={...instance.page,id:'next',url:'https://example.com/next'};instance.pageObservation++;
 resolve({name:'OLD'});await request;
 assert.equal(instance.page.id,'next');assert.deepEqual(counts(),{emitted:0,published:0});
});
test('metadata-only tab updates debounce without resetting sharing or reporting fresh device activity',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
 const calls={clear:0,publish:0,metadata:0,activity:0};
 const page={tabId:1,windowId:1,url};
 const policy={key:'account:team',hosts:['gmgn.ai']};
 const observer=createTabObserver({policy:()=>policy,activePage:async()=>page,clear:async()=>calls.clear++,publish:async()=>calls.publish++,activity:async()=>calls.activity++,metadata:async()=>calls.metadata++},10);
 t.after(()=>observer.dispose());
 const tick=async ms=>{t.mock.timers.tick(ms);await new Promise(r=>setImmediate(r));};
 await observer.refresh(true);await tick(10);const initial={...calls};
 observer.metadataChanged();observer.metadataChanged();await tick(10);
 assert.equal(calls.metadata,1);assert.equal(calls.clear,initial.clear);assert.equal(calls.publish,initial.publish);assert.equal(calls.activity,initial.activity);
 observer.metadataChanged();await tick(10);assert.equal(calls.metadata,1);
 observer.dispose();observer.metadataChanged();await tick(2000);assert.equal(calls.metadata,1);
});
