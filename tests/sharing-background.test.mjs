import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabObserver} from '../apps/extension/src/runtime/browser/tab-observer.ts';
const wait=()=>new Promise(resolve=>setTimeout(resolve,35));
const until=async(ready,ms=1000)=>{const end=Date.now()+ms;while(!ready()&&Date.now()<end)await wait();};
function event(){const listeners=[];return{addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.map(fn=>fn(...args))};}
// 网页互动 stays off on the token site, so only the token reads under test call executeScript; a test may set its own sites.
const off={on:false,danmaku:false,signal:false,sticky:false};
const quiet={'gmgn.ai':off,'fomo.family':off};
function fixture({broadcastState=true,helloActivity=true,snapshot,site=false,favicon=true}={}){
 const calls=[]; const controls={focused:true,locked:false,site,favicon,permissionChecks:[],tab:{id:1,windowId:10,active:true,status:'complete',url:'https://x.com/secret-post?tracking=private',title:'PRIVATE TITLE'}};
 let state={connection:{networkOnline:true,service:'ready',messaging:'ready',retrying:false},authenticated:true,account:{id:'alice'},preferences:{current:'one',share:true,siteInteraction:quiet},remoteTeams:[{id:'one',joined:true}],data:{people:[],messages:[],views:[]},items:{danmaku:[],notes:[],stances:[]},drafts:{}};
 const panelSender={id:'qa',url:'chrome-extension://qa/sidepanel.html',documentId:'panel'};
 const backgroundSender={id:'qa',url:'chrome-extension://qa/offscreen.html'};
 const browser={
  runtime:{id:'qa',getURL:path=>`chrome-extension://qa${path}`,getManifest:()=>({manifest_version:3}),getContexts:async({contextTypes}={})=>contextTypes?.includes('SIDE_PANEL')?[{contextType:'SIDE_PANEL',documentId:'panel',documentUrl:'chrome-extension://qa/sidepanel.html',windowId:10,incognito:false}]:[{}],onMessage:event(),onMessageExternal:event(),onConnect:event(),onInstalled:event(),sendMessage:async({command})=>{calls.push(command);if(command.name==='snapshot')return snapshot ? snapshot() : {ok:true,value:state};return{ok:true};}},
  tabs:{query:async()=>[{...controls.tab}],onActivated:event(),onUpdated:event(),onRemoved:event()},
  windows:{getLastFocused:async()=>({id:10,focused:controls.focused}),get:async()=>({id:10,focused:controls.focused}),onRemoved:event(),onFocusChanged:event()},
  idle:{queryState:async()=>controls.locked?'locked':'active',onStateChanged:event()},
  permissions:{getAll:async()=>({origins:['https://api.example/*']}),contains:async({permissions,origins}={})=>{if(permissions)controls.permissionChecks.push(...permissions);return origins ? controls.site : permissions?.includes('favicon') ? controls.favicon : false;},remove:async()=>true,request:()=>{throw Error('Website permission prompt');},onAdded:event(),onRemoved:event()},
  scripting:{executeScript:()=>{throw Error('Automatic script injection');}},
  sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},action:{onClicked:event()},
 };
 let observer;
  const {grantedOrigins}=addBackgroundHost(browser,{origins:site?['<all_urls>']:[]});
 startWorker(browser,{createTabObserver:host=>{observer=createTabObserver(host,5);return observer;},fetch:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1]),headers:{get:()=> 'image/png'}})});
 // Keep page-status traffic separate from the lifecycle messages these tests inspect.
 const messages=[],pageMessages=[];
 const port={name:'palside/panel',sender:panelSender,onMessage:event(),onDisconnect:event(),postMessage:message=>(message.type==='page'?pageMessages:messages).push(message)};
 const sendState=stateSender(browser,backgroundSender);
 const broadcast=()=>sendState(state);
 browser.runtime.onConnect.emit(port);port.onMessage.emit({type:'hello',windowId:10,activity:helloActivity});if(broadcastState)broadcast();
 return{calls,messages,pageMessages,controls,grantedOrigins,browser,port,broadcast,command:(name,payload={})=>new Promise(resolve=>browser.runtime.onMessage.emit({type:'palside/command',command:{name,payload}},panelSender,resolve)),update:patch=>{state={...state,...patch,...(patch.preferences?{preferences:{siteInteraction:quiet,...patch.preferences}}:{})};broadcast();},dispose:()=>observer.dispose(),identities:()=>calls.filter(c=>c.name==='page'&&c.payload?.identity),activities:()=>calls.filter(c=>c.name==='page'&&c.payload?.activity)};
}
test('worker restart restores observation from the runtime snapshot without claiming fresh device activity',async t=>{
 const f=fixture({broadcastState:false,helloActivity:false});t.after(f.dispose);await until(()=>f.identities().length>=2);
 assert.equal(f.identities().length,2);assert.equal(f.identities()[0].payload.identity.url,'https://x.com');
 assert.equal(f.activities().length,0);
});
test('initial panel activity waits for hydration but a background window cannot claim device selection',async t=>{
 const opened=fixture({broadcastState:false});t.after(opened.dispose);await wait();
 assert.equal(opened.identities().length,2);assert.equal(opened.activities().length,1);
 const hidden=fixture({broadcastState:false});t.after(hidden.dispose);hidden.controls.focused=false;await wait();
 assert.equal(hidden.identities().length,0);assert.equal(hidden.activities().length,0);
});
test('late startup snapshot cannot replace newer logout state or revive a disconnected panel',async t=>{
 let finish;
 const f=fixture({broadcastState:false,snapshot:()=>new Promise(resolve=>{finish=resolve;})});t.after(f.dispose);
 await wait();
 f.update({authenticated:false,account:undefined});
 const latest=f.messages.at(-1).state;
 finish({ok:true,value:{...latest,authenticated:true,account:{id:'old'}}});await wait();
 assert.equal(f.messages.at(-1).state.authenticated,false);assert.equal(f.identities().length,0);
 let disconnectedFinish;
 const closed=fixture({broadcastState:false,snapshot:()=>new Promise(resolve=>{disconnectedFinish=resolve;})});t.after(closed.dispose);
 await wait();const deliveredBeforeDisconnect=closed.messages.length;closed.port.onDisconnect.emit();disconnectedFinish({ok:true,value:latest});await wait();
 assert.equal(closed.messages.length,deliveredBeforeDisconnect);assert.equal(closed.identities().length,0);
});
test('actual worker observes only an eligible foreground URL without any injection or website request',async t=>{
 const f=fixture();t.after(f.dispose);await wait();
 assert.equal(f.identities().length,2);assert.equal(f.identities()[0].payload.identity.url,'https://x.com');
 assert.equal(f.identities()[0].payload.title,'PRIVATE TITLE');
 assert.doesNotMatch(JSON.stringify(f.identities()),/secret-post|tracking/);
 const count=f.identities().length;f.update({preferences:{current:'one',share:false}});await wait();assert.equal(f.identities().length,count);
 assert.equal(f.calls.at(-1).payload.clear,true);
});
test('automatic observation needs no site grant and no tabs check of its own: the 共享在看 switch alone starts and clears it', async t => {
 const f = fixture(); t.after(f.dispose); await wait();
 assert.equal(f.identities().length, 2);
 assert.equal(f.controls.permissionChecks.includes('tabs'), false);
 f.update({ preferences: { current: 'one', share: false } }); await wait(); await wait();
 assert.equal(f.calls.at(-1).payload.clear, true);
 f.update({ preferences: { current: 'one', share: true } }); await wait(); await wait();
 assert.equal(f.identities().length, 4);
 assert.equal(f.controls.permissionChecks.includes('tabs'), false);
});
test('SPA navigation refreshes identity without claiming device activity; locked and closed panels publish nothing',async t=>{
 const f=fixture();t.after(f.dispose);await wait();const activities=f.activities().length;
 f.controls.tab.url='https://x.com/another';f.browser.tabs.onUpdated.emit(1,{url:f.controls.tab.url},f.controls.tab);await wait();
 assert.equal(f.activities().length,activities);assert.equal(f.identities().length,4);
 f.controls.locked=true;f.browser.idle.onStateChanged.emit('locked');await wait();assert.equal(f.identities().length,4);
 f.controls.locked=false;f.port.onDisconnect.emit();await wait();assert.equal(f.identities().length,4);
});
test('service unavailability stops automatic sharing without claiming device offline',async t=>{
 const f=fixture();t.after(f.dispose);await wait();
 const count=f.identities().length;f.update({connection:{networkOnline:true,service:'unavailable',messaging:'ready',retrying:false}});await wait();
 assert.equal(f.identities().length,count);assert.equal(f.calls.at(-1).payload.clear,true);
});
test('link-card builds token and website cards locally and rejects non-http URLs',async t=>{
 const f=fixture();t.after(f.dispose);
 const tokenUrl='https://gmgn.ai/robinhood/token/0x39dbed3a2bd333467115de45665cc57f813c4571';
 const token=await f.command('link-card',{url:tokenUrl});
 assert.equal(token.ok,true);assert.equal(token.value.attachment.kind,'asset');
 assert.equal(token.value.attachment.view.chain,'Robinhood');
 assert.equal(token.value.attachment.view.address,'0x39dbed3a2bd333467115de45665cc57f813c4571');
 f.controls.tab.url='https://x.com/secret-post?tracking=private';
 const site=await f.command('link-card',{url:'https://example.com/articles/1'});
 assert.equal(site.value.attachment.view.name,'example.com');
 assert.equal(site.value.attachment.view.source,'example.com');
 assert.match(site.value.attachment.view.logo,/^data:image\/png/);
 // Without 共享在看's icon permission the website card carries no page icon.
 f.controls.favicon=false;
 const plain=await f.command('link-card',{url:'https://example.org/articles/1'});
 assert.equal(plain.value.attachment.view.name,'example.org');
 assert.equal(plain.value.attachment.view.logo,undefined);
 const rejected=await f.command('link-card',{url:'chrome://settings'});
 assert.equal(Object.keys(rejected.value).length,0);
});
test('共享在看 is independent of 网页互动 and follows every public host', async t => {
  const f = fixture(); t.after(f.dispose); await wait();
  const count = f.identities().length;
  f.controls.tab.url = 'https://custom.example.com/page';
  f.update({ preferences: { current: 'one', share: false, siteInteraction: { 'custom.example.com': { on: true } } } });
  await wait(); assert.equal(f.identities().length, count);
  f.update({ preferences: { current: 'one', share: true, siteInteraction: { 'custom.example.com': { on: false } } } });
  await wait(); assert.equal(f.identities().length, count + 2);
  assert.equal(f.identities().at(-1).payload.identity.host, 'custom.example.com');
  f.controls.tab.url = 'https://sub.custom.example.com/page';
  f.browser.tabs.onUpdated.emit(1, { url: f.controls.tab.url }, f.controls.tab);
  await wait(); assert.equal(f.identities().length, count + 4);
  assert.equal(f.identities().at(-1).payload.identity.host, 'sub.custom.example.com');
});

