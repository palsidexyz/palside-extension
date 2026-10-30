import { message as uiMessage } from '@palside/i18n';
import { type Favorites,type InteractionPrefs,type WebFeature } from '../../../domain/annotations/interaction';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createMemoryPageActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'setInteraction' | 'setFavorites' | 'setWeb' | 'toggle' | 'enableSites' | 'removeSite' | 'setTokenData'> {
const { view: { web, setNotice }, setLocalInteraction, setLocalFavorites, setLocalWeb, setLocalToggles, setLocalSites, setLocalTokenOff } = state;

/** 网页互动 and its two features: per account, kept on this device. */
function setInteraction(patch: Partial<InteractionPrefs>) {

    {
        setLocalInteraction(old => ({ ...old, ...patch }));
        return Promise.resolve();
    }
}

function setFavorites(update: (old: Favorites) => Favorites) {

    {
        setLocalFavorites(update);
        return Promise.resolve();
    }
}

/**
 * 设置 › 网页: 启用 asks nothing; 禁用 switches the composer button off and gives the permission back to Chrome. 网页互动
 * remembers its 已授权网站 and asks for them again when it is 启用 — Chrome allows them without a prompt when it did before.
 * Call it from the click.
 */
function setWeb(feature: WebFeature, on: boolean) {

    {
        setLocalWeb(old => ({ ...old, [feature]: on }));
        if (!on)
            setLocalToggles(old => ({ ...old, [feature]: false }));
        return;
    }
}

/** The composer switches: on for every page until switched off or the browser closes. Chrome is asked by the caller, in the click. */
function toggle(feature: WebFeature, on: boolean) {

    {
        setLocalToggles(old => ({ ...old, [feature]: on && web[feature] }));
        return Promise.resolve();
    }
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

/** 代币数据 for one 已授权网站 with a token profile; on unless switched off here. */
function setTokenData(host: string, on: boolean) {

    const next = (list: string[]) => on ? list.filter(item => item !== host) : [...new Set([...list, host])];
    {
        setLocalTokenOff(next);
        return;
    }
}
  return { setInteraction, setFavorites, setWeb, toggle, enableSites, removeSite, setTokenData };
}
