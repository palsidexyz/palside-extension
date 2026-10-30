import { validateView } from '../src/runtime/viewing/view-snapshot';
import type { MatrixClient } from 'matrix-js-sdk';
import { decryptedEvent } from './private-event';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeDevice } from '../src/runtime/account/device';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';
import { assetView, type Viewing } from '../src/domain/assets/model';
import { type Message } from '../src/domain/chat/model';
import { autoRun, reviewStatus } from './review-harness';
const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#result')!;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function run() {
  button.disabled = true; output.textContent = '正在验证…';
  const database = `palside-asset-qa-${crypto.randomUUID()}`;
  const storage = new ClientStorage(database); const service = new PalsideService(undefined, undefined, storage);
  const { auth } = service;
  const session: RuntimeDevice = { token: 'synthetic', storageKey: [], account: { bio: '', tags: [], id: 'fixture', nickname: 'fixture', avatarId: null, matrixId: '@fixture:local.test', revision: 0, acceptTeamInvites: true }, matrix: { userId: '@fixture:local.test', deviceId: 'fixture' } };
  const checks: string[] = []; const result: { checks: string[]; error?: string; cleaned?: boolean } = { checks };
  try {
    auth.initialising = Promise.resolve(); auth.session = session;
    service.state.connection = { networkOnline: true, service: "ready", messaging: "ready", retrying: false };
    service.state.authenticated = true; service.state.account = session.account;
    service.state.data.self = session.account.id;
    const team: TeamSnapshot = { reason: null, revision: 0, inviteSuspended: false, id: 'team', name: 'fixture', description: '', ownerId: 'fixture', roomId: '!fixture:local.test', avatarId: null, memberCount: 1, joined: true, publishedAt: null, recruitmentExpiresAt: null, retentionDays: 7, memberIds: ['fixture'], people: [{ bio: '', tags: [], deleted: false, id: 'fixture', nickname: 'fixture', avatarId: null, matrixId: session.matrix.userId }], periods: [{ joinedAt: 0, leftAt: null }], preferences: { muted: false, readIds: [], revision: 0 }, requests: [], bans: [], transfer: null, membersCanInvite: false };
    service.state.remoteTeams = [team];
    const url = 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4';
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ccff00';ctx.fillRect(0,0,32,32);
    const address=url.split('/').at(-1)!;
    const view = validateView({ version: 1, kind: 'asset', chain: 'Robinhood', address, url, name:'TEST', logo:canvas.toDataURL('image/png') }); check(view?.kind === 'asset' && view.logo?.startsWith('data:image/png;base64,'), 'Local PNG snapshot did not survive validation');
    for (const wrong of [{ chain: 'Base' }, { address: '0x'+'1'.repeat(40) }, { kind: 'website' }]) check(!validateView({ ...view, ...wrong }), 'Conflicting identity was accepted');
    check(!validateView({ ...view, logo: 'https://example.test/logo.png' })?.logo, 'Remote logo was accepted');
    checks.push('Contract, network and kind match the source; embedded PNG is accepted and remote image URLs are dropped');
    service.state.data.views = [view];
    await service.command({ name: 'attach', payload: { accountId: session.account.id, teamId: team.id, attachment: { kind: 'asset', assetId: view.id } } });
    const draft = service.state.drafts[team.id]!;
    service.state.data.views = [{ ...view, name: 'Later page metadata', logo: undefined }];
    check(assetView(draft.value.attachment)?.logo === view.logo, 'Draft lost its chosen logo');
    const sent: Record<string, unknown>[] = [];
    const room = { hasEncryptionStateEvent: () => true, getEventForTxnId: () => undefined, getEncryptionTargetMembers: async () => [] };
    auth.client = { getRoom: () => room, getCrypto: () => ({ isEncryptionEnabledInRoom: async () => true, getUserVerificationStatus: async () => ({ needsUserApproval: false, wasCrossSigningVerified: () => false, isCrossSigningVerified: () => false }), userHasCrossSigningKeys: async () => false }), sendEvent: async (_room: string, _type: string, content: Record<string, unknown>) => { sent.push(content); return { event_id: '$fixture-sent' }; }, fetchRoomEvent: async () => { throw new Error('Controlled missing acknowledgement body'); }, stopClient: () => {}, clearStores: async () => {} } as unknown as MatrixClient;
    await service.sending.doSend({ id: 'transaction', teamId: team.id, author: 'fixture', text: '', time: '12:00', status: 'sending', attachment: draft.value.attachment }, draft.revision);
    const wireAsset = sent[0]?.['com.palside.asset'] as Viewing;
    check(wireAsset.name === view.name && wireAsset.logo === view.logo && wireAsset.address === view.address, 'Send replaced the chosen snapshot');
    const cached = await storage.get<{message: Message}>('fixture:cache:$fixture-sent');
    check(assetView(cached?.message.attachment)?.logo === view.logo, 'Acknowledgement fallback lost the persisted card');
    checks.push('Attach, send, acknowledgement fallback and IndexedDB preserve the chosen contract/name/logo despite later page updates');
    await service.timeline.consume(await decryptedEvent({ event_id: '$fixture-received', type: 'm.room.message', sender: session.matrix.userId, room_id: team.roomId, origin_server_ts: Date.now(), content: { msgtype: 'm.text', body: '', 'com.palside.asset': wireAsset } }));
    const received = service.state.data.messages.find(message => message.id === '$fixture-received');
    check(assetView(received?.attachment)?.logo === view.logo, 'Receive lost embedded logo');
    checks.push('Received card retains its validated per-message snapshot without relying on live page metadata');
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  finally {
    try {
      try { await auth.clearDevice(); }
      finally {
        const db = await (storage as unknown as { database?: Promise<IDBDatabase> }).database;
        db?.close();
        await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(database); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error(`Fixture database cleanup blocked: ${database}`)); });
        result.cleaned = true;
      }
    } catch (error) { result.error = [result.error, String(error)].filter(Boolean).join('; '); }
    output.textContent = JSON.stringify(result, null, 2); button.disabled = false;
    reviewStatus(result.error ? 'failed' : 'passed');
  }
}
button.addEventListener('click', () => void run());
if (autoRun) void run();
