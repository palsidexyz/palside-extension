import { message as uiMessage,MessageError } from '@palside/i18n';
import type { CryptoCallbacks,GeneratedSecretStorageKey } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { OnlySignedDevicesIsolationMode } from 'matrix-js-sdk/lib/crypto-api/index.js';
import type { MatrixClient } from 'matrix-js-sdk';
import type { UIAuthCallback } from 'matrix-js-sdk/lib/interactive-auth.js';
import type { PalsideService } from '../composition/core';

/** Capture business membership and the SDK session before any asynchronous preparation. */
export function teamSendGuard(runtime: PalsideService, teamId: string, requireCurrent = false) {
  const scope = runtime.auth.scope(), session = runtime.auth.session, client = runtime.auth.client;
  const team = runtime.state.remoteTeams.find(item => item.id === teamId && item.joined);
  if (!session || !client || !team) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
  const membership = (value: typeof team) => JSON.stringify([value.roomId, [...value.memberIds].sort(), value.people.filter(person => value.memberIds.includes(person.id)).map(person => [person.id, person.matrixId, !!person.deleted]).sort()]);
  const snapshot = membership(team);
  const check = () => {
    scope.check();
    if (runtime.auth.session !== session || runtime.auth.client !== client) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
    runtime.auth.requireConnection();
    const latest = runtime.state.remoteTeams.find(item => item.id === teamId && item.joined);
    if (!latest || !latest.memberIds.includes(session.account.id) || membership(latest) !== snapshot || runtime.state.data.teams.find(item => item.id === teamId)?.readonly || requireCurrent && runtime.state.preferences.current !== teamId) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
  };
  check();
  return { check, session, client, team, users: team.people.filter(person => !person.deleted && team.memberIds.includes(person.id)).map(person => person.matrixId) };
}

/** Every room event must pass this check immediately before send/resend, including retries. */
export async function requireEncryptedSend(client: MatrixClient, roomId: string, people: { matrixId: string; nickname: string }[], check: () => void) {
  check();
  const crypto = client.getCrypto(), room = client.getRoom(roomId);
  if (!crypto || !room?.hasEncryptionStateEvent()) throw new MessageError(uiMessage('extension.runtime.syncingEncryption'));
  const encrypted = await crypto.isEncryptionEnabledInRoom(roomId); check();
  if (!encrypted) throw new MessageError(uiMessage('extension.runtime.encryptionUnconfirmed'));
  const block = await sendBlock(client, roomId, people.map(person => person.matrixId)); check();
  if (block) {
    const person = block.code === 'IDENTITY_CHANGED' ? people.find(person => person.matrixId === block.userId) : undefined;
    const error = new MessageError(block.code === 'IDENTITY_CHANGED' ? uiMessage('extension.runtime.identityChanged', { name: person?.nickname || '' }) : uiMessage('extension.runtime.hiddenMember')) as MessageError & { code: string };
    error.code = block.code; throw error;
  }
  if (client.getRoom(roomId) !== room || !room.hasEncryptionStateEvent()) throw new MessageError(uiMessage('extension.runtime.syncingEncryption'));
}

export function secretStorageCallbacks(getKey: () => Uint8Array | undefined): CryptoCallbacks {
  return {
    getSecretStorageKey: async ({ keys }) => {
      const key = getKey(); const keyId = Object.keys(keys)[0];
      return key && keyId ? [keyId, key as Uint8Array<ArrayBuffer>] : null;
    },
  };
}

