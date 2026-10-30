import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { message as uiMessage,MessageError } from '@palside/i18n';

type Target = { userId: string; deviceId: string };

/** Direct Olm encryption does not apply the SDK's room device-isolation policy. */
export async function viewingTargets(crypto: CryptoApi, users: string[], self: Target, check: () => void): Promise<Target[]> {
  const devices = await crypto.getUserDeviceInfo(users, true); check();
  const targets: Target[] = [];
  for (const userId of new Set(users)) {
    await checkIdentity(crypto, userId); check();
    for (const deviceId of devices.get(userId)?.keys() ?? []) {
      if (userId === self.userId && deviceId === self.deviceId) continue;
      const status = await crypto.getDeviceVerificationStatus(userId, deviceId); check();
      // signedByOwner verifies the device signature, including TOFU identities. A local
      // trust override alone must never admit an unsigned device.
      if (status?.signedByOwner) targets.push({ userId, deviceId });
    }
  }
  return targets;
}

async function checkIdentity(crypto: CryptoApi, userId: string) {
  const status = await crypto.getUserVerificationStatus(userId);
  if (status.needsUserApproval || status.wasCrossSigningVerified() && !status.isCrossSigningVerified()) {
    const error = new MessageError(uiMessage('extension.runtime.identityChanged', { name: '' })) as MessageError & { code: string };
    error.code = 'IDENTITY_CHANGED'; throw error;
  }
}

export async function trustedDeviceMessages(crypto: CryptoApi, users: string[], self: Target, type: string, content: Record<string, unknown>, check: () => void) {
  check();
  const targets = await viewingTargets(crypto, users, self, check);
  check();
  if (!targets.length) return {};
  const batch = await crypto.encryptToDeviceMessages(type, targets, content); check();
  // A key query / sync may complete while Olm sessions are being established.
  for (const userId of new Set(users)) { await checkIdentity(crypto, userId); check(); }
  const messages: Record<string, Record<string, unknown>> = {};
  for (const target of targets) {
    const status = await crypto.getDeviceVerificationStatus(target.userId, target.deviceId); check();
    if (!status?.signedByOwner) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const item = batch.batch.find(item => item.userId === target.userId && item.deviceId === target.deviceId);
    if (item) { messages[item.userId] ??= {}; messages[item.userId]![item.deviceId] = item.payload; }
  }
  check();
  return messages;
}
