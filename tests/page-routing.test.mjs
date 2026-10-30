import test from 'node:test';
import assert from 'node:assert/strict';
import { pageUrlHost, pageAsset, pageMatches, pageStatus, pageDiff, locateResponse } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
const addr='0x39dbed3a2bd333467115de45665cc57f813c4571';
const state={authenticated:true,account:{id:'me'},preferences:{current:'t',web:{share:true,interact:true},notifications:'off'},toggles:{share:false,interact:true},remoteTeams:[{id:'t',joined:true}],items:{stickies:[]},data:{views:[],messages:[],people:[]},drafts:{}};
test('asset adapters are independent of 网页互动 and accept both web protocols',()=>{
  assert.equal(pageUrlHost(`https://gmgn.ai/robinhood/token/${addr}`),'gmgn.ai');
  assert.equal(pageAsset(`https://gmgn.ai/robinhood/token/${addr}`,state),'Robinhood:'+addr.toLowerCase());
  assert.equal(pageAsset(`http://gmgn.ai/robinhood/token/${addr}`,{...state,toggles:{share:false,interact:false}}),'Robinhood:'+addr.toLowerCase());
  assert.equal(pageAsset('https://custom.example.com/article',state),undefined);
});
test('registration and status honor access independently from the 网页互动 switch',()=>{
  const access={site:true}, origins=['*://gmgn.ai/*'];
  assert.deepEqual(pageMatches(state,origins),['http://gmgn.ai/*','https://gmgn.ai/*']);
  const disabled={...state,toggles:{share:false,interact:false}};
  assert.deepEqual(pageMatches(disabled,origins),[]);
  const status=pageStatus(1,{id:2,url:`https://gmgn.ai/robinhood/token/${addr}`},[{tabId:2,windowId:1,url:`https://gmgn.ai/robinhood/token/${addr}`}],access,disabled);
  assert.equal(status.connected,true); assert.equal('interact' in status,false); assert.equal(status.interactive,false); assert.equal(status.granted,true);
});
test('live diff routes matching asset references only', () => {
  const url = `https://gmgn.ai/robinhood/token/${addr}`, asset = 'Robinhood:' + addr.toLowerCase();
  const ref = { view: { kind: 'asset', chain: 'Robinhood', address: addr, url }, target: { kind: 'address', address: addr } };
  const next = { ...state, data: { ...state.data, messages: [{ id: 'ref', teamId: 't', author: 'me', status: 'sent', liveArrival: true, expiresAt: Date.now() + 1000, ref }] } };
  const result = pageDiff(state, next, [
    { tabId: 2, windowId: 1, url, asset },
    { tabId: 3, windowId: 1, url: 'https://gmgn.ai/robinhood/token/0x49dbed3a2bd333467115de45665cc57f813c4571', asset: 'Robinhood:0x49dbed3a2bd333467115de45665cc57f813c4571' },
  ]);
  assert.deepEqual(result.map(item => item.port.tabId), [2]);
  assert.deepEqual(result[0].flashes.map(item => item.id), ['ref']);
});
test('quote flashes use the exact page even when different routes and sites represent the same asset', () => {
  const source = `https://gmgn.ai/robinhood/token/${addr}`;
  const ref = { view: { kind: 'token', chain: 'Robinhood', address: addr, url: source }, target: { kind: 'quote', exact: 'shared words', prefix: '', suffix: '' } };
  const previous = structuredClone(state);
  const next = { ...previous, data: { ...previous.data, messages: [{ id: 'quote', teamId: 't', author: 'a', status: 'sent', liveArrival: true, ref }] } };
  const ports = [source, `${source}?tab=holders`, `https://other.example/${addr}`].map((url, index) => ({ tabId: index, windowId: 1, url, asset: 'Robinhood:' + addr.toLowerCase() }));
  assert.deepEqual(pageDiff(previous, next, ports).map(item => item.port.tabId), [0]);
});

test('locate responses match the fresh request id and valid result',()=>{assert.equal(locateResponse('req-1',{type:'located',requestId:'req-1',result:'shown'}),'shown');assert.equal(locateResponse('req-1',{type:'located',requestId:'req-2',result:'shown'}),undefined);assert.equal(locateResponse('req-1',{type:'located',requestId:'req-1',result:'bogus'}),undefined);});