test('禁用 共享在看 stops observation even while the switch state is on', async t => {
  const f = fixture(); t.after(f.dispose);
  await wait(); const before = f.identities().length;
  assert.ok(before > 0);
  f.update({ preferences: { current: 'one', share: false } });
  await wait(); await wait();
  assert.ok(f.calls.some(c => c.name === 'page' && c.payload?.clear), 'clears the viewing state');
  f.controls.tab.url = 'https://x.com/another'; f.browser.tabs.onUpdated.emit(1, { url: f.controls.tab.url }, f.controls.tab);
  await wait(); assert.equal(f.identities().length, before);
});
test('a 共享在看 switch that replies before its state still claims this device once sharing turns on', async t => {
  const f = fixture(); t.after(f.dispose);
  await wait(); f.update({ preferences: { current: 'one', share: false } }); await wait();
  const activities = f.activities().length;
  // The runtime replies to the switch first; the state that turns sharing on follows.
  assert.equal((await f.command('toggle', { share: true })).ok, true); await wait();
  f.update({ preferences: { current: 'one', share: true } }); await wait(); await wait();
  assert.equal(f.activities().length, activities + 1);
  // A later change with no command of this panel behind it claims nothing.
  f.update({ preferences: { current: 'one', share: false } }); await wait(); f.update({ preferences: { current: 'one', share: true } }); await wait(); await wait();
  assert.equal(f.activities().length, activities + 1);
});
test('Chrome taking back the tabs permission switches 共享在看 off with a reason, only while it is on', async t => {
  const f = fixture(); t.after(f.dispose); await wait();
  const toggles = () => f.calls.filter(c => c.name === 'toggle');
  f.browser.permissions.onRemoved.emit({ permissions: ['tabs'], origins: [] }); await wait();
  assert.deepEqual(toggles().map(c => c.payload), [{ share: false, revoked: true }]);
  f.update({ preferences: { current: 'one', share: false } }); await wait();
  f.browser.permissions.onRemoved.emit({ permissions: ['tabs'], origins: [] }); await wait();
  assert.equal(toggles().length, 1);
});

