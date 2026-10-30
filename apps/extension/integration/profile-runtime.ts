import { decryptedEvent } from './private-event';
import { translator } from '@palside/i18n';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeDevice } from '../src/runtime/account/device';
import { remoteTeam } from './fixtures';
import { autoRun, reviewStatus } from './review-harness';
import { quotedText } from '../src/features/palside/chat/quotes';
import { type Message } from '../src/domain/chat/model';

const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#result')!;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function run() {
  button.disabled = true; output.textContent = '正在验证…';
  const name = `palside-profile-qa-${crypto.randomUUID()}`;
  const storage = new ClientStorage(name);
  const service = new PalsideService(undefined, undefined, storage);
  const { auth, cache } = service;
  const session: RuntimeDevice = { token: 'synthetic-session', storageKey: [], account: { bio: '', tags: [], id: 'fixture-account', nickname: 'fixture', avatarId: 'fixture-avatar', matrixId: '@fixture:local.test', revision: 1, acceptTeamInvites: true }, matrix: { userId: '@fixture:local.test', deviceId: 'fixture-device' } };
  const result: { checks: string[]; cleaned?: boolean; error?: string } = { checks: [] };
  try {
    const initialise = service.initialise, refresh = service.refresh, upload = service.api.upload, originalFetch = window.fetch;
    let uploads = 0;
    try {
      service.initialise = async () => {};
      service.refresh = async () => {};
      service.api.upload = async (_blob, kind, teamId) => { uploads++; check(kind === 'avatar' && teamId === 'original-team', 'Avatar upload lost its selected team'); return 'test-avatar'; };
      auth.session = session;
      await service.command({ name: 'avatar', payload: { accountId: session.account.id, teamId: 'original-team', data: 'data:image/png;base64,AQ==' } });
      check(uploads === 1, 'Valid avatar selection did not reach the upload boundary'); uploads = 0;
      const stale = await service.command({ name: 'avatar', payload: { accountId: 'previous-account', data: 'data:image/png;base64,AQ==' } }).then(() => false, error => error.text?.key === 'extension.runtime.avatarAccountChanged');
      check(stale && uploads === 0, 'An old file selection uploaded into the newly active account');
      const decoding = deferred<void>(), decoded = deferred<void>();
      window.fetch = async (input, init) => {
        if (input === 'data:image/png;base64,AQ==') { decoding.resolve(); await decoded.promise; return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' })); }
        return originalFetch(input, init);
      };
      const pending = service.command({ name: 'avatar', payload: { accountId: session.account.id, data: 'data:image/png;base64,AQ==' } });
      await decoding.promise;
      auth.session = { ...session, token: 'replacement-session' };
      decoded.resolve();
      check(await pending.then(() => false, error => error.text?.key === 'extension.runtime.avatarAccountChanged'), 'Re-login during image decoding did not cancel the old upload');
      check(uploads === 0, 'Image decoding reused a replacement session for an old upload');
      result.checks.push('Valid avatar selection retains its team; an old account selection or a replaced session during decoding performs no upload');
    } finally {
      service.initialise = initialise; service.refresh = refresh; service.api.upload = upload; window.fetch = originalFetch;
    }
    auth.session = session;
    let downloads = 0;
    service.api.media = async () => { downloads++; return new Uint8Array([1, 2, 3]).buffer; };
    const url = await cache.avatar('fixture-avatar');
    check(url && await cache.avatar('fixture-avatar') === url && downloads === 1, 'Visible avatar was not reused');
    check((await storage.rows(session.account.id, 'cache')).length === 0, 'Avatar was persisted as message content');
    service.state.data.people = [{ id: session.account.id, name: 'fixture', color: '#eee', avatar: url }];
    cache.pruneMedia(); check(cache.mediaUrls.size === 1, 'Visible avatar was removed');
    service.state.data.people = []; cache.pruneMedia();
    check(Number(cache.mediaUrls.size) === 0, 'Unreferenced avatar URL was retained');
    check(await fetch(url).then(() => false, () => true), 'Removed avatar Blob URL still resolves');
    result.checks.push('Avatar reused while visible; no durable Blob record; removing its last reference revokes the URL');

    const downloading = deferred<void>(), image = deferred<ArrayBuffer>();
    service.api.request = async <T>() => ({ account: session.account, teams: [], presence: {} }) as T;
    service.api.media = async () => { downloading.resolve(); return image.promise; };
    const pending = service.refresh(); await downloading.promise;
    await auth.clearDevice(); image.resolve(new Uint8Array([4, 5, 6]).buffer);
    await pending.catch(error => { if (error?.text?.key !== 'extension.runtime.loginChanged') throw error; });
    check(!service.state.authenticated && !service.state.account && !service.state.data.people.length && !service.state.remoteTeams.length, 'Late avatar response restored a logged-out account');
    check(Number(cache.mediaUrls.size) === 0 && (await storage.rows(session.account.id, 'cache')).length === 0, 'Late avatar response recreated a local copy');
    result.checks.push('Logout during avatar download leaves no account, people, teams or avatar URL after the old response finishes');

    auth.session = session;
    const requested = deferred<void>(), snapshot = deferred<unknown>();
    service.api.request = async <T>() => { requested.resolve(); return await snapshot.promise as T; };
    const stale = service.refresh(); await requested.promise;
    await auth.clearDevice();
    auth.session = { ...session, token: 'new-synthetic-session' };
    service.state.account = { ...session.account, nickname: 'new-session-profile' }; service.state.authenticated = true;
    snapshot.resolve({ account: session.account, teams: [], presence: {} });
    // A replaced session cancels the stale refresh; only its absence of side effects matters.
    await stale.catch(error => { if (error?.text?.key !== 'extension.runtime.loginChanged') throw error; });
    check(service.state.account?.nickname === 'new-session-profile' && service.state.authenticated, 'Old response overwrote a new session for the same account');
    result.checks.push('A stale profile response cannot overwrite a new session even when the account ID is unchanged');

    const started = deferred<void>(), released = deferred<void>(); let attempts = 0;
    auth.connectRuntimeDevice = async current => { attempts++; auth.session = current; started.resolve(); await released.promise; auth.cryptoInitialised = true; };
    const first = auth.connect(session); await started.promise;
    const second = auth.connect(session), background = auth.maintainConnection();
    check(first === second && attempts === 1, 'Concurrent reconnects started multiple initialisations');
    released.resolve(); await Promise.all([first, second, background]);
    check(attempts === 1, 'Background recovery duplicated the manual connection');
    result.checks.push('Manual and periodic recovery share one in-flight connection operation');

    attempts = 0; auth.cryptoInitialised = false;
    auth.connectRuntimeDevice = async current => { auth.session = current; attempts++; if (attempts === 1) throw new Error('synthetic startup failure'); auth.cryptoInitialised = true; };
    await auth.connect(session).then(() => { throw new Error('Initial failure was hidden'); }, () => {});
    check(service.state.connection.messaging === 'unavailable' && !auth.cryptoInitialised, 'Failed startup appeared online');
    await auth.maintainConnection();
    check(Number(attempts) === 2 && auth.cryptoInitialised, 'Periodic recovery did not retry incomplete startup');
    result.checks.push('Failed startup remains offline and permits the next periodic connection attempt');

    const now = Date.now(), day = 86_400_000;
    const originalTime = now - 29 * day, replyTime = now;
    const original: Message = { id: '$expiry-original', teamId: 'expiry-team', author: 'fixture-account', text: 'original body', time: '12:00', status: 'sent' };
    const reply: Message = { id: '$expiry-reply', teamId: 'expiry-team', author: 'fixture-account', text: 'reply body survives', time: '12:01', status: 'sent', replyTo: original.id };
    const foreign: Message = { ...reply, id: '$foreign-reply', teamId: 'other-team' };
    service.state.remoteTeams = [remoteTeam({ id: 'expiry-team', roomId: '!expiry:local.test', retentionDays: 30 }), remoteTeam({ id: 'other-team', roomId: '!other:local.test', retentionDays: 30 })];
    service.state.data.messages = [reply, foreign]; cache.eventTimes.set(reply.id, replyTime); cache.eventTimes.set(foreign.id, replyTime);
    await cache.cacheMessage(reply, replyTime);
    check(reply.replyToExpiresAt === undefined, 'Unknown original was assigned a guessed deadline');
    service.state.data.messages.push(original); cache.eventTimes.set(original.id, originalTime);
    await cache.cacheMessage(original, originalTime);
    await cache.cacheMessage(foreign, replyTime);
    check(foreign.replyToExpiresAt === undefined, 'Reference inferred metadata from another team');
    const deadline = originalTime + 30 * day;
    const cachedReply = await storage.get<{ message: Message; timestamp: number }>(`${session.account.id}:cache:${reply.id}`);
    check(cachedReply?.message.replyToExpiresAt === deadline, 'Late original did not persist the reference deadline');
    check(cachedReply.message.text === 'reply body survives' && !JSON.stringify(cachedReply).includes('original body'), 'Reference copied original body or lost reply');
    await storage.cleanup(deadline + 1);
    check(await storage.get(`${session.account.id}:cache:${original.id}`) === undefined, 'Original survived its expiry');
    const after = await storage.get<{ message: Message }>(`${session.account.id}:cache:${reply.id}`);
    check(after?.message.text === 'reply body survives' && quotedText(undefined, after.message.replyToExpiresAt, deadline + 1) === translator('en')('extension.copy.originalExpired'), 'Expired original lost its accurate placeholder');
    const row = (await storage.rows(session.account.id, 'cache')).find(row => row.key.endsWith(reply.id));
    check(row?.expiresAt === replyTime + 30 * day, 'Reference changed the reply lifetime');
    result.checks.push('Late original supplies only a local reference deadline; original expiry removes its body while reply and its own deadline remain intact');

    const local: Message = { id: 'bubble-transaction', teamId: 'bubble-team', author: session.account.id, text: 'bubble fixture', time: '12:00', status: 'sending' };
    const confirmedId = '$bubble-event';
    service.state.remoteTeams = [remoteTeam({ id: local.teamId, roomId: '!bubble:local.test', periods: [{ joinedAt: now - 1000, leftAt: null }], people: [{ bio: '', tags: [], deleted: false, id: session.account.id, nickname: 'fixture', avatarId: null, matrixId: session.account.matrixId }], memberIds: [session.account.id] })];
    service.state.data.messages = [local];
    service.sending.outgoing.set(local.id, { message: local, createdAt: now, eventId: confirmedId });
    const emitted: number[] = [];
    const unsubscribe = service.subscribe(state => emitted.push(state.data.messages.filter(message => message.teamId === local.teamId).length));
    const event = (transaction = false) => decryptedEvent({ event_id: confirmedId, room_id: '!bubble:local.test', sender: session.account.matrixId, type: 'm.room.message', origin_server_ts: now, content: { msgtype: 'm.text', body: local.text }, unsigned: transaction ? { transaction_id: local.id } : {} });
    await service.timeline.consume(await event());
    check(service.state.data.messages.length === 1 && service.state.data.messages[0]?.clientId === local.id, 'Fetch acknowledgement duplicated the optimistic bubble or lost its render identity');
    await service.timeline.consume(await event(true));
    await service.timeline.consume(await event());
    unsubscribe();
    check(emitted.every(count => count === 1), 'An emitted snapshot contained duplicate bubbles');
    check(service.state.data.messages[0]?.clientId === local.id && service.state.data.messages[0]?.status === 'sent', 'Sync or replay replaced the stable render identity');
    result.checks.push('Fetch acknowledgement without transaction metadata, sync and replay preserve one bubble and its render identity in every emitted snapshot');
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  finally {
    await auth.clearDevice();
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    result.cleaned = true; output.textContent = JSON.stringify(result, null, 2); button.disabled = false;
    reviewStatus(result.error ? 'failed' : 'passed');
  }
}
button.addEventListener('click', () => void run());
if (autoRun) void run();
