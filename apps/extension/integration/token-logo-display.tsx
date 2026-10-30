import { IntegrationIntl } from './intl';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Token } from '../src/features/palside/ui/primitives';
import { pageView, readView } from '../src/runtime/viewing/view-snapshot';
import { identifyPage } from '@palside/shared/navigation';
import '@palside/design/fonts.css';
import '../src/styles.css';

const identity = identifyPage('https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571', ['fomo.family'])!;
if (identity.kind !== 'asset') throw new Error('Invalid fixture');
const publicLogo = 'https://metadata.mobula.io/assets/logos/f03b6095dc83bde168cab16013205334941f599c7405682cced179242df940f8.png';
const sender = pageView(identity, { name: 'PONS', logo: publicLogo });
const receiver = await readView(JSON.parse(JSON.stringify(sender)));
const rejected = await readView({ ...sender, logo: 'https://untrusted.invalid/tracking.png' });
const missing = await readView({ ...sender, logo: 'https://metadata.mobula.io/assets/logos/' + '0'.repeat(64) + '.png' });
if (!receiver || !rejected || !missing || receiver.logo !== publicLogo || rejected.logo) throw new Error('Receiver validation failed');
function Review() {
 const [generation,setGeneration]=useState(0);
 const [useMissing,setUseMissing]=useState(false);
 return <main data-palside-app data-appearance="dark" style={{ padding: 24, display: 'grid', gap: 16, background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
  <h1>公开代币 Logo 验收</h1>
  <p>真实 Token 组件与接收端校验，不读取真实会话。</p>
  <div data-testid="public-logo"><Token key={generation} view={useMissing?missing!:receiver!} size="lg" /><span>PONS · 公开 CDN</span></div>
  <div data-testid="rejected-logo"><Token key={generation} view={rejected!} size="lg" /><span>不受信任地址 · 默认图标</span></div>
  <div data-testid="missing-logo"><Token key={generation} view={missing!} size="lg" /><span>图片不存在 · 默认图标</span></div>
  <button onClick={()=>setGeneration(value=>value+1)}>重新显示图片</button>
  <button onClick={()=>setUseMissing(value=>!value)}>切换图片来源</button>
  <output>显示次数：{generation+1}</output>
 </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
