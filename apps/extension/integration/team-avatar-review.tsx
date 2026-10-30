import styles from './team-avatar-review.module.css';
import { IntegrationIntl } from './intl';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeamAvatar } from '../src/features/palside/teams/team-avatar';
import { defaultTeamAvatar, defaultTeamAvatarNames } from '../src/features/palside/teams/default-team-avatar';
import type { Team } from '../src/domain/teams/model';
import '@palside/design/fonts.css';
import '../src/styles.css';

const sample: Team = { id: 'sample', name: '小队', description: '', owner: 'owner', memberIds: [], joined: true, published: false, muted: false, unread: 0 };
const ids=defaultTeamAvatarNames.map(name=>Array.from({length:1024},(_,i)=>`team-avatar-review-${i}`).find(id=>defaultTeamAvatar(id)===`/team-avatars/team-avatar-${name}.webp`)!);
function Review() {
  const [theme,setTheme]=useState('light');
  const [name,setName]=useState('我的小队');
  const [custom,setCustom]=useState(true);
  return <main data-palside-app data-appearance={theme} style={{minHeight:'100dvh',background:'var(--ui-canvas)',color:'var(--ui-text-primary)',padding:24,fontFamily:'Geist, sans-serif'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:16,marginBottom:20}}><strong>小队默认头像 · {defaultTeamAvatarNames.length} 个</strong><button onClick={()=>setTheme(theme==='light'?'dark':'light')}>切换明暗</button></header>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>{defaultTeamAvatarNames.map((key,index)=><section key={key} className={styles.surface} style={{padding:16}}><div style={{display:'flex',alignItems:'center',gap:20}}><TeamAvatar team={{...sample,id:ids[index]!,name:key}}/><TeamAvatar team={{...sample,id:ids[index]!,name:key}} size="lg" /></div><small style={{display:'block',color:'var(--ui-text-secondary)',marginTop:14}}>{key}</small></section>)}</div>
    <section style={{marginTop:24,display:'flex',flexWrap:'wrap',alignItems:'center',gap:16}} aria-label="自定义与回退验证"><label>小队名称 <input value={name} onChange={event=>setName(event.target.value)}/></label><TeamAvatar team={{...sample,name,avatar:custom?'/avatars/avatar-frog.webp':undefined}}/><button onClick={()=>setCustom(!custom)}>{custom?'移除自定义头像':'恢复自定义头像'}</button><TeamAvatar team={{...sample,id:'broken-custom',name:'损坏自定义图',avatar:'/team-avatars/missing-image.webp'}}/></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review/></IntegrationIntl>);
