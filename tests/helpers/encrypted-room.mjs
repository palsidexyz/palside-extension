export function encryptedRoom(extra = {}) {
  return { hasEncryptionStateEvent: () => true, getEncryptionTargetMembers: async () => [], getPendingEvents: () => [], getEventForTxnId: () => undefined, ...extra };
}
export function encryptedCrypto(extra = {}) {
  return {
    isEncryptionEnabledInRoom: async () => true,
    getUserVerificationStatus: async () => ({ needsUserApproval: false, wasCrossSigningVerified: () => false, isCrossSigningVerified: () => false }),
    getDeviceVerificationStatus: async () => ({ signedByOwner: true }),
    userHasCrossSigningKeys: async () => false,
    ...extra,
  };
}
export function installEncryptedRoom(client) {
  const room = encryptedRoom();
  client.getRoom = () => room;
  client.getCrypto = () => encryptedCrypto();
  return room;
}
