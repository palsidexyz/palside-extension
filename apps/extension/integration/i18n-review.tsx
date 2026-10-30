import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'use-intl';
import { messagesFor, type LanguagePreference } from '@palside/i18n';
import { createLanguageController, type LanguageState } from '../src/runtime/transport/language';
import { LanguageContext } from '../src/features/palside/settings/language-setting';
import { PalsideApp } from './preview-app';
import { palsideFixtures, demoSites } from './fixtures';
import type { Draft } from '../src/domain/chat/model';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Controlled fixture: no network, Chrome permissions, actual accounts or message delivery.
let stored: LanguagePreference = 'auto'; let failSave = false;
const listeners = new Set<(value: LanguageState) => void>();
const language = createLanguageController({ storage: { local: { get: async () => ({ 'palside:language': stored }), set: async values => { if (failSave) throw new Error('Fixture storage failure'); stored = values['palside:language'] as LanguagePreference; } } }, i18n: { getAcceptLanguages: async () => ['en'], getUILanguage: () => 'en' } }, value => { for (const listener of listeners) listener(value); });
const params = new URLSearchParams(location.search);
const initial: RuntimeState = {
  revision: 0, ready: true, rooms: { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} }, authenticated: params.get('scene') !== 'login', 
  account: { bio: '', tags: [], id: 'you', nickname: 'Fixture user', avatarId: null, matrixId: '@fixture:test', revision: 0, acceptTeamInvites: true },
  toggles: { share: true, interact: false },
  connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
  data: { ...palsideFixtures, messages: palsideFixtures.messages.map((value, index) => ({ ...value, timestamp: Date.now() - (20 - index) * 60000 })) }, drafts: {},
  preferences: { current: 'night', web: { share: true, interact: true }, notifications: 'off' },
  remoteTeams: palsideFixtures.teams.map(team => ({ reason: null, revision: 0, inviteSuspended: false, id: team.id, name: team.name, description: team.description, ownerId: team.owner, roomId: '!fixture:test', avatarId: null, memberCount: team.memberIds.length, joined: team.joined, publishedAt: null, recruitmentExpiresAt: null, retentionDays: 7, membersCanInvite: false, memberIds: team.memberIds, people: [], periods: [], preferences: { muted: false, readIds: [], revision: 0 }, requests: [], bans: [], transfer: null })),
  config: { websiteUrl: 'http://localhost:3000', signupDifficulty: 0 }, invitations: {}, items: { stickies: [] },
};
if (params.get('scene') === 'state') {
  initial.data = { ...initial.data, messages: [
    ...Array.from({ length: 40 }, (_, index) => ({ id: `language-history-${index}`, teamId: 'night', author: 'mia', text: `Reading sample ${index + 1} · 阅读样例`, time: '', timestamp: Date.now() - (60 - index) * 60000, status: 'sent' as const })),
    ...initial.data.messages,
    { id: 'language-pending', teamId: 'night', author: 'you', text: 'Pending sample · 发送状态样例', time: '', timestamp: Date.now(), status: 'sending' },
  ] };
  initial.drafts = { night: { value: { text: 'Keep this image draft · 保留图片草稿', attachment: { kind: 'image', src: '/icon-128.png', name: 'QA image.png' } }, revision: 1, updatedAt: Date.now() } };
}
function Review() {
  const [state, setState] = useState(initial); const current = useRef(state);
  const [lang, setLang] = useState<LanguageState>({ preference: 'auto', locale: 'en' });
  const [connected, setConnected] = useState(true);
  useEffect(() => { listeners.add(setLang); void language.get().then(setLang); return () => { listeners.delete(setLang); }; }, []);
  const save = useCallback(async (value: LanguagePreference) => { try { await language.save(value); } catch { throw Object.assign(new Error('Fixture write failed'), { code: 'LANGUAGE_SAVE_FAILED' }); } }, []);
  const command: LivePort['command'] = useCallback(async <T,>(name: string, payload: Record<string, unknown> = {}) => {
    let next = current.current;
    if (name === 'draft') {
      const id = String(payload.teamId), old = next.drafts[id];
      next = { ...next, drafts: { ...next.drafts, [id]: { value: { text: '', ...old?.value, ...payload.patch as Partial<Draft> }, revision: (old?.revision ?? 0) + 1, updatedAt: Date.now() } } };
    }
    if (name === 'preferences') next = { ...next, preferences: { ...next.preferences, ...payload } };
    if (name === 'dismiss-notice') next = { ...next, notice: undefined, error: undefined };
    current.current = next; setState(next);
    return undefined as T;
  }, []);
  return <>
    <div style={{ padding: 8, display: params.has('single') ? 'none' : 'flex', gap: 12, flexWrap: 'wrap', background: '#eee', color: '#111', fontSize: 12 }}>
      <label><input type="checkbox" onChange={event => { failSave = event.target.checked; }} />Fail language saves</label>
      <label><input type="checkbox" checked={!connected} onChange={event => setConnected(!event.target.checked)} />Disconnect language control</label>
      <label><input type="checkbox" checked={state.connection.service === 'unavailable'} onChange={event => { const next = { ...current.current, connection: { ...current.current.connection, service: event.target.checked ? 'unavailable' as const : 'ready' as const } }; current.current = next; setState(next); }} />Service unavailable</label>
      <button onClick={() => { setTimeout(() => { void language.save(lang.locale === 'en' ? 'zh-CN' : 'en'); }, 2000); }}>Switch language in 2s</button>
      <output data-testid="language-result">{JSON.stringify(lang)}</output>
    </div>
    <IntlProvider locale={lang.locale} messages={messagesFor(lang.locale)} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      <LanguageContext.Provider value={{ state: lang, connected, save }}>
        <div style={{ display: 'grid', gridTemplateColumns: params.has('single') ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          {(params.has('single') ? ['A'] : ['A', 'B']).map(id => <div key={id} data-testid={`panel-${id}`} style={{ height: params.has('single') ? '100dvh' : 640, minWidth: 0 }}><PalsideApp data={state.data} sites={demoSites} live={{ state, command, openPage: async () => {} }} deliver={async () => {}} /></div>)}
        </div>
      </LanguageContext.Provider>
    </IntlProvider>
  </>;
}
createRoot(document.getElementById('root')!).render(<Review />);
