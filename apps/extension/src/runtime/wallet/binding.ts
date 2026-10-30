import { deriveIdentity, signEvent, verifyEvent } from '@palside/shared/identity';
import { walletBindingTypedData, walletIdentityContent } from '@palside/shared/chain/orders';
import type { WalletBinding, WalletChallenge } from '@palside/shared/contracts/chain';
import { deriveWalletAccount } from './keys';

export function verifyWalletBinding(binding: WalletBinding, accountId: string, chainId: number, address?: string): boolean {
  return binding.accountId === accountId && binding.chainId === chainId
    && (!address || binding.address.toLowerCase() === address.toLowerCase())
    && binding.proof.pubkey === accountId && binding.proof.kind === 27236 && binding.proof.tags.length === 0
    && binding.proof.content === walletIdentityContent(accountId, chainId, binding.address)
    && verifyEvent(binding.proof);
}
/** Rebuild the typed message locally; never sign server-supplied types or arbitrary messages. */
export async function signWalletBinding(mnemonic: string, challenge: WalletChallenge, expected: { accountId: string; address: string; chainId: number }, now = Date.now()) {
  const wallet = deriveWalletAccount(mnemonic), identity = deriveIdentity(mnemonic);
  try {
    if (challenge.accountId !== expected.accountId || identity.publicKey !== expected.accountId || challenge.chainId !== expected.chainId
      || ![4663, 31337].includes(challenge.chainId) || challenge.address.toLowerCase() !== expected.address.toLowerCase()
      || wallet.address.toLowerCase() !== expected.address.toLowerCase() || challenge.expiresAt <= now || challenge.expiresAt > now + 300_000
      || !/^0x[0-9a-f]{64}$/i.test(challenge.nonce) || !/^0x[0-9a-f]{64}$/i.test(challenge.id)) throw new Error('WALLET_BINDING_MISMATCH');
    const signature = await wallet.signTypedData(walletBindingTypedData(challenge));
    const proof = signEvent({ kind: 27236, created_at: Math.floor(now / 1000), tags: [], content: walletIdentityContent(expected.accountId, expected.chainId, wallet.address) }, identity.secretKey);
    return { challengeId: challenge.id, signature, proof: { ...proof, kind: 27236 as const } };
  } finally { identity.secretKey.fill(0); identity.secretStorageKey.fill(0); }
}
