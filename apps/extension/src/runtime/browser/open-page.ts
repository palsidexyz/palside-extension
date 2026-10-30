import { message as uiMessage,MessageError } from '@palside/i18n';
import type { Browser } from 'wxt/browser';
import { pageKey } from '@palside/shared/navigation';

type NavigationBrowser = {
  windows: Pick<typeof Browser.windows, 'getLastFocused'>;
  permissions: Pick<typeof Browser.permissions, 'contains'>;
  tabs: Pick<typeof Browser.tabs, 'query' | 'create' | 'update'>;
};

/** Only authorized URL metadata in the initiating window participates in reuse. */
export function createPageOpener(browser: NavigationBrowser) {
  const pending = new Map<string, Promise<void>>();
  return async (url: string, reuse = true) => {
    const key = pageKey(url); if (!key) throw new MessageError(uiMessage('extension.runtime.notWebLink'));
    const window = await browser.windows.getLastFocused();
    if (window.id === undefined || window.incognito) throw new MessageError(uiMessage('extension.runtime.regularWindowRequired'));
    const operationKey = `${window.id}:${reuse}:${key}`; const existingOperation = pending.get(operationKey);
    if (existingOperation) return existingOperation;
    const operation = (async () => {
      const active = (await browser.tabs.query({ active: true, windowId: window.id }))[0];
      // activeTab can expose this URL even without a persistent host grant.
      if (reuse && active?.url && pageKey(active.url) === key) return;
      const origin = new URL(url).origin;
      // Chrome lists a tab's address only for a granted site, so only those tabs can be reused.
      if (reuse && await browser.permissions.contains({ origins: [`${origin}/*`] })) {
        const tabs = await browser.tabs.query({ url: `${origin}/*`, windowId: window.id });
        const match = tabs.filter(tab => tab.url && pageKey(tab.url) === key)
          .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
        if (match?.id !== undefined) { if (!match.active) await browser.tabs.update(match.id, { active: true }); return; }
      }
      await browser.tabs.create({ url, windowId: window.id, active: true, ...(active ? { index: active.index + 1, openerTabId: active.id } : {}) });
    })();
    pending.set(operationKey, operation);
    try { await operation; setTimeout(() => pending.delete(operationKey), 500); }
    catch (error) { pending.delete(operationKey); throw error; }
  };
}
