import type { PanelData } from './panel-data';
import type { PanelActions } from './panel-actions';
import type { PanelState } from './use-panel-state';
export type PanelAdapter = { data: PanelData; actions: (state: PanelState, getActions: () => PanelActions) => Pick<PanelActions, 'saveInvitePassword' | 'updateDraft' | 'flushDraft' | 'resolveDraftConflict' | 'setSite' | 'setFavorites' | 'toggle' | 'enableSites' | 'removeSite' | 'attach' | 'send' | 'retry' | 'saveEdit' | 'recall' | 'createTeam' | 'setRecruitment' | 'requestTeam' | 'cancelApplication' | 'leave' | 'approve'> };
