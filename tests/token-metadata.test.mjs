import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { identifyPage, shortAddress, publicShareUrl, websiteIdentity } from '../packages/shared/src/navigation.ts';
import { tokenName, resolveTokenMetadata } from '../apps/extension/src/runtime/viewing/token-name.ts';
import { pageName } from '../apps/extension/src/runtime/viewing/page-title.ts';
import { pageView, readView, validateView } from '../apps/extension/src/runtime/viewing/view-snapshot.ts';
import { pageFavicon } from '../apps/extension/src/runtime/viewing/viewing.ts';
import { TokenProfiles } from '../apps/extension/src/runtime/viewing/token-profiles.ts';
import { assetKey } from '../apps/extension/src/domain/annotations/interaction.ts';

const address='0x0000000000000000000000000000000000000001';
const url=`https://gmgn.ai/eth/token/${address}`;
const identity=identifyPage(url,['gmgn.ai']);
const source=ts.createSourceFile('sharing.ts',readFileSync('apps/extension/src/runtime/viewing/sharing.ts','utf8'),ts.ScriptTarget.Latest,true);
const classNode=source.statements.find(ts.isClassDeclaration);
const members=classNode.members.filter(n=>['tokenView','prepareView'].includes(n.name?.getText(source))).map(n=>n.getText(source)).join('\n');
const context={TOKEN_NAME_WAIT_MS:50,assetKey,tokenName,resolveTokenMetadata,pageView,readView,identifyPage,publicShareUrl,websiteIdentity,pageName,pageFavicon,URL,AbortController,setTimeout,clearTimeout,Date};
vm.runInNewContext(ts.transpileModule(`class Metadata { ${members} };globalThis.Metadata=Metadata;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
/** `ensure` is the directory client's: it settles when `answer` is called (or never), or at once with `reply`, so a busy machine cannot outlast the wait. */
function fixture(reply){
 const tokens=new TokenProfiles(()=>{},()=>0,'https://api.test');let answer;const asked=[];
 const directory={ensure:asset=>{asked.push(asset);if(reply){tokens.putDirectory(asset,reply);return Promise.resolve();}return new Promise(resolve=>{answer=entry=>{tokens.putDirectory(asset,entry);resolve();};});}};
 const instance=new context.Metadata();
 instance.runtime={auth:{session:{account:{id:'self'}},scope:()=>({wait:p=>p})},state:{preferences:{current:'team'}},tokens,directory};
 return {instance,tokens,asked,answer:entry=>answer(entry)};
}
const entry={chain:'ethereum',address,name:'Pons Token',symbol:'PONS',decimals:18,logo:2,logoPending:false};

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
test('link cards wait briefly for the directory and never read the page; ordinary web pages retain title semantics',async()=>{
 const {instance,asked}=fixture(entry);
 const asset=await instance.prepareView(url,undefined,'↑ $0.1 | GMGN.AI');
 assert.equal(asset.name,'PONS');assert.deepEqual(asked,[`Ethereum:${address}`]);
 assert.equal(asset.logo,undefined,'snapshots never carry a token icon');
 const article=await instance.prepareView('https://example.com/article',undefined,'An article | Example');
 assert.equal(article.name,'An article');
});
test('without an answer in time the card uses the short address; a held answer is used without asking again',async()=>{
 const {instance,tokens,asked}=fixture();
 assert.equal((await instance.prepareView(url)).name,shortAddress(address));
 tokens.putDirectory(`Ethereum:${address}`,entry);asked.length=0;
 assert.equal((await instance.prepareView(url)).name,'PONS');assert.equal(asked.length,0);
});
test('token snapshots drop any icon they carry; website snapshots keep their bounded favicon',()=>{
 const token=validateView({...pageView(identity,{name:'PONS'}),logo:'https://cdn.dexscreener.com/cms/images/x.png'});
 assert.equal(token.name,'PONS');assert.equal('logo' in token,false);
 const site=websiteIdentity('https://example.com/a','page');
 const favicon='data:image/png;base64,AAAA';
 assert.equal(validateView(pageView(site,{name:'A',logo:favicon})).logo,favicon);
 assert.equal(validateView({...pageView(site,{name:'A'}),logo:'https://evil.test/x.png'}).logo,undefined);
});
