import { IntegrationIntl } from './intl';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { palsideFixtures, demoSites } from './fixtures';
import { chains } from '../src/features/palside/assets/chain-catalog';
import tokenMetadata from './fixtures/token-metadata.json';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Isolated UI samples; no account, runtime or message delivery connection.
const data = structuredClone(palsideFixtures);
const long = new URLSearchParams(location.search).has('long');
data.views[0] = { ...data.views[0]!, name: long ? 'VeryLongUnbrokenTokenName'.repeat(3) : 'CASHCAT', source: 'DEX Screener', url: `https://dexscreener.com/robinhood/${data.views[0]!.address}`, logo: long ? '/intentionally-missing-token.webp' : undefined };
if (new URLSearchParams(location.search).has('real')) data.views[0] = { ...data.views[0]!, logo: tokenMetadata.gmgn.logo };
data.messages = [{ id: 'card-review', teamId: 'night', author: 'robin', text: '', time: '14:28', status: 'sent', attachment: { kind: 'asset', assetId: data.views[0]!.id, view: data.views[0] } }];
if (new URLSearchParams(location.search).has('chains')) data.messages = chains.map(chain => ({ ...data.messages[0]!, id: `chain-${chain.value}`, attachment: { kind: 'asset', assetId: data.views[0]!.id, view: { ...data.views[0]!, chain: chain.value } } }));
if (new URLSearchParams(location.search).has('sources')) {
  const view = { ...data.views[0]!, id: 'cashcat-gmgn', source: 'GMGN', url: `https://gmgn.ai/robinhood/token/${data.views[0]!.address}` };
  data.views.push(view);
  data.people = data.people.map(person => person.id === 'mia' ? { ...person, viewing: view.id } : person);
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><div style={{ width: '100%', height: '100dvh' }}><PalsideApp data={data} sites={demoSites} deliver={async () => {}} /></div></IntegrationIntl>);