export async function ensureCryptoIdentity(client: MatrixClient, secretStorageKey: Uint8Array): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
  const ownUserId = client.getUserId(); const ownDeviceId = client.getDeviceId();
  if (!ownUserId || !ownDeviceId) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
  const hasServerIdentity = await crypto.userHasCrossSigningKeys(ownUserId, true);
  const createSecretStorageKey = async (): Promise<GeneratedSecretStorageKey> => ({ privateKey: secretStorageKey as Uint8Array<ArrayBuffer> });
  await crypto.bootstrapSecretStorage({ createSecretStorageKey, setupNewKeyBackup: false });
  // Published keys require their private halves in Secret Storage; missing keys cannot be reset.
  if (hasServerIdentity && !(await crypto.getCrossSigningStatus()).privateKeysInSecretStorage) throw new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'));
  const authUploadDeviceSigningKeys: UIAuthCallback<void> = async makeRequest => makeRequest(null);
  await crypto.bootstrapCrossSigning(hasServerIdentity ? { authUploadDeviceSigningKeys } : { setupNewCrossSigning: true, authUploadDeviceSigningKeys });
  // Local trust may survive a failed signature upload; always publish the signature again on retry.
  await crypto.crossSignDevice(ownDeviceId);
}

/** Signing requires the device's public keys to exist on the server first. */
export function deviceKeyPublication(userId: string, deviceId: string) {
  let published: () => void;
  let failed: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { published = resolve; failed = reject; });
  void ready.catch(() => {});
  return {
    observe(body: BodyInit | null | undefined, response: Response) {
      if (typeof body !== 'string') return;
      let keys: { user_id?: string; device_id?: string } | undefined;
      try { keys = JSON.parse(body).device_keys; } catch { return; }
      if (keys?.user_id !== userId || keys?.device_id !== deviceId) return;
      if (response.ok) published();
      else failed(new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable')));
    },
    async wait(signal: AbortSignal, timeout = 15_000) {
      if (signal.aborted) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => {};
      try {
        await Promise.race([ready, new Promise<never>((_resolve, reject) => {
          abort = () => reject(new MessageError(uiMessage('extension.runtime.loginChanged')));
          signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => reject(new MessageError(uiMessage('extension.runtime.cryptoIdentityUnavailable'))), timeout);
        })]);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    },
  };
}

/** Asks the server, not the local store: right after signing, the local copy of this device's keys lags until the next key query. */
export async function ownDeviceSigned(client: MatrixClient): Promise<boolean> {
  const userId = client.getUserId(); const deviceId = client.getDeviceId(); if (!userId || !deviceId) return false;
  const keys = await client.downloadKeysForUsers([userId]);
  const selfSigning = Object.keys(keys.self_signing_keys?.[userId]?.keys ?? {})[0];
  return Boolean(selfSigning && keys.device_keys?.[userId]?.[deviceId]?.signatures?.[userId]?.[selfSigning]);
}

export async function sendBlock(client: MatrixClient, roomId: string, memberMatrixIds: string[]): Promise<undefined | { code: 'IDENTITY_CHANGED'; userId: string } | { code: 'HIDDEN_MEMBER' }> {
  const crypto = client.getCrypto(); const room = client.getRoom(roomId);
  if (!crypto || !room) throw new MessageError(uiMessage('extension.runtime.syncingEncryption'));
  const members = new Set(memberMatrixIds);
  for (const userId of memberMatrixIds) {
    const status = await crypto.getUserVerificationStatus(userId);
    if (status.needsUserApproval || status.wasCrossSigningVerified() && !status.isCrossSigningVerified()) return { code: 'IDENTITY_CHANGED', userId };
  }
  // Extra room users without a cross-signing identity (e.g. the service account) never receive room keys
  // under OnlySignedDevicesIsolationMode, so only an extra user who could receive keys blocks sending.
  for (const member of await room.getEncryptionTargetMembers()) if (!members.has(member.userId) && await crypto.userHasCrossSigningKeys(member.userId, true)) return { code: 'HIDDEN_MEMBER' };
}

export async function approveIdentities(client: MatrixClient, matrixIds: string[]): Promise<void> {
  const crypto = client.getCrypto(); if (!crypto) return;
  const own = client.getUserId();
  for (const userId of matrixIds) if (userId !== own && (await crypto.getUserVerificationStatus(userId)).needsUserApproval) await crypto.pinCurrentUserIdentity(userId);
}

export { OnlySignedDevicesIsolationMode };
