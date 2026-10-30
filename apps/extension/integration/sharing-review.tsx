import { IntegrationIntl } from './intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { PalsideService } from '../src/runtime/composition/core';
import { pageView } from '../src/runtime/viewing/view-snapshot';
import { identifyPage, websiteIdentity } from '@palside/shared/navigation';
import { palsideFixtures, demoSites } from './fixtures';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import '@palside/design/fonts.css';
import '../src/styles.css';
const mint='So11111111111111111111111111111111111111112';
const gmgn=pageView(identifyPage(`https://gmgn.ai/sol/token/${mint}`,['gmgn.ai']) as Extract<ReturnType<typeof identifyPage>,{kind:'asset'}>,{name:'SOL'});
const fomo=pageView(identifyPage(`https://fomo.family/tokens/sol/${mint}`,['fomo.family']) as Extract<ReturnType<typeof identifyPage>,{kind:'asset'}>,{name:'SOL'});
const x1=pageView(websiteIdentity('https://x.com/alice/status/123','page')!);
const x2=pageView(websiteIdentity('https://x.com/bob/status/456','page')!);
const xs=pageView(websiteIdentity('https://x.com/account','site')!);
function data(scene:string){
 const targets=scene==='token-rank'?[gmgn,fomo,gmgn,gmgn,xs,undefined]:scene==='single'?[gmgn,gmgn,xs,xs,undefined,undefined]:scene==='mixed'?[gmgn,fomo,x1,x2,xs,undefined]:scene==='rank'?[gmgn,fomo,x1,x2,xs,xs]:scene==='gone'?[gmgn,fomo,undefined,undefined,undefined,undefined]:[gmgn,fomo,x1,undefined,undefined,undefined];
 return {...palsideFixtures,views:[gmgn,fomo,x1,x2,xs],messages:[],people:palsideFixtures.people.map((p,i)=>({...p,viewing:targets[i]?.id,presence:'active' as const}))};
}
function Review(){
 const [state,setState]=useState<RuntimeState>(()=>({...new PalsideService().state,ready:true,authenticated:true,account:{ bio: '', tags: [], id:'you',nickname:'你',avatarId:null,matrixId:'@fixture:test',revision:0,acceptTeamInvites:true},data:data('mixed'),preferences:{web:{share:true,interact:true},current:'night',notifications:'off'}}));
 const [opened,setOpened]=useState('');
 const command:LivePort['command']=async<T,>(name:string,p:Record<string,unknown>={})=>{if(name==='preferences')setState(old=>({...old,preferences:{...old.preferences,...p}}));return undefined as T;};
 return <><nav style={{display:'flex',gap:4,flexWrap:'wrap',padding:6,fontSize:12}}>{[['mixed','混合来源'],['single','同页'],['rank','人数变化'],['gone','网站离开'],['late-token-rank','延迟人数变化'],['late-gone','延迟网站离开']].map(([scene,label])=><button key={scene} onClick={()=>{if(scene!.startsWith('late-'))setTimeout(()=>setState(old=>({...old,data:data(scene!.slice(5))})),1500);else setState(old=>({...old,data:data(scene!)}));}}>{label}</button>)}<output aria-label="跳转结果">{opened}</output></nav><div style={{height:'calc(100dvh - 64px)'}}><PalsideApp data={state.data} sites={demoSites} live={{state,command,openPage:async url=>{setOpened(url);}}} deliver={async()=>{}} /></div></>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review/></IntegrationIntl>);
