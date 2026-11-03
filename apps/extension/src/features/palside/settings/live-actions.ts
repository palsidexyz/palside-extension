import { errorMessage,message as uiMessage } from '@palside/i18n';
import { requestSitesAccess,revokeAllSitesKeepingHosts,revokeSiteAccess } from '../../../runtime/browser/permissions';
import { emptyFavorites,readFavorites,readSiteInteractions,siteInteraction,type Favorites,type SiteInteraction } from '../../../domain/annotations/interaction';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createLivePageActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'setSite' | 'setFavorites' | 'toggle' | 'enableSites' | 'removeSite' | 'setTokenData'> {
const { view: { setNotice }, preferences } = state;
const live = state.view.live!;

/** 网页互动 for one site, kept per account on this device. A site without an entry is on with every feature. */
function setSite(host: string, patch: Partial<SiteInteraction>) {

    return preferences.update('siteInteraction', old => {
        const sites = readSiteInteractions(old) ?? {};
        return { ...sites, [host]: { ...siteInteraction(sites, host), ...patch } };
    }) ?? Promise.resolve();
}

function setFavorites(update: (old: Favorites) => Favorites) {

    return preferences.update('favorites', old => update(readFavorites(old) ?? emptyFavorites)) ?? Promise.resolve();
}

/** 共享在看: on for every page until pressed again. Chrome is asked by the caller, in the click. */
function toggle(feature: 'share', on: boolean) {

    return live.command('toggle', { [feature]: on }).then(() => { }, error => setNotice(errorMessage(error)));
}

/** 添加网站: one Chrome prompt for every host. Starts synchronously, so call it from the click. A refusal changes nothing and says so. */
function enableSites(hosts: string[]): Promise<boolean> {
    const { addedNotice } = getActions();
    return requestSitesAccess(hosts).then(allowed => {
        if (!preferences.current()) return false;
        setNotice(allowed ? addedNotice(hosts) : uiMessage('extension.sites.denied'));
        return allowed;
    }, error => { if (preferences.current()) setNotice(errorMessage(error)); return false; });
}

/** 移除网站 reports confirmed removal. 撤销 requests the site again; Chrome decides whether confirmation is shown. */
async function removeSite(host: string | 'all') {
    const { siteName } = getActions();
    try {
        const removed = await (host === 'all' ? revokeAllSitesKeepingHosts(undefined, preferences.current) : revokeSiteAccess(`https://${host}/`, preferences.current));
        if (!preferences.current()) return;
        if (!removed) { setNotice(uiMessage('common.error')); return; }
        if (host === 'all') setNotice(uiMessage('extension.sites.removedAll'));
        else setNotice(uiMessage('extension.sites.removed', { name: siteName(host) }), () => {
            if (!preferences.current()) return;
            void requestSitesAccess([host]).then(allowed => {
                if (!allowed && preferences.current()) setNotice(uiMessage('extension.sites.denied'));
            }, error => { if (preferences.current()) setNotice(errorMessage(error)); });
        });
    } catch (error) { if (preferences.current()) setNotice(errorMessage(error)); }
}

/** 代币数据 for one 已授权网站 with a token profile; on unless switched off here. */
function setTokenData(host: string, on: boolean) {

    const next = (list: string[]) => on ? list.filter(item => item !== host) : [...new Set([...list, host])];
    void preferences.update('tokenOff', old => next(old ?? []))?.catch(() => { });
}
  return { setSite, setFavorites, toggle, enableSites, removeSite, setTokenData };
}
