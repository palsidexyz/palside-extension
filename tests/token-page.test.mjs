import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { readVisibleToken, matchesTokenPage } from '../apps/extension/src/runtime/viewing/token-page.ts';
import { identifyPage } from '../packages/shared/src/navigation.ts';
import { siteProfile } from '../packages/shared/src/sites/index.ts';

const address='0x39dbed3a2bd333467115de45665cc57f813c4571';
const href=`https://gmgn.ai/robinhood/token/${address}`;
function fixture({contract=address,title='PONS $0.1 | GMGN.AI',name='PONS',hidden=false,tainted=false,fomo=false}={}) {
  const host=fomo?'fomo.family':'gmgn.ai';const page=fomo?`https://fomo.family/tokens/robinhood/${address}`:href;
  const heading=fomo?`<div class="leading-tight truncate">${name}</div>`:`<h1>${name}</h1>`;
  const link=fomo?`https://x.com/search?q=${contract}%20OR%20%24${name}`:`https://explorer.example/token/${contract}`;
  const logo=fomo?'https://metadata.mobula.io/assets/logos/'+'a'.repeat(64)+'.png':'https://gmgn.ai/external-res/token.png';
  const {document}=parseHTML(`<html><head><title>${title}</title></head><body><main><section>${heading}<a href="${link}">contract</a><img src="${logo}" /></section></main><aside><input value="PRIVATE WALLET" /></aside></body></html>`);
  Object.defineProperty(document,'visibilityState',{value:hidden?'hidden':'visible'});
  for(const element of document.querySelectorAll('*'))element.getBoundingClientRect=()=>({width:32,height:32});
  const img=document.querySelector('img');Object.assign(img,{complete:true,naturalWidth:32,naturalHeight:32,currentSrc:img.src});
  Object.defineProperty(document.body,'textContent',{get(){throw Error('Whole-page text read');}});
  Object.defineProperty(document.querySelector('input'),'value',{get(){throw Error('Form read');}});
  const create=document.createElement.bind(document);document.createElement=tag=>tag==='canvas'?{getContext:()=>({drawImage(){if(tainted)throw Error('SecurityError');}}),toDataURL:()=> 'data:image/png;base64,fixture'}:create(tag);
  const location={href:page,hostname:host,origin:`https://${host}`};const window={};window.top=window;
  const run=()=>vm.runInNewContext(`(${readVisibleToken.toString()})(input,profile)`,{window,document,location,input:{href:page,host,address,chain:'Robinhood'},profile:siteProfile(host),URL,getComputedStyle:()=>({visibility:'visible'}),fetch(){throw Error('Unexpected network');}});
  return {run,document,location};
}
test('temporary page read returns only a contract-bound public name and locally exportable thumbnail',()=>{
  const result=fixture().run();assert.equal(result.name,'PONS');assert.ok(result.logo.startsWith('data:image/png'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|explorer|token.png/);
  assert.equal(fixture({tainted:true}).run().name,'PONS');assert.equal(fixture({tainted:true}).run().logo,'https://gmgn.ai/external-res/token.png');
});
test('FOMO public search link proves a full contract and its observed inline symbol without reading unrelated text',()=>{
 assert.equal(fixture({fomo:true,title:'Market cap $1 | PONS | fomo'}).run().name,'PONS');
 assert.equal(fixture({fomo:true,tainted:true,title:'Market cap $1 | PONS | fomo'}).run().logo,'https://metadata.mobula.io/assets/logos/'+'a'.repeat(64)+'.png');
 assert.equal(fixture({fomo:true,title:'Market cap $1 | PONS | fomo',contract:address+'1'}).run(),undefined);
});
test('stale DOM, mismatched titles, hidden pages and navigation never supplement another token',()=>{
  assert.equal(fixture({contract:'0x'+'1'.repeat(40)}).run(),undefined);
  assert.equal(fixture({name:'OLD'}).run(),undefined);
  assert.equal(fixture({hidden:true}).run(),undefined);
  const moved=fixture();moved.location.href='https://gmgn.ai/portfolio';assert.equal(moved.run(),undefined);
});
test('host boundary validates source, network and full contract; pool data cannot choose another chain',()=>{
  const identity=identifyPage(href,['gmgn.ai']);assert.equal(matchesTokenPage(href,identity),true);
  assert.equal(Boolean(matchesTokenPage(href,{...identity,address:'0x'+'1'.repeat(40)})),false);
  assert.equal(Boolean(matchesTokenPage('https://gmgn.ai/portfolio',identity)),false);
  assert.equal(Boolean(matchesTokenPage(href,{...identity,chain:'Base'})),false);
});

test('GMGN trend decorations never become names or veto the contract-bound public heading',()=>{
  for(const title of ['↑ $0.001 | GMGN.AI','↓ $0.001 | GMGN.AI','▲ $0.001 | GMGN.AI','↑ PONS $0.001 | GMGN.AI','PONS ↑ $0.001 | GMGN.AI']) assert.equal(fixture({title}).run()?.name,'PONS',title);
  for(const name of ['↑','↓','▲','↗','$0.001','+12%']) assert.equal(fixture({title:'↑ $0.001 | GMGN.AI',name}).run(),undefined,name);
});
