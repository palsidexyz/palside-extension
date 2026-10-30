import { message as uiMessage } from '@palside/i18n';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

export function usePageActions(state: PanelState): Pick<PanelActions, 'addedNotice' | 'siteName'> {
  const { view: { sites }, t } = state;
function addedNotice(hosts: string[]) {
    return hosts.length === 1 ? uiMessage('extension.sites.added', { name: siteName(hosts[0]!) }) : uiMessage('extension.sites.addedMany', { count: hosts.length });
  }
function siteName(host: string) { return host === 'all' ? t('extension.sites.allSites') : sites.find(site => site.domain === host)?.name ?? host; }
  return { addedNotice, siteName };
}
