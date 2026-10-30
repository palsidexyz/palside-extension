import { useLayoutEffect, useRef } from 'react';
import { type Screen } from './panel-model';
import { type Viewing } from '../../../domain/assets/model';
import type { PanelState } from './use-panel-state';
import type { PanelActions } from './panel-actions';



const signedOutScreens: Screen[] = ['welcome', 'new-account', 'confirm-phrase', 'restore'];

/** Where 返回 leads when a screen was opened directly, not from another panel screen. */
const parents: Partial<Record<Screen, Screen>> = { wallet: 'settings', 'wallet-receive': 'wallet', 'wallet-records': 'wallet', 'wallet-settings': 'wallet', 'wallet-packet': 'chat', 'wallet-invitation': 'team', 'team-level': 'team', profile: 'settings', privacy: 'settings', security: 'settings', about: 'settings', interaction: 'settings', sites: 'settings', site: 'sites', notifications: 'settings', 'delete-account': 'security', recruitment: 'lobby', 'former-teams': 'chat', requests: 'team', 'team-profile': 'team', 'room-people': 'room', blocked: 'interaction' };

export function usePanelNavigation(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'go' | 'back' | 'openNotification' | 'openInvitation' | 'openSite' | 'selectAsset'> {
  const { view: { setSelectingOwner, screen, live, data, current, ownsScreen, setNotice }, returnFocus: returnFocusRef, localScreen, setPhrase, origins: originsRef, setScreen, setSiteHost, setSelectedAsset, setSelectedView } = state;
  const pendingFocus = useRef<{ accountId: string; teamId: string; element: HTMLElement | null } | undefined>(undefined);
  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    if (screen !== 'chat' || request.accountId !== data.self || request.teamId !== current) { pendingFocus.current = undefined; return; }
    const frame = requestAnimationFrame(() => {
      if (pendingFocus.current !== request) return;
      pendingFocus.current = undefined;
      if (ownsScreen() && request.element?.checkVisibility()) request.element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });
function go(to: Screen) {
    const { run, refreshLobby } = getActions();
    if (to !== 'members') setSelectingOwner(false);
    if (screen === 'chat' && to !== 'chat') returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (live && !live.state.authenticated && !signedOutScreens.includes(to)) return;
    pendingFocus.current = undefined;
    if (live && localScreen === 'new-account' && to === 'welcome') { setPhrase([]); void run('account-discard'); }
    // Leaving 通过邀请加入 without joining declines the link that opened it.
    if (live && screen === 'join' && to !== 'join' && data.pendingInvite) void run('dismiss-invite', { url: data.pendingInvite });
    if (live && to === 'lobby') void refreshLobby();
    if (to === 'chat') originsRef.current = {};
    else if (screen === 'chat') originsRef.current = { [to]: 'chat' };
    else if (screen !== to) {
      // Going to a screen this one was reached from (or its parent) is a step back: forget the path walked, so 返回 never loops.
      const path: Screen[] = [];
      for (let at: Screen | undefined = screen; at && at !== to && !path.includes(at); at = originsRef.current[at]) path.push(at);
      const ancestor = parents[screen] === to || path.length > 0 && originsRef.current[path.at(-1)!] === to;
      if (ancestor) for (const step of path) delete originsRef.current[step];
      if (originsRef.current[to] === screen) delete originsRef.current[to];
      if (!ancestor && !originsRef.current[to]) originsRef.current[to] = screen;
    }
    setNotice(''); setScreen(to);
    if (to === 'chat') pendingFocus.current = { accountId: data.self, teamId: current, element: returnFocusRef.current };
  }
/** 返回: the screen this one was opened from, else its usual parent, else the chat. */
  function back() {
    const from = originsRef.current[screen] ?? parents[screen] ?? 'chat';
    delete originsRef.current[screen];
    go(from);
  }
function openNotification() {
    pendingFocus.current = undefined;
    getActions(); setNotice(''); setScreen('chat'); }
function openInvitation() {
    getActions(); go('join'); }
function openSite(host: string) {
    getActions(); setSiteHost(host); go('site'); }
function selectAsset(id: string, view?: Viewing) {
    getActions(); setSelectedAsset(id); setSelectedView(view?.id === id ? view : undefined); go('asset'); }
  return { go, back, openNotification, openInvitation, openSite, selectAsset };
}
