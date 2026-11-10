import { grantedHost } from '../runtime/browser/permissions.ts';
import { ALL_SITES, readSiteInteractions, siteInteraction, withSiteInteraction } from '../domain/annotations/interaction.ts';
import { normalizeSiteHost } from '../domain/assets/site-host.ts';
import type { Background } from './index.ts';

/** 允许所有网站 → 选择网站 removes the broad grant and re-grants the chosen hosts at once; the check waits for that to settle. */
const SETTLE_MS = 1_500;

/**
 * Chrome taking a site back (its menu, the site's settings, or 收回 in 隐私与数据) switches that site's 网页互动 off. Chrome may re-grant a
 * removed site without asking, so a switch left on would quietly start the page effects again.
 */
export function siteRevoke(bg: Background) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const removed = new Set<string>();
  async function close() {
    const state = bg.state, accountId = state?.account?.id;
    const hosts = [...removed]; removed.clear();
    if (!accountId) return;
    const sites = readSiteInteractions(state.preferences.siteInteraction) ?? {};
    // A site removed by name, and every site switched on: whichever Chrome does not grant goes off.
    const candidates = new Set([...hosts, ...Object.entries(sites).filter(([host, value]) => host !== ALL_SITES && value.on).map(([host]) => host)]);
    let next = { ...sites };
    let changed = false;
    for (const host of candidates) {
      if (!siteInteraction(sites, host).on) continue;
      if (await bg.browser.permissions.contains({ origins: [`https://${host}/*`] }).catch(() => true)) continue;
      next = withSiteInteraction(next, host, { ...siteInteraction(sites, host), on: false });
      changed = true;
    }
    if (!changed || bg.state?.account?.id !== accountId) return;
    await bg.run({ name: 'preferences', payload: { accountId, siteInteraction: next } });
  }
  return {
    removed(origins: string[]) {
      for (const origin of origins) { const host = normalizeSiteHost(grantedHost(origin)); if (host) removed.add(host); }
      if (timer !== undefined) bg.clearTimeout(timer);
      timer = bg.setTimeout(() => { timer = undefined; void close().catch(() => {}); }, SETTLE_MS);
    },
  };
}
