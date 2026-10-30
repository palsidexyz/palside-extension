import type { PanelState } from './use-panel-state';
import type { PanelActions } from './panel-actions';
import { createLiveTeamActions } from '../teams/live-actions';
import { createLiveDraftActions } from '../chat/live-actions';
import { createLivePageActions } from '../settings/live-actions';
export function createLiveActions(state: PanelState, getActions: () => PanelActions) {
  return { ...createLiveTeamActions(state, getActions), ...createLiveDraftActions(state, getActions), ...createLivePageActions(state, getActions) };
}