test('saved marks restore only the exact public page, exclude hidden and expired rows, and do not truncate at five', async () => {
  const { pageStickies } = await import('../apps/extension/src/runtime/browser/page-layer-host.ts');
  const url = 'https://example.com/article?q=one#section';
  const items = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, teamId: 't', author: 'a', text: '', timestamp: 10 + i, expiresAt: i === 6 ? 1 : 100, target: { kind: 'quote', exact: `Passage ${i}`, prefix: '', suffix: '' }, url: i === 5 ? 'https://example.com/article?q=two#section' : url, site: 'example.com' }));
  const next = { ...state, items: { ...state.items, stickies: items }, preferences: { ...state.preferences, hiddenStickies: ['s0'] } };
  const result = pageStickies({ tabId: 2, windowId: 1, url: `${url}&unused` }, next, 10);
  assert.equal(result.length, 0);
  const restored = pageStickies({ tabId: 2, windowId: 1, url: 'https://example.com/article?q=one&utm_source=a#section' }, next, 10);
  assert.equal(restored.length, 7);
  assert.equal(restored.some(item => ['s0', 's5', 's6'].includes(item.id)), false);
});
test('page URL updates clear missing sticky state and never carry a per-tab hidden flag', async () => {
  const { updatePageUrl } = await import('../apps/extension/src/runtime/browser/page-layer-host.ts');
  const port = { tabId: 2, windowId: 1, url: 'https://gmgn.ai/a', asset: undefined, missingStickies: ['s'] };
  updatePageUrl(port, 'https://gmgn.ai/b', state);
  assert.equal('hidden' in port, false); assert.deepEqual(port.missingStickies, []);
});

test('status derives effective 互动 from the switch, the site grant and the per-feature switches; activeTab alone never turns it on', () => {
  const url = `https://gmgn.ai/robinhood/token/${addr}`, tab = { id: 2, url, title: 'Token', status: 'complete' };
  const granted = { site: true }, active = { site: false, active: true };
  let status = pageStatus(1, tab, [], granted, state);
  assert.equal(status.interactive, true); assert.equal(status.stickyEnabled, true); assert.equal(status.signalEnabled, true);
  assert.equal(status.tokenProfile, true); assert.equal('tokenLocked' in status, false); assert.equal(status.connected, false);
  assert.equal(status.title, 'Token');
  status = pageStatus(1, tab, [], active, state);
  assert.equal(status.granted, false); assert.equal(status.interactive, false, 'the site grant is part of effective 互动');
  assert.equal(status.capabilities.capture.state, 'ready', 'activeTab still allows a screenshot');
  assert.equal(status.title, 'Token', 'a visible address shows its title');
  const hidden = pageStatus(1, { id: 2, title: 'Hidden', status: 'complete' }, [], { site: false }, state);
  assert.equal(hidden.title, undefined); assert.equal(hidden.url, undefined); assert.equal(hidden.capabilities.capture.state, 'access');
  const sticky = pageStatus(1, tab, [], granted, { ...state, preferences: { ...state.preferences, interaction: { signal: true, sticky: false } } });
  assert.equal(sticky.interactive, true); assert.equal(sticky.stickyEnabled, false); assert.equal(sticky.signalEnabled, true);
  const signal = pageStatus(1, tab, [], granted, { ...state, preferences: { ...state.preferences, interaction: { signal: false, sticky: true } } });
  assert.equal(signal.interactive, true, 'features turn off one by one'); assert.equal(signal.stickyEnabled, true); assert.equal(signal.signalEnabled, false);
  const none = pageStatus(1, tab, [], granted, { ...state, preferences: { ...state.preferences, interaction: { signal: false, sticky: false } } });
  assert.equal(none.interactive, false, 'with every feature off there is nothing to draw');
  for (const off of [{ ...state, toggles: { share: false, interact: false } }, { ...state, preferences: { ...state.preferences, web: { share: true, interact: false } } }]) assert.equal(pageStatus(1, tab, [], granted, off).interactive, false);
  assert.equal(pageStatus(1, { id: 2, url: 'https://x.com/home', status: 'complete' }, [], granted, state).tokenProfile, false);
});
