import { mnemonicToAccount, type HDAccount } from 'viem/accounts';
import { isValidMnemonic, normalizeMnemonic } from '@palside/shared/identity';
import { signRelayEnvelope, type RelaySigningEnvelope, type RelaySigningExpectation } from '@palside/shared/chain/signing';
import { WALLET_PATH } from '../../domain/wallet/model';
import { unlockLocalMnemonic, type LocalLocks, type LocalSecretStorage } from '../account/local-password';

export type WalletKeyOptions = {
  storage: LocalSecretStorage; accountId: string; check: () => void; locks?: LocalLocks; now?: () => number;
};
export function deriveWalletAccount(mnemonic: string): HDAccount {
  const normalized = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(normalized)) throw new Error('INVALID_MNEMONIC');
  return mnemonicToAccount(normalized, { path: WALLET_PATH });
}
/** Owns local signing authority. No account or private material enters normal wallet snapshots. */
export class WalletKeys {
  private options: WalletKeyOptions;
  private account?: HDAccount;
  private generation = 0;
  constructor(options: WalletKeyOptions) { this.options = options; }
  get unlocked() { return Boolean(this.account); }
  get address() { return this.account?.address; }
  private check(generation: number) { this.options.check(); if (generation !== this.generation) throw new Error('WALLET_SESSION_CHANGED'); }
  /** Called while creating/restoring the encrypted vault, before the phrase is discarded. */
  initialize(mnemonic: string): string {
    this.options.check();
    this.account = deriveWalletAccount(mnemonic);
    return this.account.address;
  }
  async unlock(password: string): Promise<string> {
    const generation = this.generation;
    const mnemonic = await unlockLocalMnemonic({ ...this.options, password }); this.check(generation);
    const account = deriveWalletAccount(mnemonic); this.check(generation);
    this.account = account;
    return account.address;
  }
  async sign(envelope: RelaySigningEnvelope, expected: RelaySigningExpectation) {
    const generation = this.generation;
    this.check(generation);
    if (!this.account) throw new Error('WALLET_LOCKED');
    if (envelope.fee.mode !== 'sponsored') throw new Error('INVALID_GAS_QUOTE');
    const result = await signRelayEnvelope(this.account, envelope, expected, this.options.now?.() ?? Date.now());
    this.check(generation);
    return result;
  }
  /** Forget the signing account; payments ask for the password again. */
  lock() { this.generation++; this.account = undefined; }
  dispose() { this.lock(); }
}
