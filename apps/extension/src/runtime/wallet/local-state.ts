import { allowsSmallPayment, type WalletPreferences } from '../../domain/wallet/model';
import type { ChainOrderInput } from '@palside/shared/contracts/chain';
import { localLocks, type LocalLocks, type LocalSecretStorage } from '../account/local-password';

type Reservation = { amount: string; day: string };
type WalletLocal = {
  preferences: WalletPreferences; reservations: Record<string, Reservation>; notified: boolean;
};
const empty = (): WalletLocal => ({ preferences: { smallPayments: false, hideAmounts: false }, reservations: {}, notified: false });
/** Read/modify/write always holds the same cross-window lock; storage failures fail closed. */
export class WalletLocalState {
  private storage: LocalSecretStorage;
  private accountId: string;
  private locks: LocalLocks;
  private now: () => number;
  private check: () => void;
  constructor(storage: LocalSecretStorage, accountId: string, check: () => void, locks = localLocks, now = Date.now) {
    this.storage = storage; this.accountId = accountId; this.check = check; this.locks = locks; this.now = now;
  }
  private async update<T>(work: (state: WalletLocal) => T): Promise<T> {
    return this.locks.request(`palside:wallet:${this.accountId}`, async () => {
      this.check();
      const key = `${this.accountId}:wallet-local`;
      const state = await this.storage.get<WalletLocal>(key) ?? empty(); this.check();
      const result = work(state);
      await this.storage.put(key, this.accountId, 'wallet-local', state); this.check();
      return result;
    });
  }
  preferences() { return this.update(state => ({ ...state.preferences })); }
  setPreferences(patch: Partial<WalletPreferences>) { return this.update(state => (state.preferences = { ...state.preferences, ...patch })); }
  private day() { return new Date(this.now()).toISOString().slice(0, 10); }
  private spent(state: WalletLocal) { return Object.values(state.reservations).filter(item => item.day === this.day()).reduce((total, item) => total + BigInt(item.amount), 0n); }
  canSkip(input: ChainOrderInput, amount: bigint, decimals: number) {
    return this.update(state => state.preferences.smallPayments && allowsSmallPayment(input, amount, this.spent(state), decimals));
  }
  reserve(id: string, input: ChainOrderInput, amount: bigint, decimals: number): Promise<boolean> {
    return this.update(state => {
      const existing = state.reservations[id];
      if (existing) return false; // Another window already owns this payment; never sign it twice.
      if (!state.preferences.smallPayments || !allowsSmallPayment(input, amount, this.spent(state), decimals)) return false;
      for (const [key, value] of Object.entries(state.reservations)) if (value.day !== this.day()) delete state.reservations[key];
      state.reservations[id] = { amount: amount.toString(), day: this.day() };
      return true;
    });
  }
  release(id: string, retained = 0n) { return this.update(state => {
    if (retained > 0n && state.reservations[id]) state.reservations[id].amount = retained.toString();
    else delete state.reservations[id];
  }); }
  claimOpenedNotice() { return this.update(state => { if (state.notified) return false; state.notified = true; return true; }); }
}
