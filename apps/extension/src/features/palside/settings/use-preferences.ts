'use client';
import { errorMessage,message as uiMessage } from '@palside/i18n';

import { useTextState } from '../ui/text';

import { useLayoutEffect,useMemo,useRef,useState } from 'react';
import type { LivePort } from '../app/live-port';
import type { Preferences } from '../../../domain/account/preferences';

/** Account-scoped pending intent; the runtime serializes preference persistence. */
export function usePreferences(live?: LivePort) {
  const [pending, setPending] = useState<{ account?: string; patch: Partial<Preferences> }>({ patch: {} });
  const [error, setError] = useTextState();
  const intent = useRef<{ account?: string; patch: Partial<Preferences> }>({ patch: {} });
  const sequence = useRef(0);
  const account = live?.state.account?.id;
  const owner = useMemo(() => ({ account }), [account]);
  const active = useRef<typeof owner | undefined>(undefined);
  const latest = useRef(live);
  useLayoutEffect(() => { latest.current = live; });
  useLayoutEffect(() => { active.current = owner; return () => { active.current = undefined; }; }, [owner]);
  const current = () => Boolean(account && active.current === owner && latest.current?.state.account?.id === account);
  const permissions = useRef({
    share: { generation: 0, pending: Promise.resolve() },
    interact: { generation: 0, pending: Promise.resolve() },
    notifications: { generation: 0, pending: Promise.resolve() },
  });
  function beginPermission(key: keyof typeof permissions.current) {
    const lane = permissions.current[key], generation = ++lane.generation;
    return {
      current: () => current() && lane.generation === generation,
      settled: lane.pending,
      track: (work: Promise<unknown>) => { lane.pending = work.then(() => {}, () => {}); },
    };
  }
  function read<K extends keyof Preferences>(key: K): Preferences[K] {
    return ((intent.current.account === account ? intent.current.patch[key] : undefined) ?? latest.current?.state.preferences[key]) as Preferences[K];
  }
  async function save(patch: Partial<Preferences>) {
    if (!live || !account || !current()) return;
    const revision = ++sequence.current;
    const merged = { ...(intent.current.account === account ? intent.current.patch : {}), ...patch };
    intent.current = { account, patch: merged }; setPending({ account, patch: merged }); setError('');
    try { await live.command('preferences', { ...merged, accountId: account }); }
    catch (failure) {
      if (current() && sequence.current === revision) setError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.settingsSaveFailed'));
      throw failure;
    } finally {
      if (current() && sequence.current === revision) { intent.current = { patch: {} }; setPending({ patch: {} }); }
    }
  }
  function update<K extends keyof Preferences>(key: K, value: Preferences[K] | ((previous: Preferences[K]) => Preferences[K])) {
    if (!live || !current()) return;
    const previous = read(key);
    return save({ [key]: typeof value === 'function' ? value(previous) : value });
  }
  return { values: { ...live?.state.preferences, ...(pending.account === live?.state.account?.id ? pending.patch : {}) }, error, save, update, read, current, beginPermission };
}
