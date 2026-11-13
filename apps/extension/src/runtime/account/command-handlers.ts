import { message as uiMessage, MessageError } from '@palside/i18n';
import { generateMnemonic, normalizeMnemonic, isValidMnemonic, deriveIdentity, sealMnemonic, isValidPin } from '@palside/shared/identity';
import { unlockLocalMnemonic, LocalPasswordError } from './local-password';
import { approveIdentities } from './crypto-identity';
import { deviceLabel } from './device-label';
import { ApiError, type ApiResult } from '../transport/api';
import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { commandError } from '../composition/commands';
import type { RuntimeCommands } from '../composition/dispatch';
import type { SignupPhase } from '../composition/runtime-state';
import type { HandlerRegistry } from '../composition/handler-registry';
import { signedIn } from '../composition/signed-in';
import { liveMembers } from '../../domain/teams/model.ts';

type Payload<N extends Command['name']> = Extract<Command, { name: N }>;

const SIGNUP_CHECK_DELAY_MS = 1_500;

async function localMnemonic(commands: RuntimeCommands, password: string, check: () => void) {
  const accountId = signedIn(commands).accountId;
  try { return await unlockLocalMnemonic({ storage: commands.runtime.storage, accountId, password, check }); }
  catch (error) {
    check();
    if (!(error instanceof LocalPasswordError)) throw error;
    if (error.code === 'WRONG_PASSWORD') throw commandError(error.code, 'extension.runtime.wrongPassword');
    if (error.code === 'LOGIN_INCOMPLETE') throw commandError(error.code, 'extension.runtime.loginIncomplete');
    throw error;
  }
}

/** Forgets the phrase being set up and anything derived from it. */
function forgetSetup(commands: RuntimeCommands) {
  const auth = commands.runtime.auth;
  auth.mnemonic = undefined; auth.pendingIdentity = undefined; auth.authMode = undefined;
}

export async function accountGenerateCommand(this: RuntimeCommands) {
  const auth = this.runtime.auth;
  const attempt = auth.authenticationScope();
  attempt.check();
  await attempt.wait(auth.discardPendingDevice());
  forgetSetup(this);
  auth.mnemonic = generateMnemonic();
  return { words: auth.mnemonic.split(' ') };
}

export async function accountDiscardCommand(this: RuntimeCommands) {
  const auth = this.runtime.auth;
  auth.cancelAuthentication();
  const session = auth.session ?? auth.pendingDevice;
  await Promise.all([auth.clearDevice(), session ? auth.revokeDevice(session) : Promise.resolve(true)]);
}

/**
 * 取消 while signup is still preparing: the attempt stops and the PIN step comes back with the same phrase, so the words the
 * person just wrote down stay theirs. A registration that was already sent is confirmed by the next try (ACCOUNT_EXISTS joins it).
 */
export async function signupCancelCommand(this: RuntimeCommands) {
  const runtime = this.runtime;
  runtime.auth.beginAuthentication();
  if (runtime.state.setup !== 'password' || !runtime.auth.mnemonic) return;
  runtime.state.signupPhase = undefined; runtime.state.signupWaiting = undefined; runtime.state.signupChecking = undefined;
  runtime.emit();
}

/**
 * Moves a phrase to the PIN step. `account-create` uses the phrase just generated; `account-login` and `account-import` take
 * typed words, so any standard 12-word phrase works: sign-in for an existing account, a new account for one that has none
 * (never registered, or deleted).
 */
export async function accountCreateCommand(this: RuntimeCommands, command: Payload<'account-create' | 'account-login' | 'account-import'>) {
  const runtime = this.runtime, auth = runtime.auth;
  const attempt = auth.authenticationScope();
  attempt.check();
  await attempt.wait(auth.discardPendingDevice());
  auth.pendingIdentity = undefined; auth.authMode = undefined;
  const login = command.name === 'account-login';
  if (command.name !== 'account-create') auth.mnemonic = normalizeMnemonic(command.payload.words.filter((word): word is string => typeof word === 'string'));
  if (!auth.mnemonic || !isValidMnemonic(auth.mnemonic)) { forgetSetup(this); throw commandError('INVALID_MNEMONIC', 'extension.runtime.invalidMnemonic'); }
  auth.pendingIdentity = deriveIdentity(auth.mnemonic);
  try {
    // Sign-in learns here, before the PIN step, whether the account exists and still has room for a device.
    if (login) await attempt.wait(runtime.api.request('accounts.lookup', { secretKey: auth.pendingIdentity.secretKey, signal: attempt.signal }));
  } catch (error) {
    attempt.check();
    if (login && error instanceof ApiError && ['ACCOUNT_NOT_FOUND', 'DEVICE_LIMIT'].includes(error.code)) {
      forgetSetup(this);
      if (error.code === 'ACCOUNT_NOT_FOUND') throw commandError(error.code, 'extension.runtime.notPalsideAccount');
    }
    throw error;
  }
  auth.authMode = login ? 'login' : 'create';
  runtime.state.setup = 'password'; runtime.emit();
}

