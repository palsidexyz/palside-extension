import { MINUTE_MS, HOUR_MS, DAY_MS } from '@palside/shared/units';
import { message, type TextMessage } from '@palside/i18n';
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
  readonly text?: TextMessage;
  readonly code: string;
  readonly lockedUntil?: number;
  constructor(code: string, lockedUntil?: number) { super(code); this.name = 'LocalPasswordError'; this.code = code; this.lockedUntil = lockedUntil; if (lockedUntil) this.text = message('extension.runtime.passwordLockedUntil', { time: lockedUntil }); }
}
const FAILURE_WINDOW_MS = DAY_MS;
const LOCKOUT_MS = [15 * MINUTE_MS, HOUR_MS, DAY_MS];
type PasswordAttempts = { failures: number; failedAt: number; lockouts: number; lockedUntil: number };
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
    const attempts = saved ?? { failures: 0, failedAt: 0, lockouts: 0, lockedUntil: 0 };
    if (attempts.lockedUntil > now()) throw new LocalPasswordError('PASSWORD_LOCKED', attempts.lockedUntil);
    if (attempts.lockedUntil || now() - attempts.failedAt >= FAILURE_WINDOW_MS) attempts.failures = 0;
    attempts.lockedUntil = 0;
    const vault = await storage.get<Vault>('vault'); check();
    if (!vault) throw new LocalPasswordError('LOGIN_INCOMPLETE');
    let mnemonic: string;
    try { mnemonic = await openMnemonic(vault, password); }
    catch (error) {
      check();
      if (error instanceof Error && error.message === 'INVALID_VAULT') throw new LocalPasswordError('LOGIN_INCOMPLETE');
      if (!(error instanceof Error) || error.message !== 'WRONG_PASSWORD') throw error;
      attempts.failures++;
      attempts.failedAt = now();
      if (attempts.failures >= 5) {
        attempts.lockedUntil = now() + LOCKOUT_MS[Math.min(attempts.lockouts, LOCKOUT_MS.length - 1)]!;
        attempts.lockouts++;
      }
      await storage.put(key, accountId, 'password-attempts', attempts); check();
      throw new LocalPasswordError(attempts.lockedUntil ? 'PASSWORD_LOCKED' : 'WRONG_PASSWORD', attempts.lockedUntil || undefined);
    }
    check();
    await storage.put(key, accountId, 'password-attempts', { failures: 0, failedAt: 0, lockouts: 0, lockedUntil: 0 }); check();
    return mnemonic;
  });
}
