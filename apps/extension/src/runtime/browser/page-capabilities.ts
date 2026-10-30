import { publicShareUrl } from '@palside/shared/navigation';
import type { BlockReason,PageCapabilities,PageCapability } from './page-protocol.ts';

export type CapabilityTab = { id?: number; url?: string; status?: string; incognito?: boolean };
/** Site access permits injection. Capture additionally requires all_urls or a known toolbar activeTab grant. */
export type CapabilityAccess = { site: boolean; active?: boolean; allUrls?: boolean };

/** An unknown address needs access. A visible address alone never proves activeTab (tabs also reveals it). */
export function pageCapabilities(tab: CapabilityTab | undefined, access: CapabilityAccess): PageCapabilities {
  const all = (value: PageCapability): PageCapabilities => ({ capture: { ...value }, pick: { ...value }, danmaku: { ...value }, signal: { ...value }, share: { ...value } });
  const blocked = (reason: BlockReason) => all({ state: 'blocked', reason });
  if (!tab || tab.id === undefined || tab.id < 0) return blocked('none');
  if (tab.incognito) return blocked('private');
  if (!tab.url) return tab.status === 'loading' ? all({ state: 'pending' }) : all({ state: 'access' });
  let url: URL;
  try { url = new URL(tab.url); } catch { return blocked('browser'); }
  if (url.protocol === 'file:') return blocked('file');
  if (!['http:', 'https:'].includes(url.protocol)) return blocked('browser');
  const store = url.hostname === 'chromewebstore.google.com' || url.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(url.pathname);
  const share: PageCapability = !publicShareUrl(tab.url) ? { state: 'blocked', reason: 'private' } : { state: tab.status === 'loading' ? 'pending' : 'ready' };
  // Chrome keeps extensions off the store, so neither the editor nor a capture can run there.
  if (store) return { ...blocked('store'), share };
  if (tab.status === 'loading') return { ...all({ state: 'pending' }), share };
  const interaction: PageCapability = { state: access.site ? 'ready' : 'access' };
  return { capture: { state: access.allUrls || access.active ? 'ready' : 'access' }, pick: { ...interaction }, danmaku: share.state === 'blocked' ? { ...share } : { ...interaction }, signal: share.state === 'blocked' ? { ...share } : { ...interaction }, share };
}