/**
 * The PIN step does the whole sign-in: seal the phrase, register (or add) the device, connect encrypted chat, bind the 零钱
 * address that is the account ID, and only then write the device and vault. Any failure stays on this step and the retry
 * reuses the device already registered.
 */
export async function passwordSetCommand(this: RuntimeCommands, command: Payload<'password-set'>) {
  const runtime = this.runtime, auth = runtime.auth;
  if (runtime.state.setup !== 'password' || !auth.mnemonic || !auth.pendingIdentity || !auth.authMode) throw commandError('LOGIN_INCOMPLETE', 'extension.runtime.loginIncomplete');
  const identity = auth.pendingIdentity, mnemonic = auth.mnemonic;
  const password = text(command.payload.password); if (!isValidPin(password)) throw commandError('PIN_INVALID', 'extension.runtime.pinInvalid');
  const token = runtime.api.token;
  const attempt = auth.authenticationScope();
  attempt.check();
  const phase = (next: SignupPhase) => { if (attempt.current()) { runtime.state.signupPhase = next; runtime.emit(); } };
  try {
    phase('seal');
    await attempt.wait(auth.finishCleanup());
    const vault = await attempt.wait(sealMnemonic(mnemonic, password));
    if (!auth.pendingDevice) {
      phase('register');
      const body = { label: deviceLabel() };
      const storageKey = [...crypto.getRandomValues(new Uint8Array(32))];
      const result = auth.authMode === 'create' ? await register.call(this, body, identity.secretKey, attempt)
        : await runtime.api.request('devices.create', { body, secretKey: identity.secretKey, signal: attempt.signal });
      if (!attempt.current()) {
        await auth.revokeDevice({ ...result, storageKey });
        attempt.check();
      }
      auth.pendingDevice = { ...result, storageKey };
    }
    const session = auth.pendingDevice;
    await attempt.wait(runtime.storage.put('pending-device', session.account.id, 'device', session));
    phase('connect');
    await attempt.wait(auth.connect(session, identity));
    const connected = auth.scope();
    const guard = () => { attempt.check(); connected.check(); if (!auth.client || !auth.cryptoInitialised) throw new MessageError(uiMessage('extension.runtime.loginChanged')); };
    guard();
    phase('wallet');
    try { await runtime.wallet.bindAccount(mnemonic); }
    catch (error) { guard(); throw error instanceof ApiError ? error : new MessageError(uiMessage('extension.runtime.walletBindFailed')); }
    guard();
    await runtime.storage.putMany([
      { key: 'device', account: session.account.id, kind: 'device', value: session },
      { key: 'vault', account: session.account.id, kind: 'vault', value: vault },
    ]);
    guard();
    // The address is bound; balance and payment state can load later, so their failure does not stop sign-in.
    await runtime.wallet.start(mnemonic).catch(() => {}); guard();
    await runtime.storage.remove('pending-device').catch(() => {}); guard();
    forgetSetup(this); auth.pendingDevice = undefined;
    runtime.state.setup = undefined; runtime.state.signupPhase = undefined;
    runtime.state.authenticated = true; runtime.state.error = undefined; runtime.emit();
    return { nicknameRequired: !session.account.nickname };
  } catch (error) {
    if (!attempt.current()) throw error instanceof ApiError && error.code === 'RESULT_UNKNOWN' ? error : new MessageError(uiMessage('extension.runtime.loginChanged'));
    auth.liveDispose?.(); auth.liveDispose = undefined; auth.liveOpen = false;
    clearTimeout(auth.deviceStateTimer); auth.deviceStateTimer = undefined;
    const client = auth.client; auth.client = undefined; client?.stopClient(); auth.cryptoInitialised = false;
    auth.generation++; runtime.rooms.reset(); runtime.wallet.reset(); auth.session = undefined; runtime.state.authenticated = false; runtime.state.account = undefined; runtime.api.token = token;
    runtime.timeline.readyForLiveEvents = false; runtime.state.connection.messaging = 'unavailable'; runtime.state.setup = 'password'; runtime.state.signupPhase = undefined; runtime.emit();
    throw error instanceof MessageError || error instanceof ApiError ? error : new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
  }
}

/**
 * Creates the account with proof of work. Sent but unanswered: confirm once with the same identity — an account that was
 * created answers ACCOUNT_EXISTS and this device joins it; one that was not is created now. A second unknown is reported.
 */
