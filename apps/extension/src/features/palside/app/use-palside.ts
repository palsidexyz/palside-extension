'use client';
import type { PalsideProps } from './panel-props';
import type { PanelActions } from './panel-actions';
import { createLiveActions } from './live-actions';
import { usePanelState } from './use-panel-state';
import { usePanelEffects } from './use-panel-effects';
import { usePanelCommands } from './use-panel-commands';
import { usePanelNavigation } from './use-panel-navigation';
import { useDrafts } from '../chat/use-drafts';
import { useTeamActions } from '../teams/use-team-actions';
import { useDiscovery } from '../teams/use-discovery';
import { useAccountFlow } from '../account/use-account-flow';
import { usePageActions } from '../settings/use-page-actions';
export type { PalsideProps, OnboardingState } from './panel-props';
export function usePalside(props: PalsideProps) {
  const state = usePanelState(props);
  const { guarded, ...commands } = usePanelCommands(state);
  const pageActions = usePageActions(state);
  const actions = {} as Omit<PanelActions, 'guarded' | 'addedNotice' | 'siteName'> & ReturnType<typeof useDiscovery>;
  const getActions = () => ({ ...actions, guarded, ...pageActions });
  Object.assign(actions, {
    ...commands,
    ...usePanelNavigation(state, getActions),
    ...useDrafts(state, getActions),
    ...useTeamActions(state, getActions),
    ...useDiscovery(state),
    ...useAccountFlow(state, getActions),
    ...(props.adapter?.actions ?? createLiveActions)(state, getActions),
  });
  usePanelEffects(state, getActions());
  const { preferences } = state;
  return { ...state.view, ...actions, preferenceError: preferences.error };
}
export type PalsideController = ReturnType<typeof usePalside>;