test('a replacement offscreen epoch replays live panels, room tab, page context and device activity', async t => {
 const f=fixture({helloActivity:false,site:true});t.after(f.dispose);
 f.controls.tab.url='https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111';
 f.browser.tabs.onActivated.emit({windowId:10});await wait();await wait();
 const sender={id:'qa',url:'chrome-extension://qa/offscreen.html'};
 const ready=epoch=>f.browser.runtime.onMessage.emit({type:'palside/runtime-ready',epoch},sender,()=>{});
 ready('first');await wait();await wait();
 const count=f.calls.length;ready('replacement');await wait();await wait();
 const replay=f.calls.slice(count);
 assert.ok(replay.some(c=>c.name==='room-tab'&&c.payload.asset==='Ethereum:0x1111111111111111111111111111111111111111'));
 assert.ok(replay.some(c=>c.name==='room-panels'&&c.payload.connected===true));
 assert.ok(replay.some(c=>c.name==='device-state'&&c.payload.state==='active'));
 assert.ok(replay.some(c=>c.name==='page'&&c.payload.identity?.host==='gmgn.ai'));
 assert.equal(replay.some(c=>c.name==='page'&&c.payload.activity),false);
 const after=f.calls.length;ready('replacement');await wait();assert.equal(f.calls.length,after);
});

