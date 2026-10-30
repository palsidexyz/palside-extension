import { IntegrationIntl } from './intl';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MatrixEvent } from 'matrix-js-sdk';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import { PalsideApp } from './preview-app';
import { palsideFixtures, demoSites, remoteTeam } from './fixtures';
import { autoRun, reviewStatus } from './review-harness';
import { emptyDraft } from '../src/domain/chat/model';
import type { RuntimeDevice } from '../src/runtime/account/device';
import type { LivePort } from '../src/features/palside/app/live-port';
import '@palside/design/fonts.css';
import '../src/styles.css';

const root=createRoot(document.getElementById('root')!), output=document.getElementById('result')!;
const result:{checks:string[];error?:string;cleaned?:boolean}={checks:[]};
const databaseName=`palside-retention-ui-${crypto.randomUUID()}`, storage=new ClientStorage(databaseName);
const service=new PalsideService(undefined,undefined,storage), {auth,cache}=service;
const now=Date.now(), day=86400000, teamId='night', imageId='$qa-expiry-image', cardId='$qa-expiry-card', linkId='$qa-expiry-link';
const session:RuntimeDevice={token:'synthetic-only',storageKey:[],account:{ bio: '', tags: [], id:'you',nickname:'验收成员',matrixId:'@qa:example.test',avatarId:null,revision:1, acceptTeamInvites: true},matrix:{userId:'@qa:example.test',deviceId:'fixture-device'}};
const imageKey=`${session.account.id}:cache:media:event:${imageId}`;
let imageUrl='', unsubscribe=()=>{};
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);result.checks.push(message);}
function report(){output.textContent=JSON.stringify(result,null,2);}
async function rawKeys(){const db=await (storage as unknown as {database:Promise<IDBDatabase>}).database;return new Promise<IDBValidKey[]>((resolve,reject)=>{const request=db.transaction('records').objectStore('records').getAllKeys();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function until(check:()=>boolean){const end=Date.now()+10000;while(!check()){if(Date.now()>end)throw Error('Client cleanup timer did not finish');await new Promise(resolve=>setTimeout(resolve,100));}}
async function prepare(){
  auth.maintainConnection=async()=>{};service.sharing.publishViewing=async()=>{};
  service.api.request=async<T,>()=>({ websiteUrl: '', signupDifficulty: 0 }) as T;
  await service.initialise();auth.session=session;
  const data=structuredClone(palsideFixtures);data.teams=data.teams.filter(t=>t.id===teamId);data.teams[0]={...data.teams[0]!,owner:'you',memberIds:['you'],unread:0};data.people=data.people.filter(p=>p.id==='you').map(p=>({...p,viewing:undefined}));data.requests=[];
  const asset=data.views.find(view=>view.kind==='asset')!;data.views=[asset];
  Object.assign(service.state,{authenticated:true,account:session.account,data,preferences:{web:{share:true,interact:true},current:teamId,notifications:'off'},remoteTeams:[remoteTeam({id:teamId,roomId:'!retention:example.test',periods:[{joinedAt:now-40*day,leftAt:null}],people:[{ bio: '', tags: [], deleted: false, id:'you',nickname:'验收成员',avatarId:null,matrixId:session.account.matrixId}],memberIds:['you']})]});
  const blob=await (await fetch('/avatars/avatar-frog.webp')).blob();imageUrl=await cache.cachedMedia(`event:${imageId}`,async()=>blob,()=>now+day);
  data.messages=[{id:imageId,teamId,author:'you',text:'临期图片说明',time:'12:00',status:'sent',attachment:{kind:'image',name:'fox.webp',src:imageUrl}},{id:cardId,teamId,author:'you',text:'临期代币说明',time:'12:01',status:'sent',attachment:{kind:'asset',assetId:asset.id,view:asset}},{id:linkId,teamId,author:'you',text:'临期链接 https://example.com/',time:'12:02',status:'sent'},{id:'$qa-reply',teamId,author:'you',text:'回复正文应保留',time:'12:03',status:'sent',replyTo:imageId}];
  for(const message of data.messages){const time=message.id==='$qa-reply'?now:now-29*day;cache.eventTimes.set(message.id,time);await cache.cacheMessage(message,time);}
  service.state.drafts[teamId]=await storage.updateDraft('you',teamId,{text:'保留的未发送草稿'},0,emptyDraft);
  const command:LivePort['command']=async(...[name])=>{if(name==='visible'||name==='dismiss-notice'||name==='history')return undefined as never;throw Error(`This isolated fixture does not execute ${name}`);};
  unsubscribe=service.subscribe(state=>root.render(<IntegrationIntl><PalsideApp data={state.data} sites={demoSites} live={{state,command,openPage:async()=>{}}} deliver={async()=>{}}/></IntegrationIntl>));
  check((await rawKeys()).includes(imageKey),'Initial image Blob is persisted in the isolated database');report();
}
async function act(action:()=>Promise<void>){try{await action();}catch(error){result.error=String(error);}report();}
const expire=async()=>{
  const deadline=Date.now()-1;
  for(const id of [imageId,cardId,linkId]){cache.eventTimes.set(id,deadline-30*day);const key=`you:cache:${id}`,value=await storage.get(key);await storage.put(key,'you','cache',value,deadline);}
  const blob=await storage.get(imageKey);await storage.put(imageKey,'you','cache',blob,deadline);
  const reply=service.state.data.messages.find(m=>m.id==='$qa-reply');if(reply)reply.replyToExpiresAt=deadline;
  cache.lastCleanup=0;await until(()=>!service.state.data.messages.some(m=>[imageId,cardId,linkId].includes(m.id)));
  const keys=await rawKeys();check(!keys.some(key=>[imageKey,...[imageId,cardId,linkId].map(id=>`you:cache:${id}`)].includes(String(key))),'Actual periodic cleanup deletes expired message and Blob records');
  check(!cache.mediaUrls.has(`event:${imageId}`)&&await fetch(imageUrl).then(()=>false,()=>true),'Expired image object URL is revoked');
  check(service.state.data.messages.some(m=>m.id==='$qa-reply')&&service.state.data.views.length===0,'Reply survives while expired card views are removed');
  check((await storage.get<{value:{text:string}}>('you:draft:night'))?.value.text==='保留的未发送草稿','Content expiry preserves the unsent draft');
};
const recall=async()=>{
  await service.timeline.consume(new MatrixEvent({event_id:'$qa-redaction',room_id:'!retention:example.test',sender:'@service:example.test',type:'m.room.redaction',origin_server_ts:Date.now(),redacts:imageId,content:{reason:'author'}}));
  check(service.state.data.messages.find(m=>m.id===imageId)?.recalled,'Redaction leaves the message placeholder');
  check(!(await rawKeys()).includes(imageKey)&&!cache.mediaUrls.has(`event:${imageId}`),'Redaction deletes the Blob record and revokes its object URL');
  check(service.state.data.messages.some(m=>m.id===cardId)&&service.state.drafts[teamId]?.value.text==='保留的未发送草稿','Redaction preserves unrelated content and draft');
};
const finish=async()=>{clearInterval(auth.timer);unsubscribe();await auth.clearDevice();root.unmount();const db=await(storage as unknown as {database:Promise<IDBDatabase>}).database;db.close();await new Promise<void>((resolve,reject)=>{const req=indexedDB.deleteDatabase(databaseName);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error(`Fixture database cleanup blocked: ${databaseName}`));});result.cleaned=true;};
document.getElementById('expire')!.onclick=()=>void act(expire);
document.getElementById('recall')!.onclick=()=>void act(recall);
document.getElementById('finish')!.onclick=()=>void act(finish);
// Recall first: expiry removes the image the redaction step targets.
void prepare().then(async()=>{if(!autoRun)return;for(const step of [recall,expire,finish])await act(step);reviewStatus(result.error?'failed':'passed');}).catch(error=>{result.error=String(error);report();reviewStatus('failed');});
