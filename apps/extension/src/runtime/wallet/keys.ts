import { mnemonicToAccount, type HDAccount } from 'viem/accounts';
import { toHex } from 'viem';
import { isValidMnemonic, normalizeMnemonic } from '@palside/shared/identity';
import { signRelayEnvelope, type RelaySigningEnvelope, type RelaySigningExpectation } from '@palside/shared/chain/signing';
import { WALLET_LIMITS, WALLET_PATH } from '../../domain/wallet/model';
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
  private exported?: { id: string; owner: string; key: `0x${string}`; expiresAt: number };
  private timer?: ReturnType<typeof setTimeout>;
  private exposureGeneration = 0;
  private exposureOwner?: string;
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
  async reveal(password: string, owner: string): Promise<{ id: string; expiresAt: number; privateKey: string }> {
    this.hide();
    this.exposureOwner = owner;
    const generation = this.generation, exposure = this.exposureGeneration;
    await this.unlock(password); this.check(generation);
    if (exposure !== this.exposureGeneration) throw new Error('PRIVATE_KEY_EXPOSURE_CANCELLED');
    const key = this.account!.getHdKey().privateKey;
    if (!key) throw new Error('WALLET_LOCKED');
    const expiresAt = (this.options.now?.() ?? Date.now()) + WALLET_LIMITS.privateKeyExposureMs;
    this.exported = { id: crypto.randomUUID(), owner, key: toHex(key), expiresAt };
    this.timer = setTimeout(() => this.hide(), WALLET_LIMITS.privateKeyExposureMs);
    return { id: this.exported.id, expiresAt, privateKey: this.exported.key };
  }
  hide(owner?: string) {
    if (owner !== undefined && this.exposureOwner !== owner) return;
    this.exposureGeneration++; this.exposureOwner = undefined;
    clearTimeout(this.timer); this.timer = undefined; this.exported = undefined;
  }
  dispose() { this.generation++; this.hide(); this.account = undefined; }
}
