import { message as uiMessage } from '@palside/i18n';
import { siteInteraction,type Favorites,type SiteInteraction } from '../../../domain/annotations/interaction';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createMemoryPageActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'setSite' | 'setFavorites' | 'toggle' | 'enableSites' | 'removeSite'> {
const { view: { setNotice }, setLocalSiteInteraction, setLocalFavorites, setLocalShare, setLocalSites } = state;

/** 网页互动 for one site. A site without an entry is on with every feature. */
function setSite(host: string, patch: Partial<SiteInteraction>) {

    setLocalSiteInteraction(old => ({ ...old, [host]: { ...siteInteraction(old, host), ...patch } }));
    return Promise.resolve();
}

function setFavorites(update: (old: Favorites) => Favorites) {

    setLocalFavorites(update);
    return Promise.resolve();
}

/** 共享在看: on for every page until pressed again. */
function toggle(_feature: 'share', on: boolean) {

    setLocalShare(on);
    return Promise.resolve();
}

/** 添加网站: one Chrome prompt for every host. Starts synchronously, so call it from the click. A refusal changes nothing and says so. */
function enableSites(hosts: string[]): Promise<boolean> {
    const { addedNotice } = getActions();
    {
        setLocalSites(old => [...new Set([...old, ...hosts])]);
        setNotice(addedNotice(hosts));
        return Promise.resolve(true);
    }
}

/** 移除网站 gives the grant back to Chrome; 撤销 asks again, which Chrome allows without a prompt. The preview has no 所有网站. */
function removeSite(host: string | 'all') {
    const { siteName } = getActions();
    {
        setLocalSites(old => old.filter(item => item !== host));
        setNotice(uiMessage('extension.sites.removed', { name: siteName(host) }), () => setLocalSites(old => [...old, host]));
        return;
    }
}

  return { setSite, setFavorites, toggle, enableSites, removeSite };
}
