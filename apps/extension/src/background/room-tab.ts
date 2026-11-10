import { siteByDomain } from '@palside/shared/sites';
import { pageAsset, pageLookup } from '../runtime/browser/page-layer-host.ts';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { roomKeyForAsset } from '@palside/shared/contracts/rules';
import type { RuntimeState } from '../runtime/composition/runtime-state.ts';
import type { Background } from './index.ts';

/** 弹幕 follows the token in the panel window the user last worked in (`panelWindows`). Only an added site (网站授权) follows its token:
 *  an address seen through 共享在看's tabs or a toolbar activeTab is never reported. */
export function roomTab(bg: Background) {
  let version = 0, epoch = 0, sent = '', sending = 0, pending = Promise.resolve();
  async function refresh() {
    const request = ++version, receiver = epoch;
    try {
      const windowId = bg.panelWindows.current();
      const tab = windowId === undefined ? undefined : await bg.activeTab(windowId);
      const granted = Boolean(tab?.url && !tab.incognito && (await accessStatus(tab.url, bg.browser)).site);
      if (request !== version) return;
      const asset = granted && tab?.url ? pageAsset(tab.url, bg.state) : undefined;
      // The registry site the token is open on is this device's vote for the room's usual site; names come from the token directory.
      const site = asset && tab?.url ? siteByDomain(new URL(tab.url).hostname) : undefined;
      // A pool or chainless contract page names its URL until the server answers; the answer comes back through state.
      const lookup = granted && tab?.url && !asset ? pageLookup(tab.url, bg.state) : undefined;
      const payload = { asset: asset ?? null, ...(windowId !== undefined ? { windowId } : {}), ...(site ? { site: site.id } : {}), ...(lookup ? { page: lookup.url } : {}) };
      pending = pending.catch(() => {}).then(async () => {
        if (request !== version || JSON.stringify(payload) === sent) return;
        sending++;
        try {
          const result = await bg.run({ name: 'room-tab', payload });
          if (result.ok && receiver === epoch) sent = JSON.stringify(payload);
        } finally { sending--; }
      });
      await pending;
    } catch { /* A closing window or worker restart will be retried on the next observation. */ }
  }
  return {
    refresh,
    invalidate() { version++; epoch++; sent = ''; },
    /** The runtime forgot the tab it was told (a session reset without an account change): tell it again instead of waiting forever. */
    stateChanged(state: RuntimeState) {
      if (!sent || sending || !state.authenticated) return;
      const told = JSON.parse(sent) as { asset: string | null; windowId?: number };
      const key = told.asset ? roomKeyForAsset(told.asset) ?? undefined : undefined;
      if (state.rooms.tab !== key || state.rooms.window !== told.windowId) { sent = ''; void refresh(); }
    },
  };
}
