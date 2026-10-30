import { shortAddress } from '@palside/shared/navigation';
import { ROOM_NAME_MAX } from '@palside/shared/contracts/limits';
import { viewAsset } from '../domain/annotations/interaction.ts';
import { siteByDomain } from '@palside/shared/sites';
import { pageAsset } from '../runtime/browser/page-layer-host.ts';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { tokenLogoUrl } from '../runtime/viewing/token-logo.ts';
import type { Background } from './index.ts';

/** A panel window remains the room source when focus moves to a window without a panel. Only an added site (网站授权) follows its token:
 *  an address seen through 共享在看's tabs or a toolbar activeTab is never reported. */
export function roomTab(bg: Background) {
  const windows: number[] = [];
  let version = 0, epoch = 0, sent = '', pending = Promise.resolve();
  async function refresh(focused?: number) {
    const request = ++version, receiver = epoch;
    try {
      const window = focused === undefined ? await bg.browser.windows.getLastFocused() : { id: focused };
      if (request !== version) return;
      if (window.id !== undefined && [...bg.panels.values()].includes(window.id)) {
        const index = windows.indexOf(window.id); if (index >= 0) windows.splice(index, 1);
        windows.push(window.id);
      }
      for (const id of bg.panels.values()) if (id !== undefined && !windows.includes(id)) windows.unshift(id);
      for (let index = windows.length - 1; index >= 0; index--) if (![...bg.panels.values()].includes(windows[index])) windows.splice(index, 1);
      const windowId = windows.at(-1);
      const tab = windowId === undefined ? undefined : await bg.activeTab(windowId);
      const granted = Boolean(tab?.url && !tab.incognito && (await accessStatus(tab.url, bg.browser)).site);
      if (request !== version) return;
      const asset = granted && tab?.url ? pageAsset(tab.url, bg.state) : undefined;
      const site = tab?.url && siteByDomain(new URL(tab.url).hostname);
      const state = bg.state;
      const views = state ? [...state.data.views, ...state.data.messages.flatMap(message => [message.ref?.view, message.attachment?.kind === 'asset' ? message.attachment.view : undefined]), ...Object.values(state.drafts).map(draft => draft.value.ref?.view)] : [];
      const view = asset ? views.find(view => viewAsset(view) === asset) : undefined;
      const name = asset ? Array.from(view?.name?.trim() || shortAddress(asset.slice(asset.indexOf(':') + 1))).slice(0, ROOM_NAME_MAX).join('') : '';
      const logo = view && tokenLogoUrl(view.logo);
      const payload = { asset: asset ?? null, ...(asset && site ? { profile: { name, ...(logo ? { logo } : {}), site: site.id } } : {}) };
      pending = pending.catch(() => {}).then(async () => {
        if (request !== version || JSON.stringify(payload) === sent) return;
        const result = await bg.run({ name: 'room-tab', payload });
        if (result.ok && receiver === epoch) sent = JSON.stringify(payload);
      });
      await pending;
    } catch { /* A closing window or worker restart will be retried on the next observation. */ }
  }
  return { refresh, invalidate() { version++; epoch++; sent = ''; } };
}
