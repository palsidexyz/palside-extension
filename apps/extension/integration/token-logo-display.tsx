import { IntegrationIntl } from './intl';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Token } from '../src/features/palside/ui/primitives';
import { pageView, readView } from '../src/runtime/viewing/view-snapshot';
import { TokenProfiles } from '../src/runtime/viewing/token-profiles';
import { identifyPage } from '@palside/shared/navigation';
import '@palside/design/fonts.css';
import '../src/styles.css';

const identity = identifyPage('https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571', ['fomo.family'])!;
if (identity.kind !== 'asset') throw new Error('Invalid fixture');
const asset = `${identity.chain}:${identity.address}`;
const entry = (logo: number | null) => ({ chain: 'robinhood' as const, address: identity.address, name: 'Pons', symbol: 'PONS', decimals: 18, logo, logoPending: false });
// The directory's icon is served by Palside's API; the review check answers it locally.
const directory = (logo: number | null) => { const tokens = new TokenProfiles(undefined, undefined, 'https://api.palside.test'); tokens.putDirectory(asset, entry(logo)); return tokens; };
const sender = { ...pageView(identity, { name: 'PONS' }), logo: 'https://untrusted.invalid/tracking.png' };
const read = await readView(JSON.parse(JSON.stringify(sender)));
if (!read || 'logo' in read) throw new Error('Snapshot icons must be ignored');
const received = read;
const shown = directory(1).apply(received), missing = directory(2).apply(received), none = directory(null).apply(received);
if (!shown.logo?.startsWith('https://api.palside.test/tokens/logo/robinhood/') || none.logo) throw new Error('Directory icon failed');
function Review() {
 const [generation,setGeneration]=useState(0);
 const [useMissing,setUseMissing]=useState(false);
 return <main data-palside-app data-appearance="dark" style={{ padding: 24, display: 'grid', gap: 16, background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
  <h1>代币图标验收</h1>
  <p>真实 Token 组件；图标只来自代币目录，分享内容里的图标一律忽略。</p>
  <div data-testid="public-logo"><Token key={generation} view={useMissing?missing:shown} size="lg" /><span>PONS · 代币目录</span></div>
  <div data-testid="rejected-logo"><Token key={generation} view={received} size="lg" /><span>分享内容自带图标 · 默认图标</span></div>
  <div data-testid="missing-logo"><Token key={generation} view={none} size="lg" /><span>链上没有图标 · 默认图标</span></div>
  <button onClick={()=>setGeneration(value=>value+1)}>重新显示图片</button>
  <button onClick={()=>setUseMissing(value=>!value)}>切换图片来源</button>
  <output>显示次数：{generation+1}</output>
 </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
