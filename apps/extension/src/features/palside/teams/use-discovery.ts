import { errorMessage,message as uiMessage } from '@palside/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from '../app/use-panel-state';

type LobbyFilters = { query: string; sort: 'heat' | 'latest'; tab: 'recruiting' | 'applications' };

export function useDiscovery(state: PanelState) {
  const { view: { live }, setLobbyLoading, setLobbyError } = state;
  const command = live?.command;
  const [lobbyFilters, setLobbyFilters] = useState<LobbyFilters>({ query: '', sort: 'heat', tab: 'recruiting' });
  const filters = useRef(lobbyFilters);
  const request = useRef({ version: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  const refreshLobby = useCallback(async () => {
    clearTimeout(timer.current);
    if (!command || !active.current) return;
    const version = ++request.current.version;
    const { query, sort, tab } = filters.current;
    setLobbyLoading(true); setLobbyError('');
    try { await command('lobby', { q: tab === 'applications' ? '' : query, sort }); }
    catch (failure) { if (active.current && version === request.current.version) setLobbyError(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.teamsUnavailable')); }
    finally { if (active.current && version === request.current.version) setLobbyLoading(false); }
  }, [command, setLobbyLoading, setLobbyError]);
  useEffect(() => {
    const pending = request.current;
    active.current = true;
    return () => { active.current = false; pending.version++; clearTimeout(timer.current); };
  }, [command]);
  function updateLobbyFilters(patch: Partial<LobbyFilters>) {
    filters.current = { ...filters.current, ...patch };
    setLobbyFilters(filters.current);
    clearTimeout(timer.current);
    request.current.version++;
    setLobbyError('');
    if (command) {
      setLobbyLoading(true);
      timer.current = setTimeout(() => { void refreshLobby(); }, filters.current.query ? 200 : 0);
    }
  }
  return { refreshLobby, lobbyFilters, updateLobbyFilters };
}

export type DiscoveryActions = ReturnType<typeof useDiscovery>;
