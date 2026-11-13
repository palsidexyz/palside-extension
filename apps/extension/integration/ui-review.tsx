import { IntegrationIntl } from './intl';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from '../src/features/palside/app/palside-app';
import { palsideFixtures } from './fixtures';
import { fixtureState, useFixtureLive } from './fixture-live';
import '@palside/design/fonts.css';
import '../src/styles.css';

const scene = new URLSearchParams(location.search).get('scene');
const empty = scene === 'empty' || scene === 'history';
const data = { ...palsideFixtures, teams: scene === 'menus' ? palsideFixtures.teams.map(team => team.id === 'night' ? { ...team, name: 'Chrome 真实服务验收', unread: 4 } : team.id === 'weekend' ? { ...team, name: '账号清理验收', unread: 13 } : team) : palsideFixtures.teams, messages: empty ? [] : palsideFixtures.messages.map(message => message.id === 'n4' ? { ...message, mentionIds: ['mia'] } : message), people: empty ? palsideFixtures.people.map(person => ({ ...person, viewing: undefined })) : palsideFixtures.people.map(person => ({ ...person, presence: ['mia', 'you'].includes(person.id) ? 'active' as const : 'away' as const })) };
function Review() {
  const live = useFixtureLive(() => fixtureState(data, {
    ...(scene === 'offline' ? { connection: { networkOnline: false, service: 'connecting', messaging: 'connecting', retrying: false } } : {}),
    ...(scene === 'history' ? { history: { [data.teams[0]!.id]: { missingKeys: 1, loaded: true, loading: false } } } : {}),
  }), { delay: 1800 });
  return <PalsideApp live={live} />;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><div style={{ width: '100%', height: '100dvh' }}><Review /></div></IntegrationIntl>);
