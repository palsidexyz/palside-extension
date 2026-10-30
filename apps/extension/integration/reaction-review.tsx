import { IntegrationIntl } from './intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { PalsideService } from '../src/runtime/composition/core';
import { reactionEmojis, type ReactionEmoji } from '../src/domain/annotations/reactions';
import { palsideFixtures, demoSites } from './fixtures';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Controlled UI fixture: sends are recorded locally and teammates' reactions are injected; no service requests.
function Review() {
  const [width, setWidth] = useState(400);
  const [height, setHeight] = useState(640);
  const [sent, setSent] = useState<string[]>([]);
  const [failing, setFailing] = useState(false);
  const [state, setState] = useState<RuntimeState>(() => ({
    ...new PalsideService().state, ready: true, authenticated: true, 
    connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
    account: { bio: '', tags: [], id: 'you', nickname: '你', avatarId: null, matrixId: '@fixture:test', revision: 0, acceptTeamInvites: true },
    data: palsideFixtures, viewingId: palsideFixtures.views[0]?.id, reactions: [],
    preferences: { web: { share: true, interact: true }, current: 'night', notifications: 'off' },
  }));
  function receive(personId: string, emoji: ReactionEmoji, count = 1, teamId = state.preferences.current) {
    setState(old => ({ ...old, reactions: [...(old.reactions ?? []), { id: crypto.randomUUID(), teamId, personId, emoji, count, at: Date.now() }].slice(-24) }));
  }
  function storm() { ['robin', 'mia', 'leo', 'kai'].forEach((person, i) => setTimeout(() => receive(person, reactionEmojis[i]!.emoji, i + 1), i * 280)); }
  function theme(value: string) { document.querySelector('[data-palside-app]')?.setAttribute('data-appearance', value); }
  const command: LivePort['command'] = async <T,>(name: string, payload: Record<string, unknown> = {}) => {
    if (name === 'react') {
      await new Promise(resolve => setTimeout(resolve, 120));
      setSent(old => [`${new Date().toLocaleTimeString()} ${String(payload.teamId)} ${String(payload.emoji)} ×${String(payload.count)}${failing ? '（失败）' : ''}`, ...old].slice(0, 8));
      if (failing) throw Object.assign(new Error('rate'), { code: 'RATE_LIMITED', retryAfter: 12 });
      return { delivered: 7 } as T;
    }
    if (name === 'preferences') setState(old => ({ ...old, preferences: { ...old.preferences, ...payload } }));
    return undefined as T;
  };
  return <>
    <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 12, fontSize: 12, alignItems: 'center' }}>
      <span>独立受控样例：发送只记录在本页，成员反应由按钮注入</span>
      <button onClick={() => receive('robin', '🔥')}>Robin 🔥</button>
      <button onClick={() => receive('mia', '🚀', 6)}>Mia 🚀 ×6</button>
      <button onClick={storm}>四人连续反应</button>
      <button onClick={() => receive('leo', '😂', 2, 'weekend')}>其他小队反应（不应显示）</button>
      <button onClick={() => setFailing(value => !value)}>发送失败：{String(failing)}</button>
      <button onClick={() => setState(old => ({ ...old, connection: { ...old.connection, networkOnline: !old.connection.networkOnline } }))}>切换断网</button>
      <button onClick={() => theme('light')}>浅色</button><button onClick={() => theme('dark')}>深色</button>
      <select aria-label="容器宽度" value={width} onChange={event => setWidth(Number(event.target.value))}>{[320, 360, 400, 440, 480, 600].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="容器高度" value={height} onChange={event => setHeight(Number(event.target.value))}>{[480, 640, 800].map(value => <option key={value}>{value}</option>)}</select>
      <output style={{ whiteSpace: 'pre', width: '100%' }}>{sent.join('\n') || '尚未发送'}</output>
    </nav>
    <div id="product" style={{ width, maxWidth: '100%', height, margin: '8px auto', border: '1px solid #a6acb2' }}>
      <PalsideApp data={state.data} sites={demoSites} live={{ state, command, openPage: async () => {} }} deliver={async () => {}} />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
