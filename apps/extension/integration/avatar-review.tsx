import styles from './avatar-review.module.css';
import { IntegrationIntl } from './intl';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PersonAvatar } from '../src/features/palside/ui/primitives';
import { defaultAvatar, defaultAvatarNames } from '../src/features/palside/account/default-avatar';
import '@palside/design/fonts.css';
import '../src/styles.css';

const ids=defaultAvatarNames.map(name=>Array.from({length:1024},(_,i)=>`avatar-review-${i}`).find(id=>defaultAvatar(id)===`/avatars/avatar-${name}.webp`)!);
function Review(){
  const [theme,setTheme]=useState('light'); const [selected,setSelected]=useState('');
  return <main data-palside-app data-appearance={theme} style={{height:'100dvh',overflow:'auto',background:'var(--ui-canvas)',color:'var(--ui-text-primary)',padding:20,boxSizing:'border-box',fontFamily:'Geist, sans-serif'}}>
    <header style={{display:'flex',justifyContent:'space-between',marginBottom:20}}><strong>默认头像 · 24 个</strong><button onClick={()=>setTheme(theme==='light'?'dark':'light')}>切换明暗</button></header>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>{defaultAvatarNames.map((name,index)=><section key={name} className={styles.surface} style={{padding:12}}><div style={{display:'flex',alignItems:'center',gap:12}}>{(['xs','sm','md','lg','xl'] as const).map((size,i)=><PersonAvatar key={size} size={size} person={{id:ids[index]!,name,color:'var(--ui-control-surface)',presence:i%2===0 ? 'active' : 'away'}} onClick={()=>setSelected(name)} />)}</div><small style={{display:'block',marginTop:8,color:'var(--ui-text-secondary)'}}>{name}</small></section>)}</div>
    <p role="status">{selected}</p>
    <div style={{display:'flex',gap:12}}><PersonAvatar person={{id:'uploaded',name:'自定义头像优先',avatar:'/avatars/avatar-frog.webp',color:'#eee'}}/><PersonAvatar person={{id:'broken',name:'图片失败占位',avatar:'/avatars/nonexistent.webp',color:'#eee'}}/></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review/></IntegrationIntl>);
