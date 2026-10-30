import { IntegrationIntl } from './intl';
import { message as uiMessage } from '@palside/i18n';
import { reviewStatus } from './review-harness';
import React, { useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { createRoot } from 'react-dom/client';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import { ApiError } from '../src/runtime/transport/api';
import { connectionStatus, type Connection } from '../src/runtime/transport/connection';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';
import type { RuntimeDevice } from '../src/runtime/account/device';
import { PalsideApp } from './preview-app';
import { emptyDraft, type Draft, type Message } from '../src/domain/chat/model';
import { palsideFixtures, demoSites } from './fixtures';
import '@palside/design/fonts.css';
import '../src/styles.css';

const checks: string[] = [];
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); checks.push(label); }
const healthy: Connection = { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false };
async function verify() {
  const name = `palside-connection-qa-${crypto.randomUUID()}`;
  const storage = new ClientStorage(name);
  const service = new PalsideService(undefined, undefined, storage);
  service.initialise = async () => {};
  const session: RuntimeDevice = { token: 'synthetic', storageKey: [], account: { bio: '', tags: [], id: 'qa', nickname: 'QA', avatarId: null, matrixId: '@qa:test', revision: 1, acceptTeamInvites: true }, matrix: { userId: '@qa:test', deviceId: 'test' } };
  const team: TeamSnapshot = { reason: null, revision: 0, inviteSuspended: false, id: 'team', name: '测试小队', description: '', avatarId: null, ownerId: 'qa', roomId: '!qa:test', memberCount: 1, joined: true, publishedAt: null, recruitmentExpiresAt: null, retentionDays: 7, memberIds: ['qa'], people: [], periods: [], preferences: { muted: false, readIds: [], revision: 1 }, requests: [], bans: [], transfer: null, membersCanInvite: false };
  const { auth } = service;
  auth.session = session; auth.cryptoInitialised = true;
  service.state.authenticated = true; service.state.account = session.account;
  service.state.data.self = 'qa'; service.state.remoteTeams = [team];
  let sends = 0;
  const transactions: string[] = [];
  const room = { hasEncryptionStateEvent: () => true, getEventForTxnId: () => undefined, getEncryptionTargetMembers: async () => [] };
  auth.client = {
    getRoom: () => room,
    getCrypto: () => ({ isEncryptionEnabledInRoom: async () => true, getUserVerificationStatus: async () => ({ needsUserApproval: false, wasCrossSigningVerified: () => false, isCrossSigningVerified: () => false }), userHasCrossSigningKeys: async () => false }),
    sendEvent: async (_room: string, _type: string, _content: unknown, transaction: string) => { sends++; transactions.push(transaction); throw Object.assign(new Error('lost response'), { name: 'ConnectionError' }); },
    fetchRoomEvent: async () => { throw new Error('synthetic missing event'); },
    retryImmediately: () => {},
  } as unknown as MatrixClient;
  const message: Message = { id: 'stable-transaction', teamId: 'team', author: 'qa', text: '保留原稿', time: '12:00', status: 'sending' };
  try {
    const draft = await storage.updateDraft('qa', 'team', { text: message.text }, 0, emptyDraft); service.state.drafts.team = draft;
    for (const connection of [
      { ...healthy, networkOnline: false },
      { ...healthy, service: 'unavailable' as const },
      { ...healthy, messaging: 'unavailable' as const },
      { ...healthy, messaging: 'connecting' as const },
    ]) {
      service.state.connection = connection;
      await service.command({ name: 'send', payload: { message, revision: draft.revision } }).then(() => { throw new Error('blocked send succeeded'); }, error => check(error.code === 'CONNECTION_UNAVAILABLE', `${connectionStatus(connection)} is a connection error, never a team permission error`));
    }
    check(sends === 0 && (await storage.rows('qa', 'outgoing')).length === 0, 'Known unavailable connection never creates an outgoing copy or submits a message');
    check((await storage.get<{value: Draft}>('qa:draft:team'))?.value.text === message.text, 'Blocked sends retain the original durable draft');
    service.state.data.teams = [{ ...structuredClone(palsideFixtures.teams[0]!), id: 'team', readonly: true, readonlyReason: 'removed' }];
    await service.command({ name: 'send', payload: { message, revision: draft.revision } }).then(() => { throw new Error('readonly send succeeded'); }, error => check(error.text?.key === 'extension.runtime.removedReadonly', 'Known read-only membership takes priority over connection failure'));
    service.state.data.teams = [];
    service.state.connection = { ...healthy };
    const put = storage.put.bind(storage);
    storage.put = async () => { throw new Error('本机内容未保存，请检查可用空间后重试'); };
    await service.command({ name: 'send', payload: { message, revision: draft.revision } }).then(() => { throw new Error('storage failure hidden'); }, error => check(error.code === 'MESSAGE_PREPARATION_FAILED', 'Storage failure before outgoing creation remains visible as an action error'));
    storage.put = put;
    check(Number(sends) === 0 && service.state.data.messages.length === 0, 'A failed durable write cannot submit a message or create a misleading outgoing bubble');
    await service.command({ name: 'send', payload: { message, revision: draft.revision } }).catch(() => {});
    check(service.state.data.messages[0]?.status === 'uncertain', 'Lost acknowledgement is uncertain, not a definite failure');
    check(connectionStatus(service.state.connection) === 'messaging-unavailable', 'A message transport failure updates message connection health');
    service.state.connection = { ...healthy };
    check(Number(sends) === 1, 'Recovery does not send automatically');
    await service.command({ name: 'send', payload: { message, revision: -1 } }).catch(() => {});
    check(transactions.length === 2 && transactions.every(id => id === message.id), 'Explicit retry reuses the original transaction ID');
    service.state.connection = { ...healthy };
    service.state.remoteTeams = [];
    await service.command({ name: 'send', payload: { message, revision: -1 } }).then(() => { throw new Error('unauthorized send succeeded'); }, error => check(error.text?.key === 'extension.runtime.notTeamMember', 'Known membership loss has a permission-specific message'));
    service.state.remoteTeams = [team];
    let requests = 0; let release!: () => void;
    let pending = new Promise<void>(resolve => { release = resolve; });
    service.api.request = async <T,>() => { requests++; await pending; return Promise.reject<T>(new ApiError(503, { error: 'SERVICE_UNAVAILABLE' })); };
    const single = auth.reconnect();
    check(service.state.connection.retrying && requests > 0, 'Reconnect starts requests and exposes busy state');
    release(); await Promise.allSettled([single]);
    const singleRequests = requests;
    requests = 0; pending = new Promise<void>(resolve => { release = resolve; });
    const first = auth.reconnect(); const second = auth.reconnect();
    check(service.state.connection.retrying, 'Concurrent reconnects expose busy state');
    release(); await Promise.allSettled([first, second]);
    check(requests === singleRequests, 'Two concurrent reconnects make the same requests as one');
    check(!service.state.connection.retrying && connectionStatus(service.state.connection) === 'service-unavailable', 'Failed reconnect clears busy state and retains service-specific error');
    service.networkChanged(false);
    check(connectionStatus(service.state.connection) === 'network-offline', 'Browser offline event immediately updates the shared state');
  } finally {
    await storage.clearAccount('qa', false);
    const db = await (storage as unknown as { database: Promise<IDBDatabase> }).database; db.close(); indexedDB.deleteDatabase(name);
  }
}
function Review() {
  const params = new URLSearchParams(location.search); const scene = params.get('scene') ?? 'service';
  const [state, setState] = useState(() => {
    const service = new PalsideService(); const state = service.state;
    state.data = structuredClone(palsideFixtures); state.ready = true; state.authenticated = true;
    state.account = { bio: '', tags: [], id: state.data.self, nickname: '测试成员', avatarId: null, matrixId: '@qa:test', revision: 1, acceptTeamInvites: true };
    state.preferences.current = state.data.teams[0]!.id;
    state.connection = { ...healthy, service: scene === 'service' || scene === 'empty' || scene === 'readonly' ? 'unavailable' : 'ready', messaging: scene === 'sync' ? 'unavailable' : scene === 'connecting' ? 'connecting' : scene === 'crypto' ? 'failed' : 'ready', networkOnline: scene !== 'network' };
    if (scene === 'readonly') { state.data.teams[0]!.readonly = true; state.data.teams[0]!.readonlyReason = 'removed'; }
    if (scene === 'empty') state.data.teams = [];
    if (scene === 'login') { state.authenticated = false; state.error = uiMessage('extension.runtime.sessionExpired'); }
    state.drafts[state.preferences.current] = { revision: 1, updatedAt: Date.now(), value: { text: '这份草稿会保留，连接恢复后手动发送。' } };
    state.data.messages.push({ id: 'uncertain-qa', teamId: state.preferences.current, author: state.data.self, text: '这条消息已提交，但尚未收到确认。', time: '12:00', status: 'uncertain', failure: uiMessage('extension.runtime.sendUncertain') });
    return state;
  });
  const command: LivePort['command'] = async (...[name]) => {
    if (name === 'reconnect') {
      setState(old => ({ ...old, connection: { ...old.connection, retrying: true } }));
      await new Promise(resolve => setTimeout(resolve, 300));
      setState(old => ({ ...old, connection: params.has('recover') ? { ...healthy } : { ...old.connection, retrying: false } }));
      if (!params.has('recover')) throw new ApiError(0, { error: 'CONNECTION_UNAVAILABLE' });
    }
    return undefined as never;
  };
  return <div style={{ height: '100dvh' }}><PalsideApp data={state.data} sites={demoSites} live={{ state, command, openPage: async () => {} }} deliver={async () => {}} /><script type="application/json" id="connection-result">{JSON.stringify({ passed: true, checks })}</script></div>;
}
const root = createRoot(document.getElementById('root')!);
void verify().then(() => { root.render(<IntegrationIntl><Review /></IntegrationIntl>); reviewStatus('passed'); }).catch(error => { reviewStatus('failed'); root.render(<IntegrationIntl><pre role="alert">{JSON.stringify({ passed: false, checks, error: String(error) }, null, 2)}</pre></IntegrationIntl>); });
