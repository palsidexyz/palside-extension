import { useEffect } from 'react';
import type { PanelState } from './use-panel-state';
import type { PanelActions } from './panel-actions';
export function usePanelEffects({ view: { live }, openTeam, authenticated }: PanelState, { refreshLobby }: PanelActions) {

  useEffect(() => {
    if (!live || !openTeam || !authenticated) return;
    void refreshLobby(); void live.command('dismiss-open-team').catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTeam, authenticated]);
}
