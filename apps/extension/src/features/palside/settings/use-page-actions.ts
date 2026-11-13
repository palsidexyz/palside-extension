import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

export function usePageActions(state: PanelState): Pick<PanelActions, 'siteName'> {
  const { view: { sites }, t } = state;
  const siteName = (host: string) => host === 'all' ? t('extension.sites.allSites') : sites.find(site => site.domain === host)?.name ?? host;
  return { siteName };
}
