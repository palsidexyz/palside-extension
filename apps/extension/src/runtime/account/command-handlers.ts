import { message as uiMessage,MessageError } from '@palside/i18n';
import { generateMnemonic,normalizeMnemonic,isValidMnemonic,deriveIdentity,sealMnemonic,isValidPin,type Identity } from '@palside/shared/identity';
import { unlockLocalMnemonic, LocalPasswordError } from './local-password';
import { approveIdentities } from './crypto-identity';
import { deviceLabel } from './device-label';
import { ApiError,type ApiResult } from '../transport/api';
import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { commandError } from '../composition/commands';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

async function localMnemonic(commands: RuntimeCommands, password: string, check: () => void) {
  const runtime = commands.runtime;
  const accountId = runtime.auth.session?.account.id;
  if (!accountId) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
  try { return await unlockLocalMnemonic({ storage: runtime.storage, accountId, password, check }); }
  catch (error) {
    check();
    if (!(error instanceof LocalPasswordError)) throw error;
    if (error.code === 'WRONG_PASSWORD') throw commandError(error.code, 'extension.runtime.wrongPassword');
    if (error.code === 'LOGIN_INCOMPLETE') throw commandError(error.code, 'extension.runtime.loginIncomplete');
    throw error;
  }
}

export async function accountGenerateCommand(this: RuntimeCommands) {
    const runtime = this.runtime;

      const attempt = runtime.auth.authenticationScope();
      attempt.check();
      await attempt.wait(runtime.auth.discardPendingDevice());
      runtime.auth.mnemonic = generateMnemonic(); runtime.auth.pendingIdentity = undefined; runtime.auth.authMode = undefined; return { words: runtime.auth.mnemonic.split(' ') };
}

export async function accountDiscardCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
 runtime.auth.cancelAuthentication();
 const session = runtime.auth.session ?? runtime.auth.pendingDevice;
 await Promise.all([runtime.auth.clearDevice(), session ? runtime.auth.revokeDevice(session) : Promise.resolve(true)]); return;
}

export async function accountCreateCommand(this: RuntimeCommands, command: Extract<Command, { name: "account-create" | "account-login" }>) {
    const { name } = command;
    const runtime = this.runtime;

      const attempt = runtime.auth.authenticationScope();
      attempt.check();
      await attempt.wait(runtime.auth.discardPendingDevice()); runtime.auth.pendingIdentity = undefined; runtime.auth.authMode = undefined;
      const words = command.name === 'account-login' ? (Array.isArray(command.payload.words) ? command.payload.words.filter((word): word is string => typeof word === 'string') : []) : undefined;
      if (words) runtime.auth.mnemonic = normalizeMnemonic(words);
      if (!runtime.auth.mnemonic || !isValidMnemonic(runtime.auth.mnemonic)) { runtime.auth.mnemonic = undefined; runtime.auth.pendingIdentity = undefined; runtime.auth.authMode = undefined; throw commandError('INVALID_MNEMONIC', 'extension.runtime.invalidMnemonic'); }
      runtime.auth.pendingIdentity = deriveIdentity(runtime.auth.mnemonic);
      try {
        if (name === 'account-login') await attempt.wait(runtime.api.request('accounts.lookup', { secretKey: runtime.auth.pendingIdentity.secretKey, signal: attempt.signal }));
        runtime.auth.authMode = name === 'account-create' ? 'create' : 'login';
        runtime.state.setup = 'password'; runtime.emit(); return;
      } catch (error) {
        attempt.check();
        if (error instanceof ApiError && name === 'account-login' && error.status === 404) { runtime.auth.mnemonic = undefined; runtime.auth.pendingIdentity = undefined; runtime.auth.authMode = undefined; throw commandError('ACCOUNT_NOT_FOUND', 'extension.runtime.notPalsideAccount'); }
        throw error;
      }
}