async function register(this: RuntimeCommands, body: { label: string }, secretKey: Uint8Array, attempt: ReturnType<RuntimeCommands['runtime']['auth']['authenticationScope']>): Promise<ApiResult<'accounts.create'>> {
  const runtime = this.runtime;
  runtime.state.config = await attempt.wait(runtime.api.request('system.config', { signal: attempt.signal }));
  const difficulty = runtime.state.config.signupDifficulty;
  const once = async () => {
    try {
      return await runtime.api.request('accounts.create', { body, secretKey, difficulty, signal: attempt.signal,
        onProofOfWorkSlow: () => { if (attempt.current()) { runtime.state.signupWaiting = true; runtime.emit(); } },
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESULT_UNKNOWN') throw error;
      attempt.check();
      if (!(error instanceof ApiError) || error.code !== 'ACCOUNT_EXISTS') throw error;
      return await runtime.api.request('devices.create', { body, secretKey, signal: attempt.signal });
    }
  };
  try {
    try { return await once(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'RESULT_UNKNOWN') throw error;
      // Cancelled after it was sent: the outcome stays unknown rather than reading as a clean cancel.
      if (!attempt.current()) throw error;
      runtime.state.signupChecking = true; runtime.emit();
      await attempt.wait(new Promise(resolve => setTimeout(resolve, SIGNUP_CHECK_DELAY_MS)));
      return await once();
    }
  } finally {
    if (attempt.current() && (runtime.state.signupWaiting || runtime.state.signupChecking)) { runtime.state.signupWaiting = undefined; runtime.state.signupChecking = undefined; runtime.emit(); }
  }
}

export async function deviceStateCommand(this: RuntimeCommands, command: Payload<'device-state'>) {
  const state = command.payload?.state;
  if (state !== 'active' && state !== 'away') throw new MessageError(uiMessage('common.error'));
  this.runtime.auth.deviceState = state;
  this.runtime.auth.scheduleDeviceStateReport();
}

export async function mnemonicRevealCommand(this: RuntimeCommands, command: Payload<'mnemonic-reveal'>) {
  const scope = this.runtime.auth.scope();
  signedIn(this);
  return { words: (await localMnemonic(this, text(command.payload.password), scope.check)).split(' ') };
}

export async function devicesCommand(this: RuntimeCommands) {
  signedIn(this);
  return this.runtime.api.request('devices.list');
}

/** Removes another device; this one leaves through 退出登录. */
export async function deviceRemoveCommand(this: RuntimeCommands, command: Payload<'device-remove'>) {
  const runtime = this.runtime;
  const scope = runtime.auth.scope(), attempt = runtime.auth.authenticationScope();
  const { session } = signedIn(this), id = text(command.payload.id);
  if (id === session.matrix.deviceId) throw new MessageError(uiMessage('common.error'));
  const { secretKey } = deriveIdentity(await localMnemonic(this, text(command.payload.password), scope.check));
  await runtime.api.request('devices.remove', { params: { id }, secretKey, signal: attempt.signal }); scope.check();
}

export async function identityApproveCommand(this: RuntimeCommands, command: Payload<'identity-approve'>) {
  const runtime = this.runtime;
  runtime.auth.requireConnection();
  const team = runtime.state.remoteTeams.find(item => item.id === text(command.payload.teamId) && item.joined);
  if (!team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
  await approveIdentities(runtime.auth.client, liveMembers(team).map(person => person.matrixId));
}

export async function logoutCommand(this: RuntimeCommands) {
  const runtime = this.runtime, auth = runtime.auth;
  const session = auth.session ?? auth.pendingDevice;
  const revoked = session ? auth.revokeDevice(session) : Promise.resolve(true);
  const [, remote] = await Promise.all([auth.clearDevice(true), revoked]);
  if (!remote) runtime.state.error = uiMessage('extension.runtime.localLogoutOnly');
  runtime.emit();
  return { remote };
}

export async function reconnectCommand(this: RuntimeCommands) {
  signedIn(this);
  return this.runtime.auth.reconnect();
}

export async function profileCommand(this: RuntimeCommands, command: Payload<'profile'>) {
  const runtime = this.runtime;
  signedIn(this);
  const scope = runtime.auth.scope(), p = command.payload ?? {};
  await scope.wait(runtime.api.request('accounts.update', { body: { nickname: p.name, bio: p.bio, tags: p.tags } }));
  await scope.wait(runtime.refresh());
}

export async function deleteAccountCommand(this: RuntimeCommands, command: Payload<'delete-account'>) {
  const runtime = this.runtime;
  const scope = runtime.auth.scope(), attempt = runtime.auth.authenticationScope();
  signedIn(this);
  const { secretKey } = deriveIdentity(await localMnemonic(this, text(command.payload.password), scope.check));
  await runtime.api.request('accounts.delete', { secretKey, signal: attempt.signal }); scope.check();
  await runtime.auth.clearDevice(false);
}

export const accountHandlers = {
  'account-generate': accountGenerateCommand,
  'account-discard': accountDiscardCommand,
  'signup-cancel': signupCancelCommand,
  'account-create': accountCreateCommand,
  'account-login': accountCreateCommand,
  'account-import': accountCreateCommand,
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
