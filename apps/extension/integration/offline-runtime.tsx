import { IntegrationIntl } from './intl';
import { connectionStatus } from '../src/runtime/transport/connection';
import React from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { createRoot } from 'react-dom/client';
import { PalsideService } from '../src/runtime/composition/core';
import { ApiError } from '../src/runtime/transport/api';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeDevice } from '../src/runtime/account/device';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';
import { PalsideApp } from './preview-app';
import { siteCatalog } from '../src/features/palside/settings/site-catalog';
import '@palside/design/fonts.css';
import '../src/styles.css';
import { reviewStatus } from './review-harness';
import { VAULT_ITERATIONS, VAULT_VERSION } from '@palside/shared/identity';

const root = createRoot(document.getElementById('root')!);
const checks: string[] = [];
function check(value: unknown, text: string): asserts value { if (!value) throw new Error(text); checks.push(text); }
async function run() {
  const databaseName = `palside-offline-qa-${crypto.randomUUID()}`;
  const storage = new ClientStorage(databaseName);
  const first = new PalsideService(undefined, undefined, storage);
  const second = new PalsideService(undefined, undefined, storage);
  const third = new PalsideService(undefined, undefined, storage);
  const services = [first, second, third];
  for (const service of services) {
    service.auth.connectLiveEvents = () => () => {};
    service.state.config = { ...service.state.config, websiteUrl: 'https://palside.test' };
  }
  const initialiseCrypto = MatrixClient.prototype.initRustCrypto;
  const now = Date.now();
  const session: RuntimeDevice = { token:'test-only',crypto:'ready',storageKey:[],matrix:{userId:'@offline:local.test',deviceId:'test-device'},account:{ bio: '', tags: [], id:'offline-person',nickname:'离线测试成员',avatarId:null,matrixId:'@offline:local.test',revision:1, acceptTeamInvites: true} };
  // Startup checks the vault's format; its contents are never opened here.
  const vault = { v: VAULT_VERSION, iterations: VAULT_ITERATIONS, salt: 'A'.repeat(22) + '==', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(22) + '==' };
  const team: TeamSnapshot = { reason: null, revision: 0, inviteSuspended: false, id:'offline-team',name:'离线查看的小队',description:'',ownerId:session.account.id,roomId:'!synthetic:local.test',avatarId:null,memberCount:1,joined:true,publishedAt:null,recruitmentExpiresAt:null,retentionDays:7,memberIds:[session.account.id],people:[{ bio: '', tags: [], deleted: false, id:session.account.id,nickname:session.account.nickname,avatarId:null,matrixId:session.account.matrixId}],periods:[{joinedAt:now-10000,leftAt:null}],preferences:{muted:false,readIds:[],revision:1},requests:[],bans:[],transfer:null, membersCanInvite: false };
  try {
    MatrixClient.prototype.initRustCrypto = async () => {};
    first.auth.session = session;
    first.api.request = async <T,>() => ({account:session.account,teams:[team],presence:{[session.account.id]:'active'}}) as T;
    await storage.put('device',session.account.id,'device',session);await storage.put('vault',session.account.id,'vault',vault);
    await first.refresh();
    const directory = await storage.get<{people: {presence?:'active'|'away'}[]}>(`${session.account.id}:cache:directory`);
    check(directory && !directory.people.some(p=>p.presence!==undefined),'Successful snapshot saves display metadata without presence');
    await storage.updateDraft(session.account.id,team.id,{text:'关闭服务后仍保留的草稿'},0,{text:''});
    await storage.cache(session.account.id,'$offline-message',{message:{id:'$offline-message',teamId:team.id,author:session.account.id,text:'这是本机已保存的消息',time:'12:00',status:'sent'},views:[],timestamp:now},now+86400000);
    let rejectNetwork!: (reason: unknown)=>void;
    const network = new Promise<never>((_,reject)=>{rejectNetwork=reject;});
    second.api.request = async <T,>() => await network as T;
    let ready!: ()=>void; const visible=new Promise<void>(resolve=>{ready=resolve;});
    second.subscribe(state=>{if(state.ready) ready();});
    const startup=second.initialise(); await visible;
    check(second.state.ready && second.state.data.teams[0]?.id===team.id,'Cached conversation is visible before network request completes');
    check(second.state.data.messages[0]?.text==='这是本机已保存的消息' && second.state.drafts[team.id]?.value.text==='关闭服务后仍保留的草稿','Cold startup restores cached messages and draft');
    check(second.state.data.self===session.account.id && second.state.remoteTeams.length===0 && second.state.connection.service === 'connecting','Cached identity never grants server permissions or claims online');
    rejectNetwork(new ApiError(0,{error:'SERVICE_UNAVAILABLE'})); await startup;
    check(second.state.connection.networkOnline && connectionStatus(second.state.connection) === 'service-unavailable', 'Failed service request does not claim browser offline');
    clearInterval(second.auth.timer);
    const cached = structuredClone(second.state); cached.error=undefined;
    second.api.request = async <T,>()=>({account:session.account,teams:[{...team,joined:false,reason:'removed',periods:[]}],presence:{}}) as T;
    await second.refresh();
    check(second.state.data.teams[0]?.readonly && second.state.data.messages.length===0,'Recovery applies current membership and removes inaccessible messages');
    check(!await storage.get(`${session.account.id}:cache:$offline-message`),'Inaccessible messages cannot return from storage on another offline startup');
    second.auth.directoryExpiresAt=now-1; await second.cache.expireLocalContent();
    check(second.state.data.teams.length===0,'Expired restored directory stops rendering');
    await second.auth.clearDevice();
    check(!await storage.get(`${session.account.id}:cache:directory`) && !(await storage.rows(session.account.id,'draft')).length,'Logout removes directory and drafts');
    await storage.put('device',session.account.id,'device',session);await storage.put('vault',session.account.id,'vault',vault);
    third.api.request=async()=>{throw new ApiError(0,{error:'SERVICE_UNAVAILABLE'});};
    await third.initialise(); clearInterval(third.auth.timer);
    check(third.state.ready && third.state.data.people[0]?.name===session.account.nickname && !third.state.data.teams.length,'No-cache startup retains account identity for settings');
    const empty=structuredClone(third.state); empty.error=undefined;
    const state=new URLSearchParams(location.search).get('scene')==='cached'?cached:empty;
    if (new URLSearchParams(location.search).get('scene') === 'settings') state.preferences.notifications = 'all';
    root.render(<IntegrationIntl><div style={{height:'100dvh'}}><PalsideApp data={state.data} sites={siteCatalog} live={{state,command:async(...[name])=>{if(name==='reconnect') throw new ApiError(0,{error:'SERVICE_UNAVAILABLE'}); return undefined as never;},openPage:async()=>{}}} deliver={async()=>{}}/><script type="application/json" id="offline-result">{JSON.stringify({checks,passed:true})}</script></div></IntegrationIntl>);
  } finally {
    MatrixClient.prototype.initRustCrypto = initialiseCrypto;
    for(const service of services) clearInterval(service.auth.timer);
    await storage.clearAccount(session.account.id,false);
    const database = await (storage as unknown as {database:Promise<IDBDatabase>}).database; database.close();
    await new Promise<void>((resolve,reject)=>{const deletion=indexedDB.deleteDatabase(databaseName);deletion.onsuccess=()=>resolve();deletion.onerror=()=>reject(deletion.error);});
  }
}
void run().then(()=>reviewStatus('passed')).catch(error=>{reviewStatus('failed');root.render(<IntegrationIntl><pre role="alert">{JSON.stringify({checks,error:String(error)},null,2)}</pre></IntegrationIntl>);});