test('account reset replays the same room tab and panel connection without reconnecting the port', async t => {
 const f=fixture({helloActivity:false,site:true});t.after(f.dispose);
 f.controls.tab.url='https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111';
 f.browser.tabs.onActivated.emit({windowId:10});await wait();await wait();
 const before=f.calls.length;f.update({account:undefined,authenticated:false});await wait();await wait();
 const replay=f.calls.slice(before);
 assert.ok(replay.some(c=>c.name==='room-tab'&&c.payload.asset==='Ethereum:0x1111111111111111111111111111111111111111'));
 assert.ok(replay.some(c=>c.name==='room-panels'&&c.payload.connected));
 assert.ok(replay.some(c=>c.name==='device-state'&&c.payload.state==='active'));
});

test('offscreen start errors reach existing panels', async t => {
 const f=fixture();t.after(f.dispose);await wait();
 f.browser.runtime.onMessage.emit({type:'palside/runtime-error',message:{key:'extension.runtime.runtimeStartFailed'}},{id:'qa',url:'chrome-extension://qa/offscreen.html'},()=>{});
 assert.ok(f.messages.some(m=>m.type==='error'&&m.message.key==='extension.runtime.runtimeStartFailed'));
});
test('visible-message sources belong to the panel document and close with its port',async t=>{
 const f=fixture();t.after(f.dispose);await wait();
 await f.command('visible',{teamId:'one',sourceId:'chat',ids:['m1']});
 assert.equal(f.calls.find(c=>c.name==='visible')?.payload.sourceId,'panel:chat');
 const forged=await f.command('visible-drop',{panel:'other'});
 assert.equal(forged.ok,false);assert.equal(f.calls.some(c=>c.name==='visible-drop'),false);
 f.port.onDisconnect.emit();await wait();
 assert.deepEqual(f.calls.filter(c=>c.name==='visible-drop').map(c=>c.payload),[{panel:'panel'}]);
});

test('room view subscriptions belong to their panel document', async t => {
 const f = fixture(); t.after(f.dispose); await wait();
 const view = 'token:Solana:So11111111111111111111111111111111111111112';
 await f.command('room-watch', { id: 'summary', view });
 assert.deepEqual(f.calls.find(c => c.name === 'room-watch')?.payload, { id: 'panel:summary', view });
 await f.command('room-watch', { id: 'summary' });
 assert.deepEqual(f.calls.filter(c => c.name === 'room-watch').at(-1)?.payload, { id: 'panel:summary' });
});

test('worker replay and initial activity use the same five-minute idle threshold', async () => {
  const thresholds = [];
  const f = fixture();
  f.browser.idle.queryState = async seconds => { thresholds.push(seconds); return 'active'; };
  f.browser.runtime.onMessage.emit({ type: 'palside/runtime-ready', epoch: 'new-runtime' }, { id: 'qa', url: 'chrome-extension://qa/offscreen.html' }, () => {});
  await wait(); f.dispose();
  assert.ok(thresholds.length > 0); assert.ok(thresholds.every(seconds => seconds === 300));
});