export async function passwordSetCommand(this: RuntimeCommands, command: Extract<Command, { name: "password-set" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      if (runtime.state.setup !== 'password' || !runtime.auth.mnemonic || !runtime.auth.pendingIdentity || !runtime.auth.authMode) throw commandError('LOGIN_INCOMPLETE', 'extension.runtime.loginIncomplete');
      const identity = runtime.auth.pendingIdentity;
      const password = text(p.password); if (!isValidPin(password)) throw commandError('PIN_INVALID', 'extension.runtime.pinInvalid');
      const token = runtime.api.token;
      const attempt = runtime.auth.authenticationScope();
      attempt.check();
      try {
        await attempt.wait(runtime.auth.finishCleanup());
        const vault = await attempt.wait(sealMnemonic(runtime.auth.mnemonic, password));
        if (!runtime.auth.pendingDevice) {
          const body = { label: deviceLabel() };
          const storageKey = [...crypto.getRandomValues(new Uint8Array(32))];
          let result: ApiResult<'accounts.create'>;
          if (runtime.auth.authMode === 'create') {
            if (!runtime.state.config.signupDifficulty) runtime.state.config = await attempt.wait(runtime.api.request('system.config', { signal: attempt.signal }));
            try { result = await runtime.api.request('accounts.create', { body, secretKey: identity.secretKey, difficulty: runtime.state.config.signupDifficulty, signal: attempt.signal }); }
            catch (error) {
              if (error instanceof ApiError && error.code === 'RESULT_UNKNOWN') throw error;
              attempt.check();
              if (!(error instanceof ApiError) || error.code !== 'ACCOUNT_EXISTS') throw error;
              result = await runtime.api.request('devices.create', { body, secretKey: identity.secretKey, signal: attempt.signal });
            }
          } else result = await runtime.api.request('devices.create', { body, secretKey: identity.secretKey, signal: attempt.signal });
          if (!attempt.current()) {
            await runtime.auth.revokeDevice({ ...result, storageKey });
            attempt.check();
          }
          runtime.auth.pendingDevice = { ...result, storageKey };
        }
        const session = runtime.auth.pendingDevice;
        await attempt.wait(runtime.storage.put('pending-device', session.account.id, 'device', session));
        await attempt.wait(runtime.auth.connect(session, identity));
        const connected = runtime.auth.scope();
        const guard = () => { attempt.check(); connected.check(); if (!runtime.auth.client || !runtime.auth.cryptoInitialised) throw new MessageError(uiMessage('extension.runtime.loginChanged')); };
        guard();
        await runtime.storage.putMany([
          { key: 'device', account: session.account.id, kind: 'device', value: session },
          { key: 'vault', account: session.account.id, kind: 'vault', value: vault },
        ]);
        guard();
        await runtime.wallet.start(runtime.auth.mnemonic).catch(() => {}); guard();
        await runtime.storage.remove('pending-device').catch(() => {}); guard();
        runtime.auth.mnemonic = undefined; runtime.auth.pendingIdentity = undefined; runtime.auth.pendingDevice = undefined; runtime.auth.authMode = undefined; runtime.state.setup = undefined;
        runtime.state.authenticated = true; runtime.state.error = undefined; runtime.emit();
        return { nicknameRequired: !session.account.nickname };
      } catch (error) {
        if (!attempt.current()) throw error instanceof ApiError && error.code === 'RESULT_UNKNOWN' ? error : new MessageError(uiMessage('extension.runtime.loginChanged'));
        runtime.auth.liveDispose?.(); runtime.auth.liveDispose = undefined; runtime.auth.sseOpen = false;
        clearTimeout(runtime.auth.deviceStateTimer); runtime.auth.deviceStateTimer = undefined;
        const client = runtime.auth.client; runtime.auth.client = undefined; client?.stopClient(); runtime.auth.cryptoInitialised = false;
        runtime.auth.generation++; runtime.rooms.reset(); runtime.auth.session = undefined; runtime.state.authenticated = false; runtime.state.account = undefined; runtime.api.token = token;
        runtime.timeline.readyForLiveEvents = false; runtime.state.connection.messaging = 'unavailable'; runtime.state.setup = 'password'; runtime.emit();
        throw error instanceof MessageError || error instanceof ApiError ? error : new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
      }
}

export async function deviceStateCommand(this: RuntimeCommands, command: Extract<Command, { name: "device-state" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      if (p.state !== 'active' && p.state !== 'away') throw new MessageError(uiMessage('common.error'));
      runtime.auth.deviceState = p.state;
      runtime.auth.scheduleDeviceStateReport();
      return;
}

export async function mnemonicRevealCommand(this: RuntimeCommands, command: Extract<Command, { name: "mnemonic-reveal" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      const scope = runtime.auth.scope();
      if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
      return { words: (await localMnemonic(this, text(p.password), scope.check)).split(' ') };
}

export async function devicesCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
 if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst')); return runtime.api.request('devices.list');
}

export async function deviceRemoveCommand(this: RuntimeCommands, command: Extract<Command, { name: "device-remove" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      const scope = runtime.auth.scope();
      const attempt = runtime.auth.authenticationScope();
      if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
      const identity: Identity = deriveIdentity(await localMnemonic(this, text(p.password), scope.check));
      await runtime.api.request('devices.remove', { params: { id: text(p.id) }, secretKey: identity.secretKey, signal: attempt.signal }); scope.check();
      if (text(p.id) === runtime.auth.session.matrix.deviceId) await runtime.auth.clearDevice(false); return;
}

export async function identityApproveCommand(this: RuntimeCommands, command: Extract<Command, { name: "identity-approve" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      runtime.auth.requireConnection();
      const team = runtime.state.remoteTeams.find(item => item.id === text(p.teamId) && item.joined);
      if (!team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      await approveIdentities(runtime.auth.client, team.people.filter(person => team.memberIds.includes(person.id)).map(person => person.matrixId)); return;
}

export async function logoutCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
 const session = runtime.auth.session ?? runtime.auth.pendingDevice;
 const revoked = session ? runtime.auth.revokeDevice(session) : Promise.resolve(true); const [, remote] = await Promise.all([runtime.auth.clearDevice(true), revoked]); if (!remote) runtime.state.error = uiMessage('extension.runtime.localLogoutOnly'); runtime.emit(); return { remote };
}

export async function reconnectCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
return runtime.auth.reconnect();
}

export async function profileCommand(this: RuntimeCommands, command: Extract<Command, { name: "profile" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
 await scope.wait(runtime.api.request('accounts.update', { body: { nickname: p.name, bio: p.bio, tags: p.tags } })); await scope.wait(runtime.refresh()); return;
}

export async function deleteAccountCommand(this: RuntimeCommands, command: Extract<Command, { name: "delete-account" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const attempt = runtime.auth.authenticationScope();

      if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
      const secretKey = deriveIdentity(await localMnemonic(this, text(p.password), scope.check)).secretKey;
      await runtime.api.request('accounts.delete', { secretKey, signal: attempt.signal }); scope.check(); await runtime.auth.clearDevice(false); return;
}

export const accountHandlers = {
  'account-generate': accountGenerateCommand,
  'account-discard': accountDiscardCommand,
  'account-create': accountCreateCommand,
  'account-login': accountCreateCommand,
  'password-set': passwordSetCommand,
  'device-state': deviceStateCommand,
  'mnemonic-reveal': mnemonicRevealCommand,
  'devices': devicesCommand,
  'device-remove': deviceRemoveCommand,
  'identity-approve': identityApproveCommand,
  'logout': logoutCommand,
  'reconnect': reconnectCommand,
  'profile': profileCommand,
  'delete-account': deleteAccountCommand,
} satisfies HandlerRegistry;
