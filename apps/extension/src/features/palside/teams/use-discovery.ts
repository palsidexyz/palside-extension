import { errorMessage,message as uiMessage } from '@palside/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from '../app/use-panel-state';

type LobbyFilters = { query: string; sort: 'heat' | 'latest'; tab: 'recruiting' | 'applications' };
type LobbyList = 'teams' | 'applications';
const noMore = { teams: false, applications: false };

export function useDiscovery(state: PanelState) {
  const { view: { live }, setLobbyLoading, setLobbyError } = state;
  const command = live?.command;
  const [lobbyFilters, setLobbyFilters] = useState<LobbyFilters>({ query: '', sort: 'heat', tab: 'recruiting' });
  const filters = useRef(lobbyFilters);
  const request = useRef({ version: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  // Pages of 50 load as the list scrolls; a new search or sort starts again from the first page.
  const [lobbyMore, setLobbyMore] = useState<Record<LobbyList, boolean>>(noMore);
  const [lobbyLoadingMore, setLobbyLoadingMore] = useState(false);
  // A failed page waits for an explicit retry instead of re-requesting while the sentinel stays in view.
  const [lobbyMoreFailed, setLobbyMoreFailed] = useState(false);
  const loadingMore = useRef(false);
  const refreshLobby = useCallback(async () => {
    clearTimeout(timer.current);
    if (!command || !active.current) return;
    const version = ++request.current.version;
    const { query, sort, tab } = filters.current;
    setLobbyLoading(true); setLobbyError('');
    try {
      const paging = await command('lobby', { q: tab === 'applications' ? '' : query, sort });
      if (active.current && version === request.current.version) { setLobbyMore(paging?.hasMore ?? noMore); setLobbyMoreFailed(false); }
    }
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
  const loadMoreLobby = useCallback(async (list: LobbyList) => {
    if (!command || loadingMore.current || !lobbyMore[list]) return;
    const version = request.current.version;
    loadingMore.current = true; setLobbyLoadingMore(true);
    try {
      const paging = await command('lobby-more', { list });
      if (active.current && version === request.current.version) { setLobbyMore(paging?.hasMore ?? noMore); setLobbyMoreFailed(false); }
    } catch { if (active.current && version === request.current.version) setLobbyMoreFailed(true); }
    finally { loadingMore.current = false; if (active.current) setLobbyLoadingMore(false); }
  }, [command, lobbyMore]);
  return { refreshLobby, lobbyFilters, updateLobbyFilters, lobbyMore, lobbyLoadingMore, lobbyMoreFailed, loadMoreLobby };
}

export type DiscoveryActions = ReturnType<typeof useDiscovery>;
