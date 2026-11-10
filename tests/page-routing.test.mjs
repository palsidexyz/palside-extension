import test from 'node:test';
import assert from 'node:assert/strict';
import { pageUrlHost, pageAsset, pageMatches, pageStatus, locateResponse } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
const addr='0x39dbed3a2bd333467115de45665cc57f813c4571';
const state={authenticated:true,account:{id:'me'},preferences:{current:'t',notifications:'off'},remoteTeams:[{id:'t',joined:true}],data:{views:[],messages:[],people:[]},drafts:{}};
test('asset adapters are independent of 网页互动 and accept both web protocols',()=>{
  assert.equal(pageUrlHost(`https://gmgn.ai/robinhood/token/${addr}`),'gmgn.ai');
  assert.equal(pageAsset(`https://gmgn.ai/robinhood/token/${addr}`,state),'Robinhood:'+addr.toLowerCase());
  assert.equal(pageAsset(`http://gmgn.ai/robinhood/token/${addr}`,{...state,preferences:{...state.preferences,siteInteraction:{'gmgn.ai':{on:false,danmaku:true,signal:true}}}}),'Robinhood:'+addr.toLowerCase());
  assert.equal(pageAsset('https://custom.example.com/article',state),undefined);
});
test('registration and status honor access independently from 网页互动 in 设置',()=>{
  const access={site:true}, origins=['*://gmgn.ai/*'];
  assert.deepEqual(pageMatches(state,origins),['http://gmgn.ai/*','https://gmgn.ai/*']);
  const disabled={...state,preferences:{...state.preferences,siteInteraction:{'gmgn.ai':{on:false,danmaku:true,signal:true}}}};
  assert.deepEqual(pageMatches(disabled,origins),[]);
  const status=pageStatus(1,{id:2,url:`https://gmgn.ai/robinhood/token/${addr}`},[{tabId:2,windowId:1,url:`https://gmgn.ai/robinhood/token/${addr}`}],access,disabled);
  assert.equal(status.connected,true); assert.equal('interact' in status,false); assert.equal(status.interactive,false); assert.equal(status.granted,true);
});
test('locate responses match the fresh request id and valid result',()=>{assert.equal(locateResponse('req-1',{type:'located',requestId:'req-1',result:'shown'}),'shown');assert.equal(locateResponse('req-1',{type:'located',requestId:'req-2',result:'shown'}),undefined);assert.equal(locateResponse('req-1',{type:'located',requestId:'req-1',result:'bogus'}),undefined);});

test('page URL updates never carry a per-tab hidden flag', async () => {
  const { updatePageUrl } = await import('../apps/extension/src/runtime/browser/page-layer-host.ts');
  const port = { tabId: 2, windowId: 1, url: 'https://gmgn.ai/a', asset: undefined };
  updatePageUrl(port, 'https://gmgn.ai/b', state);
  assert.equal('hidden' in port, false); assert.equal(port.url, 'https://gmgn.ai/b');
});
test('status derives effective 互动 from 设置, the site grant and the per-feature switches; activeTab alone never turns it on', () => {
  const url = `https://gmgn.ai/robinhood/token/${addr}`, tab = { id: 2, url, title: 'Token', status: 'complete' };
  const granted = { site: true }, active = { site: false, active: true };
  let status = pageStatus(1, tab, [], granted, state);
  assert.equal(status.interactive, true); assert.equal(status.signalEnabled, true);
  assert.equal('tokenProfile' in status, false); assert.equal('tokenLocked' in status, false); assert.equal(status.connected, false);
  assert.equal(status.title, 'Token');
  status = pageStatus(1, tab, [], active, state);
  assert.equal(status.granted, false); assert.equal(status.interactive, false, 'the site grant is part of effective 互动');
  assert.equal(status.capabilities.capture.state, 'ready', 'activeTab still allows a screenshot');
  assert.equal(status.title, 'Token', 'a visible address shows its title');
  const hidden = pageStatus(1, { id: 2, title: 'Hidden', status: 'complete' }, [], { site: false }, state);
  assert.equal(hidden.title, undefined); assert.equal(hidden.url, undefined); assert.equal(hidden.capabilities.capture.state, 'access');
  const signal = pageStatus(1, tab, [], granted, { ...state, preferences: { ...state.preferences, siteInteraction: { 'gmgn.ai': { on: true, danmaku: true, signal: false } } } });
  assert.equal(signal.interactive, true, 'the site remains on with its signals off'); assert.equal(signal.signalEnabled, false);
  assert.equal(pageStatus(1, tab, [], granted, { ...state, preferences: { ...state.preferences, siteInteraction: { 'gmgn.ai': { on: false, danmaku: true, signal: true } } } }).interactive, false);
});
