import { openMnemonic, type Vault } from '@palside/shared/identity';

export interface LocalSecretStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, account: string, kind: string, value: T): Promise<void>;
}
export interface LocalLocks { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export const localLocks: LocalLocks = {
  request: async (name, callback) => {
    if (!globalThis.navigator?.locks) return Promise.reject(new LocalPasswordError('LOCAL_LOCK_UNAVAILABLE'));
    return globalThis.navigator.locks.request(name, callback);
  },
};
export class LocalPasswordError extends Error {
  readonly code: string;
  readonly lockedUntil?: number;
  constructor(code: string, lockedUntil?: number) { super(code); this.name = 'LocalPasswordError'; this.code = code; this.lockedUntil = lockedUntil; }
}
type PasswordAttempts = { failures: number; lockedUntil: number };
/** All PIN consumers share one durable counter and a cross-document Web Lock. */
export async function unlockLocalMnemonic(input: {
  storage: LocalSecretStorage; accountId: string; password: string; check: () => void;
  locks?: LocalLocks; now?: () => number;
}): Promise<string> {
  const { storage, accountId, password, check, locks = localLocks, now = Date.now } = input;
  return locks.request(`palside:password:${accountId}`, async () => {
    check();
    const key = `${accountId}:password-attempts`;
    const saved = await storage.get<PasswordAttempts>(key); check();
    const attempts = saved && saved.lockedUntil > now() ? saved : { failures: saved?.lockedUntil ? 0 : saved?.failures ?? 0, lockedUntil: 0 };
    if (attempts.lockedUntil > now()) throw new LocalPasswordError('PASSWORD_LOCKED', attempts.lockedUntil);
    const vault = await storage.get<Vault>('vault'); check();
    if (!vault) throw new LocalPasswordError('LOGIN_INCOMPLETE');
    let mnemonic: string;
    try { mnemonic = await openMnemonic(vault, password); }
    catch (error) {
      check();
      if (error instanceof Error && error.message === 'INVALID_VAULT') throw new LocalPasswordError('LOGIN_INCOMPLETE');
      if (!(error instanceof Error) || error.message !== 'WRONG_PASSWORD') throw error;
      attempts.failures++;
      if (attempts.failures >= 5) attempts.lockedUntil = now() + 15 * 60_000;
      await storage.put(key, accountId, 'password-attempts', attempts); check();
      throw new LocalPasswordError(attempts.lockedUntil ? 'PASSWORD_LOCKED' : 'WRONG_PASSWORD', attempts.lockedUntil || undefined);
    }
    check();
    await storage.put(key, accountId, 'password-attempts', { failures: 0, lockedUntil: 0 }); check();
    return mnemonic;
  });
}
