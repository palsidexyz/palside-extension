import { productionModules } from './production-module.mjs';
import { languageGlobals } from './language-host.mjs';
import { deriveIdentity } from '../../packages/shared/src/identity.ts';

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
export function loginHost(t) {
  const identity = deriveIdentity(words.join(' ')), stored = new Map(), clients = [], calls = [];
  const started = Promise.withResolvers(), verifying = Promise.withResolvers(), verify = Promise.withResolvers();
  let published = false, signed = false;
  const account = { id: identity.publicKey, nickname: 'Self' };
  const session = { token: 'token', account, matrix: { userId: '@self:test', deviceId: 'SELF' } };
  const event = {
    getRoomId: () => '!team:test', getId: () => '$initial', getTs: () => Date.now(),
    isEncrypted: () => true, isBeingDecrypted: () => false, shouldAttemptDecryption: () => false, isDecryptionFailure: () => false,
    isRedaction: () => false, isRedacted: () => false, getType: () => 'm.room.message',
    getUnsigned: () => ({}), getSender: () => '@peer:test', getContent: () => ({ msgtype: 'm.text', body: 'Initial message' }),
  };
  const context = {
    ...languageGlobals, deviceLabel: () => 'Test browser',
    ClientEvent: { Sync: 'sync', ToDeviceEvent: 'device' }, RoomEvent: { Timeline: 'timeline' }, MatrixEventEvent: { Decrypted: 'decrypted' },
    EventType: { RoomMessage: 'm.room.message' }, MsgType: { Text: 'm.text' }, PendingEventOrdering: { Detached: 'detached' }, MatrixScheduler: class {},
    connectLiveEvents: () => () => {},
    fetch: async (_url, init) => { const keys = JSON.parse(init.body).device_keys; if (keys?.user_id === session.matrix.userId && keys.device_id === session.matrix.deviceId) published = true; return new Response('{}'); },
    createClient(options) {
      const handlers = new Map();
      const room = { oldState: {}, getLiveTimeline: () => ({ getEvents: () => [event] }) };
      const crypto = {
        setDeviceIsolationMode() {}, userHasCrossSigningKeys: async () => false,
        bootstrapSecretStorage: async () => { calls.push('bootstrap'); }, bootstrapCrossSigning: async () => {},
        crossSignDevice: async () => { calls.push('sign'); signed = true; },
      };
      const client = {
        options, starts: 0, stops: 0, getCrypto: () => crypto,
        getUserId: () => options.userId, getDeviceId: () => options.deviceId,
        initRustCrypto: async () => {}, clearStores: async () => {},
        on: (name, listener) => handlers.set(name, listener), removeListener: (name, listener) => { if (handlers.get(name) === listener) handlers.delete(name); },
        emit: (...args) => handlers.get('sync')?.(...args),
        getSyncState: () => 'PREPARED', getRooms: () => [room], getRoom: () => room,
        stopClient() { this.stops++; },
        async startClient() { this.starts++; calls.push('start'); started.resolve(); },
        async downloadKeysForUsers() {
          if (signed) { calls.push('verify'); verifying.resolve(); await verify.promise; }
          return { self_signing_keys: { '@self:test': { keys: { signing: 'key' } } }, device_keys: { '@self:test': published ? { SELF: { signatures: signed ? { '@self:test': { signing: 'signature' } } : {} } } : {} } };
        },
      };
      clients.push(client); return client;
    },
  };
  const { PalsideService } = productionModules(context)('apps/extension/src/runtime/composition/core.ts');
  const storage = {
    get: async key => structuredClone(stored.get(key)), rows: async () => [], cache: async () => [],
    put: async (key, _account, _kind, value) => { stored.set(key, structuredClone(value)); },
    putMany: async rows => { calls.push('commit'); for (const row of rows) stored.set(row.key, structuredClone(row.value)); },
    remove: async key => { stored.delete(key); }, clearAccount: async () => {}, cleanup: async () => {},

  };
  const runtime = new PalsideService(undefined, undefined, storage);
  runtime.initialise = async () => {};
  runtime.state.config.websiteUrl = 'https://site.test';
  runtime.api.request = async endpoint => {
    if (endpoint === 'accounts.lookup') return { account };
    if (endpoint === 'devices.create') return structuredClone(session);
    if (endpoint === 'rooms.blocks') return { people: [] };
    if (endpoint === 'invites.list') return { invites: [] };
    if (endpoint === 'accounts.logout') return {};
    if (endpoint === 'chain.config') return { enabled: false, version: 1, deployment: null };
    throw new Error(`Unexpected login-host endpoint ${endpoint}`);
  };
  runtime.auth.fetchSnapshot = async () => {
    runtime.state.connection.service = 'ready';
    runtime.state.remoteTeams = [{ id: 'team', roomId: '!team:test', joined: true, retentionDays: 7, periods: [{ joinedAt: 1, leftAt: null }], memberIds: [account.id, 'peer'], people: [{ id: 'peer', matrixId: '@peer:test' }], preferences: { readIds: [] } }];
    runtime.state.data.people = [{ id: account.id }, { id: 'peer', matrixId: '@peer:test' }];
  };
  t.after(() => { runtime.auth.identityAbort?.abort(); runtime.auth.liveDispose?.(); runtime.rooms.reset(); runtime.wallet.reset(); clearTimeout(runtime.auth.deviceStateTimer); });
  const upload = body => clients[0].options.fetchFn('https://service.test/_matrix/client/v3/keys/upload', { method: 'POST', body: JSON.stringify(body) });
  return { runtime, stored, clients, calls, started, verifying, verify, upload,
    async begin() { await runtime.command({ name: 'account-login', payload: { words } }); return runtime.command({ name: 'password-set', payload: { password: '123456' } }); },
  };
}
