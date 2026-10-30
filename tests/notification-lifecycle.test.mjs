import { addBackgroundHost, startWorker, stateSender } from './helpers/background-host.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget } from '../apps/extension/src/runtime/chat/notification-policy.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => Promise.withResolvers();
function event() { const listeners=[]; return {addListener(fn){listeners.push(fn);},emit(...args){for(const fn of listeners)fn(...args);}}; }
function snapshot(account='alice') { return { authenticated:true,connection:{networkOnline:true,service:'ready',messaging:'ready',retrying:false},account:{id:account},preferences:{notifications:'all',notificationPreview:true,web:{share:true,interact:true}},toggles:{share:false,interact:false},data:{people:[{id:'friend',name:'Friend'}],messages:[{id:'message',teamId:'team',author:'friend',status:'sent',text:'private preview',expiresAt:Date.now()+60000}]},remoteTeams:[{id:'team',name:'Team',joined:true,preferences:{muted:false,readIds:[]}}] }; }
function fixture() {
  const records={}, active={}, created=[], commands=[]; const controls={permission:async()=>true,read:async()=>{},write:async()=>{},create:async()=>{}};
  const browser={
    runtime:{id:'qa',getURL:p=>`chrome-extension://qa${p}`,getContexts:async()=>[{}],sendMessage:async({command})=>{commands.push(command);return{ok:true};},onMessage:event(),onMessageExternal:event(),onConnect:event(),onInstalled:event()},
    tabs:{onActivated:event(),onUpdated:event(),onRemoved:event()},windows:{onRemoved:event(),onFocusChanged:event(),getLastFocused:async()=>({id:10})},sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},action:{onClicked:event()},idle:{onStateChanged:event(),queryState:async()=>'active'},
    permissions:{contains:()=>controls.permission(),onAdded:event(),onRemoved:event()},storage:{local:{set:async value=>{await controls.write();Object.assign(records,value);},get:async id=>{await controls.read();return{[id]:records[id]};},remove:async id=>{delete records[id];}}},
    notifications:{create:async(id,options)=>{created.push({id,options});await controls.create();active[id]={};return id;},getAll:async()=>({...active}),clear:async id=>{delete active[id];return true;},onClicked:event(),onClosed:event()},
  };
  addBackgroundHost(browser);
 startWorker(browser);
  const sender={id:'qa',url:'chrome-extension://qa/offscreen.html'};
  const sendState = stateSender(browser, sender);
  return {browser,controls,records,active,created,commands,state:sendState,notify(){browser.runtime.onMessage.emit({type:'palside/notify',payload:{accountId:'alice',messageId:'message',teamId:'team',title:'Team',message:'private preview',preview:true}},sender,()=>{});}};
}

test('notification permission lookup cannot carry an old account preview into a new account',async()=>{const f=fixture();f.state(snapshot());await tick();const gate=deferred();f.controls.permission=()=>gate.promise;f.notify();await tick();f.state(snapshot('bob'));gate.resolve(true);await tick();await tick();assert.equal(f.created.length,0);assert.equal(Object.keys(f.records).length,0);});
test('logout during notification metadata storage suppresses creation and removes late metadata',async()=>{const f=fixture();f.state(snapshot());await tick();const gate=deferred();f.controls.write=()=>gate.promise;f.notify();await tick();f.state({...snapshot(),authenticated:false});await tick();gate.resolve();await tick();await tick();assert.equal(f.created.length,0);assert.equal(Object.keys(f.records).length,0);});
test('a notification already being created is cleared if its message is recalled meanwhile',async()=>{const f=fixture();f.state(snapshot());await tick();const gate=deferred();f.controls.create=()=>gate.promise;f.notify();await tick();assert.equal(f.created.length,1);const next=snapshot();next.data.messages[0].recalled=true;f.state(next);await tick();gate.resolve();await tick();await tick();assert.equal(Object.keys(f.active).length,0);assert.equal(Object.keys(f.records).length,0);});
test('closing a native notification removes its local navigation record',async()=>{const f=fixture();f.state(snapshot());await tick();f.notify();await tick();const id=f.created[0].id;assert.ok(f.records[id]);f.browser.notifications.onClosed.emit(id,true);await tick();assert.equal(f.records[id],undefined);});
test('notification policy rechecks unread, mute, reply scope, expiry and preview preference',()=>{const id={accountId:'alice',messageId:'message',teamId:'team',preview:true};const state=snapshot();assert.ok(notificationTarget(state,id));state.remoteTeams[0].preferences.muted=true;assert.equal(notificationTarget(state,id),undefined);state.remoteTeams[0].preferences.muted=false;state.remoteTeams[0].preferences.readIds=["message"];assert.equal(notificationTarget(state,id),undefined);state.remoteTeams[0].preferences.readIds=[];state.preferences.notificationPreview=false;assert.equal(notificationTarget(state,id),undefined);state.preferences.notificationPreview=true;state.data.messages[0].expiresAt=Date.now()-1;assert.equal(notificationTarget(state,id),undefined);state.data.messages[0].expiresAt=Date.now()+60000;state.preferences.notifications='mentions';state.data.messages[0].replyTo='self';state.data.messages.push({id:'self',teamId:'other',author:'alice'});assert.equal(notificationTarget(state,id),undefined);state.data.messages[1].teamId='team';assert.ok(notificationTarget(state,id));});

test('click routing retains metadata through an overlapping close event and then clears it',async()=>{const f=fixture();f.state(snapshot());await tick();f.notify();await tick();const id=f.created[0].id;const gate=deferred();f.controls.read=()=>gate.promise;f.browser.notifications.onClicked.emit(id);f.browser.notifications.onClosed.emit(id,false);gate.resolve();await tick();await tick();assert.equal(f.commands.find(command=>command.name==='notification-open')?.payload.accountId,'alice');assert.equal(f.records[id],undefined);assert.equal(Object.keys(f.active).length,0);});

test('notification records without a known preview choice are cleared conservatively',()=>{assert.equal(notificationTarget(snapshot(),{accountId:'alice',messageId:'message',teamId:'team'}),undefined);});
