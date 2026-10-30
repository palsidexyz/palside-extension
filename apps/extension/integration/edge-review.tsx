import { IntegrationIntl } from './intl';
import tokenMetadata from './fixtures/token-metadata.json';
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { palsideFixtures, demoSites } from './fixtures';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import type { LivePort } from '../src/features/palside/app/live-port';
import { errorMessage, MessageError } from '@palside/i18n';
import '@palside/design/fonts.css';
import '../src/styles.css';

/** Isolated command adapter. Exercises product views, never authenticates or contacts a service. */
const scene = new URLSearchParams(location.search).get('scene') ?? 'normal';
const data = structuredClone(palsideFixtures);
data.people = data.people.map(person => ({ ...person, presence: person.id === 'you' || person.id === 'mia' ? 'active' : 'away' }));
if (scene === 'missing') {
  data.people = data.people.filter(person => person.id !== 'robin' && person.id !== 'alice');
  data.messages.push({ id: 'broken-image', author: 'robin', teamId: 'night', text: '', time: '14:35', status: 'sent', attachment: { kind: 'image', src: 'data:image/png;base64,broken', name: '测试图片.webp' } });
}
if (scene === 'assets') {
  data.views[0] = { ...data.views[0]!, logo: tokenMetadata.gmgn.logo };
  data.views[1] = { ...data.views[1]!, logo: tokenMetadata.fomo.logo };
  data.views.push({ ...data.views[0]!, id: 'long-token', name: 'VeryLongUnbrokenTokenName'.repeat(3), logo: '/intentionally-missing-token.webp' });
  data.messages = data.views.filter(view => view.kind === 'asset').map((view, i) => ({ id: `asset-review-${i}`, author: i === 2 ? 'you' : 'robin', teamId: 'night', text: '', time: '14:40', status: 'sent', attachment: { kind: 'asset', assetId: view.id, view } }));
}
if (scene === 'invite-nickname') data.pendingInvite = 'https://example.test/invite/synthetic';
if (scene === 'readonly') data.teams[0] = { ...data.teams[0]!, readonly: true, readonlyReason: 'removed', joined: false };
if (scene === 'empty' || scene === 'no-team') data.teams = [];
if (scene === 'pacing') for (let i = 0; i < 4; i++) data.messages.push({ id: `paced-${i}`, author: 'you', teamId: 'night', text: ['冲', '冲冲', '这波稳了', '上车'][i]!, time: '14:36', status: 'sending' });
const now = Date.now();
let joinFailures = 0;
let draftFailure = new URLSearchParams(location.search).get('draft-failure') === '1';
function Review() {
  const [lastCommand, setLastCommand] = useState('');
  const [state, setState] = useState<RuntimeState>({
    revision: 0, ready: true, rooms: { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} }, authenticated: scene !== 'login', connection: { networkOnline: true, service: scene === 'readonly' || scene === 'empty' ? 'unavailable' : 'ready', messaging: 'ready', retrying: false },
    account: { bio: '', tags: [], id: data.self, nickname: scene === 'invite-nickname' ? '' : '测试成员', avatarId: null, matrixId: '@review:example.test', revision: 0, acceptTeamInvites: true }, data,
    toggles: { share: false, interact: false }, drafts: scene === 'readonly' ? { night: { revision: 1, updatedAt: now, value: { text: '保留的未发送文字' } } } : {}, preferences: { web: { share: true, interact: true }, current: data.teams[0]?.id ?? '', notifications: 'all', notificationPreview: true },
    remoteTeams: [], lobbyTeams: [], config: { websiteUrl: 'https://example.test', signupDifficulty: 0 },
    items: { stickies: [] }, invitations: { night: scene === 'invite' ? { url: 'https://example.test/invite/synthetic', expiresAt: now + 86400000, active: true, password: new URLSearchParams(location.search).get('password'), suspended: false }
      : scene === 'suspended' ? { url: 'https://example.test/invite/synthetic', expiresAt: now + 86400000, active: false, password: 'K7M2', suspended: true }
      : {suspended: false, password: null,  url: 'https://example.test/invite/synthetic', expiresAt: now - 1000, active: true } },
    ...(scene === 'password' ? { setup: 'password' as const } : {}),
  });
  // Drains a synthetic queue one slot per second, as the service pacing would: the head goes out, the rest move up.
  useEffect(() => {
    if (scene !== 'pacing') return;
    const ids = Array.from({ length: 4 }, (_, i) => `paced-${i}`);
    const queueOf = (pending: string[], at: number) => pending.length ? { night: { count: pending.length, nextAt: at, items: pending.map((id, i) => ({ id, at: at + i * 1000 })) } } : undefined;
    let restart: ReturnType<typeof setTimeout> | undefined;
    const start = () => { restart = undefined; setState(old => ({ ...old, data: { ...old.data, messages: old.data.messages.map(message => ids.includes(message.id) ? { ...message, status: 'sending' as const } : message) }, sendQueue: queueOf(ids, Date.now() + 2400) })); };
    start();
    const timer = setInterval(() => setState(old => {
      const queue = old.sendQueue?.night;
      if (!queue) { restart ??= setTimeout(start, 1500); return old; }
      if (queue.nextAt > Date.now()) return old;
      const [head, ...rest] = queue.items;
      return { ...old, data: { ...old.data, messages: old.data.messages.map(message => message.id === head?.id ? { ...message, status: 'sent' as const } : message) }, sendQueue: queueOf(rest.map(item => item.id), Date.now() + 1000) };
    }), 100);
    return () => { clearInterval(timer); clearTimeout(restart); };
  }, []);
  const command: LivePort['command'] = useCallback(async <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => {
    setLastCommand(name);
    await new Promise(resolve => setTimeout(resolve, 180));
    if (name === 'profile' && scene === 'failure') throw new Error('资料未能保存，请重试');
    if (name === 'lobby' && scene === 'failure') throw new Error('暂时无法读取小队');
    if (name === 'invitation' && scene === 'failure') throw new Error('暂时无法读取邀请');
    if (name === 'password-set') setState(old => ({ ...old, setup: undefined }));
    if (name === 'reload-image') {
      setState(old => ({ ...old, data: { ...old.data, messages: old.data.messages.map(message => message.id === payload?.id ? { ...message, attachment: { kind: 'image', src: '/avatars/avatar-cat.webp', name: '测试图片.webp' } } : message) } }));
    }
    // Join password: the synthetic team accepts K7M2 and locks after five wrong tries, like the service.
    if (name === 'invitation' && payload && 'password' in payload) setState(old => ({ ...old, invitations: { night: { ...old.invitations.night!, password: payload.password as string | null } } }));
    if (name === 'invite-preview') return { team: { id: 'garden', name: '链上花园', description: '', ownerName: 'Mia', memberCount: 12, avatarId: null, publishedAt: null, recruitmentExpiresAt: null }, invite: 'synthetic', passwordRequired: true } as T;
    if (name === 'join') {
      const fail = (code: string, details: Record<string, number> = {}) => Object.assign(new MessageError(errorMessage({ code, ...details })), { code });
      if (payload?.password !== 'K7M2') { joinFailures++; throw joinFailures >= 5 ? fail('INVITE_PASSWORD_LOCKED', { retryAfter: 3600 }) : fail('INVITE_PASSWORD_WRONG', { remaining: 5 - joinFailures }); }
      return { teamId: 'night' } as T;
    }
    if (name === 'invitation' && payload?.action === 'regenerate') setState(old => ({ ...old, invitations: { night: {suspended: false, password: null,  url: 'https://example.test/invite/synthetic', expiresAt: Date.now() + 86400000, active: true } } }));
    if (name === 'invitation' && payload?.action === 'revoke') setState(old => ({ ...old, invitations: { night: { ...old.invitations.night!, active: false } } }));
    if (name === 'profile') setState(old => ({ ...old, account: old.account ? { ...old.account, nickname: String(payload?.name) } : undefined, data: { ...old.data, people: old.data.people.map(person => person.id === data.self ? { ...person, name: String(payload?.name) } : person) } }));
    if (name === 'draft' && draftFailure) { draftFailure = false; throw new MessageError({ key: 'extension.runtime.draftChanged' }); }
    if (name === 'draft' && payload) setState(old => {
      const teamId = String(payload.teamId), previous = old.drafts[teamId];
      return { ...old, drafts: { ...old.drafts, [teamId]: { revision: (previous?.revision ?? 0) + 1, updatedAt: Date.now(), value: { ...previous?.value, ...payload.patch as object } as RuntimeState['drafts'][string]['value'] } } };
    });
    if (name === 'team') setState(old => ({ ...old, data: { ...old.data, teams: old.data.teams.map(team => team.id === payload?.teamId ? { ...team, name: String(payload.name), description: String(payload.description) } : team) } }));
    if (name === 'preferences' || name === 'notification-settings') setState(old => ({ ...old, preferences: { ...old.preferences, ...payload } }));
    return { ok: true } as T;
  }, []);
  return <div data-last-command={lastCommand} style={{ height: '100dvh' }}><PalsideApp data={data} sites={demoSites} live={{ state, command, openPage: async () => {} }} deliver={async () => {}} /></div>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
