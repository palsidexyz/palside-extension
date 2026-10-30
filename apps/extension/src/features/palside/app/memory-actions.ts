import type { PanelState } from './use-panel-state';
import type { PanelActions } from './panel-actions';
import { createMemoryTeamActions } from '../teams/memory-actions';
import { createMemoryDraftActions } from '../chat/memory-actions';
import { createMemoryPageActions } from '../settings/memory-actions';
export function createMemoryActions(state: PanelState, getActions: () => PanelActions) {
  return { ...createMemoryTeamActions(state, getActions), ...createMemoryDraftActions(state, getActions), ...createMemoryPageActions(state, getActions) };
}
