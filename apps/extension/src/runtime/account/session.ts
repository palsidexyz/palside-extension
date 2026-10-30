import type { RuntimeDevice } from './device';

export type SessionGuard = () => void;

export function sessionGuard(
  current: () => RuntimeDevice | undefined,
  expected: RuntimeDevice,
  onChanged: () => Error,
): SessionGuard {
  return () => { if (current() !== expected) throw onChanged(); };
}

export function sessionScope(current: () => boolean, onChanged: () => Error) {
  const check = () => { if (!current()) throw onChanged(); };
  return {
    current,
    check,
    async wait<T>(work: PromiseLike<T> | T): Promise<T> {
      try { const value = await work; check(); return value; }
      catch (error) { check(); throw error; }
    },
  };
}
