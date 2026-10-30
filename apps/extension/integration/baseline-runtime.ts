import { MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import { remoteTeam } from './fixtures';

/** Real runtime command and expiry paths, with an inert Matrix transport and an isolated local database. */
export async function verifyRuntimeBoundaries(initial: RuntimeState, check: (value: unknown, label: string) => void, show: (state: RuntimeState) => Promise<void>) {
  const name = `palside-ui-check-${crypto.randomUUID()}`;
  const storage = new ClientStorage(name);
  const runtime = new PalsideService(async () => {}, async () => true, storage);
  runtime.initialise = async () => {};
  runtime.auth.connectLiveEvents = () => () => {};
  runtime.api.request = async () => { throw Error('The fixture runtime must not request a service'); };
  runtime.state = structuredClone(initial);
  runtime.state.data.messages = [];
  runtime.state.drafts = {};
  runtime.state.remoteTeams = [remoteTeam({ id: 'night', roomId: '!night:example.test', memberIds: ['you', 'mia'], people: [{ bio: '', tags: [], deleted: false, id: 'mia', nickname: 'Mia', avatarId: null, matrixId: '@mia:example.test' }] })];
  const session = { token: 'fixture-only', account: runtime.state.account!, matrix: { userId: '@you:example.test', deviceId: 'fixture' }, storageKey: Array<number>(32).fill(0), crypto: 'ready' as const };
  runtime.auth.session = session;
  const room = { oldState: { paginationToken: 'more' as string | null } };
  const pages: number[] = [];
  runtime.auth.client = { getRoom: () => room, scrollback: async (_room: unknown, count: number) => { pages.push(count); room.oldState.paginationToken = pages.length === 1 ? 'continue' : null; } } as unknown as MatrixClient;
  try {
    const initialiseCrypto = MatrixClient.prototype.initRustCrypto;
    const startClient = MatrixClient.prototype.startClient;
    const stopBeforeNetwork = Error('Fixture transport boundary');
    let initialLimit: number | undefined;
    const inertClient = runtime.auth.client;
    runtime.auth.client = undefined;
    runtime.auth.refresh = async () => {};
    try {
      MatrixClient.prototype.initRustCrypto = async () => {};
      MatrixClient.prototype.startClient = async options => { initialLimit = options?.initialSyncLimit; throw stopBeforeNetwork; };
      await runtime.auth.connectRuntimeDevice(session).then(() => { throw Error('The fixture unexpectedly started sync'); }, error => { if (error !== stopBeforeNetwork) throw error; });
      check(initialLimit === 100, 'Starting a saved account requests one hundred messages in its initial Matrix sync');
    } finally {
      (runtime.auth.client as MatrixClient | undefined)?.stopClient();
      MatrixClient.prototype.initRustCrypto = initialiseCrypto;
      MatrixClient.prototype.startClient = startClient;
      runtime.auth.client = inertClient;
      runtime.state.connection = { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false };
      runtime.state.preferences.current = 'night';
    }
    await runtime.command({ name: 'history', payload: { teamId: 'night' } });
    check(pages[0] === 100 && runtime.state.history?.night?.loaded === false && runtime.state.history.night.loading === false, 'Loading earlier messages requests one hundred entries and keeps pagination available');
    await runtime.command({ name: 'history', payload: { teamId: 'night' } });
    check(pages[1] === 100 && runtime.state.history?.night?.loaded === true && runtime.state.history.night.loading === false, 'The next history request also uses one hundred entries and recognizes the exhausted cursor');
    const now = Date.now;
    const at = now();
    const event = (age: number) => ({ isEncrypted: () => true, getSender: () => '@mia:example.test', getContent: () => ({ id: `poke${age}`, teamId: 'night', sentAt: at - age, view: { ...initial.data.views[0]!, version: 1 } }) }) as unknown as MatrixEvent;
    try {
      Date.now = () => at;
      await runtime.interactions.consumePoke(event(10_001), session);
      check(!runtime.state.pokes?.length, 'A viewing invitation older than ten seconds is not replayed on receipt');
      await runtime.interactions.consumePoke(event(10_000), session);
      check(runtime.state.pokes?.length === 1, 'A viewing invitation exactly ten seconds old can still arrive');
      await show(runtime.state);
      Date.now = () => at + 59_999;
      await runtime.cache.expireLocalContent();
      check(runtime.state.pokes?.length === 1, 'A received viewing invitation remains before its sixty second display deadline');
      Date.now = () => at + 60_000;
      await runtime.cache.expireLocalContent();
      check(runtime.state.pokes?.length === 0 && runtime.state.data.messages.length === 0, 'The display deadline removes viewing invitations without adding chat history');
      await show(runtime.state);
    } finally { Date.now = now; }
  } finally {
    const database = await (storage as unknown as { database: Promise<IDBDatabase> }).database;
    database.close();
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Fixture database remained open')); });
  }
}
