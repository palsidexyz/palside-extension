import { SECOND_MS } from '@palside/shared/units';
import { deriveIdentity, signEvent, verifyEvent } from '@palside/shared/identity';
import { walletBindingTypedData, walletIdentityContent } from '@palside/shared/chain/orders';
import type { WalletBinding, WalletBindInput } from '@palside/shared/contracts/chain';
import { deriveWalletAccount } from './keys';

/** The service holds the binding; the identity-signed proof is what lets this client trust the address it returns. */
export function verifyWalletBinding(binding: WalletBinding, accountId: string, address?: string): boolean {
  return binding.accountId === accountId
    && (!address || binding.address.toLowerCase() === address.toLowerCase())
    && binding.proof.pubkey === accountId && binding.proof.kind === 27236 && binding.proof.tags.length === 0
    && binding.proof.content === walletIdentityContent(accountId, binding.address)
    && verifyEvent(binding.proof);
}
/** Both keys come from the one mnemonic: the 零钱 key signs the account, the identity key signs the address. */
export async function signWalletBinding(mnemonic: string, accountId: string, now = Date.now()): Promise<WalletBindInput> {
  const wallet = deriveWalletAccount(mnemonic), identity = deriveIdentity(mnemonic);
  try {
    if (identity.publicKey !== accountId) throw new Error('WALLET_BINDING_MISMATCH');
    const address = wallet.address.toLowerCase();
    const signature = await wallet.signTypedData(walletBindingTypedData(accountId, address));
    const proof = signEvent({ kind: 27236, created_at: Math.floor(now / SECOND_MS), tags: [], content: walletIdentityContent(accountId, address) }, identity.secretKey);
    return { address, signature, proof: { ...proof, kind: 27236 as const } };
  } finally { identity.secretKey.fill(0); identity.secretStorageKey.fill(0); }
}
