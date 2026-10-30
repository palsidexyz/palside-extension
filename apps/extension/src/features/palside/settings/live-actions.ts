import { errorMessage,message as uiMessage } from '@palside/i18n';
import { permissionRemovalPending,requestTabs,requestSitesAccess,revokeAllSites,revokeAllSitesKeepingHosts,revokeSiteAccess,revokeTabs } from '../../../runtime/browser/permissions';
import { defaultInteraction,emptyFavorites,readFavorites,readInteraction,type Favorites,type InteractionPrefs,type WebFeature } from '../../../domain/annotations/interaction';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createLivePageActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'setInteraction' | 'setFavorites' | 'setWeb' | 'toggle' | 'enableSites' | 'removeSite' | 'setTokenData'> {
const { view: { setNotice }, preferences } = state;
const live = state.view.live!;

/** 网页互动 and its two features: per account, kept on this device. */
function setInteraction(patch: Partial<InteractionPrefs>) {

    return preferences.update('interaction', old => ({ ...(readInteraction(old) ?? defaultInteraction), ...patch })) ?? Promise.resolve();
}

function setFavorites(update: (old: Favorites) => Favorites) {

    return preferences.update('favorites', old => update(readFavorites(old) ?? emptyFavorites)) ?? Promise.resolve();
}

/**
 * The click requests required permission; disabling revokes it. Re-enabling requests the remembered sites;
 * Chrome determines whether confirmation is shown.
 */
function setWeb(feature: WebFeature, on: boolean) {
    if (!preferences.current()) return;
    if (on && permissionRemovalPending(feature === 'share' ? 'tabs' : 'sites')) {
        setNotice(uiMessage('common.error')); return;
    }
    const intent = preferences.beginPermission(feature);
    const save = () => preferences.update('web', old => ({ ...old, [feature]: on }));
    const failed = (error: unknown) => { if (intent.current()) setNotice(errorMessage(error)); };
    if (on) {
        const restore = preferences.read('restoreSites') ?? [];
        // The request starts before any persistence or queued permission work.
        const asking = feature === 'share' ? requestTabs() : restore.length ? requestSitesAccess(restore) : Promise.resolve(true);
        const work = asking.then(async allowed => {
            if (!intent.current()) return;
            if (!allowed) { setNotice(uiMessage(feature === 'share' ? 'extension.share.blockedByChrome' : 'extension.sites.denied')); return; }
            await save();
            if (feature === 'interact' && restore.length && intent.current()) await preferences.save({ restoreSites: [] });
        }).catch(failed);
        intent.track(work);
        return;
    }
    const work = Promise.resolve(save()).then(() => intent.settled).then(async () => {
        if (!intent.current()) return;
        if (feature === 'share') {
            if (!await revokeTabs(intent.current) && intent.current()) setNotice(uiMessage('common.error'));
        } else {
            const hosts = await revokeAllSites(intent.current);
            if (preferences.current()) await preferences.update('restoreSites', old => [...new Set([...(old ?? []), ...hosts])]);
        }
    }).catch(failed);
    intent.track(work);
}

/** The composer switches: on for every page until switched off or the browser closes. Chrome is asked by the caller, in the click. */
function toggle(feature: WebFeature, on: boolean) {

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
  return { setInteraction, setFavorites, setWeb, toggle, enableSites, removeSite, setTokenData };
}
