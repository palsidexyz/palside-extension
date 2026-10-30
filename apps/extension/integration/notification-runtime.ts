import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeDevice } from '../src/runtime/account/device';
import type { Message } from '../src/domain/chat/model';
import { remoteTeam } from './fixtures';
import { autoRun, reviewStatus } from './review-harness';
const button=document.querySelector<HTMLButtonElement>('#run')!,output=document.querySelector<HTMLPreElement>('#result')!;
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
const run=async()=>{
  button.disabled=true;const result:{checks:string[];cleaned?:boolean;error?:string}={checks:[]};
  const fixtures:{storage:ClientStorage;service:PalsideService;name:string}[]=[];
  async function fixture(){
    const name=`palside-notification-qa-${crypto.randomUUID()}`,storage=new ClientStorage(name),notifications:Record<string,unknown>[]=[];
    const service=new PalsideService(async payload=>{notifications.push(payload);},undefined,storage);
    fixtures.push({storage,service,name});const now=Date.now(),key='alice:notified:event';
    const session:RuntimeDevice={token:'test-only',storageKey:[],account:{ bio: '', tags: [], id:'alice',nickname:'Alice',matrixId:'@alice:example.test',avatarId:null,revision:1, acceptTeamInvites: true},matrix:{userId:'@alice:example.test',deviceId:'qa'}};
    service.auth.session=session;service.auth.receiveSince=now-1000;service.state.authenticated=true;service.state.account=session.account;service.state.preferences.notifications='all';service.state.preferences.notificationPreview=true;
    service.state.remoteTeams=[remoteTeam({id:'team',roomId:'!team:example.test',name:'QA team'})];
    const message:Message={id:'event',teamId:'team',author:'friend',status:'sent',time:'12:00',text:'private preview',expiresAt:now+60000,liveArrival:true};service.state.data.messages=[message];service.state.data.people=[{id:'friend',name:'Friend',color:'#fff'}];
    return{storage,service,notifications,message,now,key};
  }
  try{
    {
      const f=await fixture(),entered=deferred<void>(),release=deferred<void>(),get=f.storage.get.bind(f.storage);
      f.storage.get=async<T,>(key:string)=>{if(key===f.key){entered.resolve();await release.promise;}return get<T>(key);};
      const pending=f.service.timeline.notifyMessage(f.message,f.now);await entered.promise;await f.service.auth.clearDevice();release.resolve();
      // Logout cancels the delivery in flight; only its absence of side effects matters.
      await pending.catch(()=>{});
      check(f.notifications.length===0&&!await f.storage.get(f.key),'Logout during lookup recreated a notification or its local record');result.checks.push('Logout during IndexedDB lookup produces no notification or stale notification record');
    }
    {
      const f=await fixture(),entered=deferred<void>(),release=deferred<void>(),put=f.storage.put.bind(f.storage);
      f.storage.put=async<T,>(key:string,account:string,kind:string,value:T,expires?:number)=>{if(key===f.key){entered.resolve();await release.promise;}return put(key,account,kind,value,expires);};
      const pending=f.service.timeline.notifyMessage(f.message,f.now);await entered.promise;f.message.recalled=true;release.resolve();await pending;
      check(f.notifications.length===0&&!await f.storage.get(f.key),'Recall during persistence retained a preview or dedupe record');result.checks.push('Recall during IndexedDB persistence suppresses the preview and removes the late record');
    }
    {
      const f=await fixture(),entered=deferred<void>(),release=deferred<void>(),get=f.storage.get.bind(f.storage);let reads=0;
      f.storage.get=async<T,>(key:string)=>{if(key===f.key){reads++;entered.resolve();await release.promise;}return get<T>(key);};
      const first=f.service.timeline.notifyMessage(f.message,f.now);await entered.promise;const second=f.service.timeline.notifyMessage(f.message,f.now);release.resolve();await Promise.all([first,second]);
      check(reads===1&&f.notifications.length===1,'Concurrent delivery duplicated the native notification');result.checks.push('Concurrent delivery for the same message notifies once');
    }
    {
      const f=await fixture(),entered=deferred<void>(),release=deferred<void>(),get=f.storage.get.bind(f.storage);
      f.storage.get=async<T,>(key:string)=>{if(key===f.key){entered.resolve();await release.promise;}return get<T>(key);};
      const pending=f.service.timeline.notifyMessage(f.message,f.now);await entered.promise;f.service.timeline.visibleMessages.add(f.message.id);release.resolve();await pending;
      check(f.notifications.length===0,'A message read during lookup still notified');result.checks.push('Reading the message during lookup suppresses notification');
    }
    {
      const f=await fixture(),entered=deferred<void>(),release=deferred<void>(),put=f.storage.put.bind(f.storage);
      f.storage.put=async<T,>(key:string,account:string,kind:string,value:T,expires?:number)=>{if(key===f.key){entered.resolve();await release.promise;}return put(key,account,kind,value,expires);};
      const pending=f.service.timeline.notifyMessage(f.message,f.now);await entered.promise;f.service.state.preferences.notificationPreview=false;release.resolve();await pending;
      check(f.notifications.length===1&&f.notifications[0]?.preview===false&&!String(f.notifications[0]?.message).includes(f.message.text),'Preview disable leaked the old body');result.checks.push('Disabling preview while persistence waits sends only the current generic notice');
    }
    {
      const f=await fixture();f.service.initialise=async()=>{};f.message.expiresAt=Date.now()-1;
      const refused=await f.service.command({name:'notification-open',payload:{accountId:'alice',teamId:'team',messageId:'event',windowId:1}}).then(()=>false,()=>true);
      check(refused&&!f.service.state.jumpMessageId,'Expired notification routed before the next cleanup tick');result.checks.push('Expired notification cannot navigate during the interval before periodic cleanup');
    }
  }catch(error){result.error=String(error);}
  finally{
    for(const f of fixtures){await f.service.auth.clearDevice();const db=await(f.storage as unknown as{database:Promise<IDBDatabase>}).database;db.close();await new Promise<void>((resolve,reject)=>{const req=indexedDB.deleteDatabase(f.name);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
    result.cleaned=true;output.textContent=JSON.stringify(result,null,2);button.disabled=false;
    reviewStatus(result.error?'failed':'passed');
  }
};
button.onclick=()=>void run();
if(autoRun)void run();
