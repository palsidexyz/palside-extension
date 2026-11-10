import { identifyPage,type PageIdentity } from '@palside/shared/navigation';
import { pageKey } from '../../domain/annotations/interaction.ts';

/** Tab cycling (Ctrl+Tab) passes through pages without sharing each one; a page shown this long is shared. */
export const SHARE_SETTLE_MS = 150;

/** Who observes for which team: the current panel window's active page qualifies while a policy exists. */
export type ObservationPolicy = { key: string; context?: string };
export type ActivePage = { tabId: number; windowId: number; url: string; title?: string; favicon?: string; loading?: boolean };

/** What 共享在看 shares of an address: its token, or the page itself with tracking removed (a link carrying credentials falls back to the site). */
const sharedPage = (url: string) => identifyPage(url, undefined, 'page');
/** A jump within a page is the same page; a token page keeps its identity's address. */
const sharedKey = (identity: PageIdentity) => identity.kind === 'website' ? pageKey(identity.url) ?? identity.url : identity.url;
type ObserverHost = {
  policy: () => ObservationPolicy | undefined;
  activePage: () => Promise<ActivePage | undefined>;
  clear: () => Promise<unknown>;
  failed?: () => Promise<unknown>;
  preview?: (identity: PageIdentity, page: ActivePage) => Promise<unknown> | unknown;
  publish: (identity: PageIdentity, page: ActivePage) => Promise<unknown>;
  activity: () => Promise<unknown>;
};

/**
 * Follows the shared page. The page's identity comes from its address alone, so nothing waits for the page to load:
 * - the same page (focus moves, in-page anchors, reloads, completion events) keeps the published page;
 *   a title that arrives later republishes it in place;
 * - a different identity replaces the shared page after a short settle, without clearing it first;
 * - no page (sharing off, no panel, locked screen, non-public page) clears at once.
 */
export function createTabObserver(host: ObserverHost, settleMs = SHARE_SETTLE_MS) {
  let checks = 0;
  /** The identity being shared (or settling) and what teammates were last sent for it. */
  let observed: { key: string; sent?: string; stale?: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function invalidate() {
    const had = observed !== undefined;
    observed = undefined; clearTimeout(timer);
    if (had) void host.clear().catch(() => {});
  }
  /** What a teammate sees of this page. While loading, the title it opened with may still be the previous page's; one that changes since is this page's. */
  const trusted = (page: ActivePage, stale?: string) => !page.loading || page.title !== undefined && page.title !== stale && !page.url.includes(page.title);
  const shown = (page: ActivePage, stale?: string) => trusted(page, stale) ? page : { ...page, title: undefined };
  const sentKey = (page: ActivePage, stale?: string) => JSON.stringify([trusted(page, stale) ? page.title ?? null : null, page.favicon ?? null]);
  async function refresh(activity = false) {
    const check = ++checks;
    const selected = host.policy();
    if (disposed || !selected) { invalidate(); return; }
    const context = selected.context ?? selected.key;
    try {
      const page = await host.activePage();
      if (check !== checks || disposed) return;
      const identity = page && sharedPage(page.url);
      const current = host.policy();
      if (!page || !identity || !current || (current.context ?? current.key) !== context) { invalidate(); return; }
      const key = JSON.stringify([context, sharedKey(identity)]);
      if (observed?.key === key) {
        if (activity) await host.activity();
        // The same page: republish only when what teammates see of it changed (its title arrived).
        if (observed.sent !== undefined && observed.sent !== sentKey(page, observed.stale) && !timer) {
          const entry = observed;
          entry.sent = sentKey(page, entry.stale);
          await host.publish(identity, shown(page, entry.stale)).catch(() => { if (observed === entry) entry.sent = undefined; });
        }
        return;
      }
      clearTimeout(timer); timer = undefined;
      const entry: NonNullable<typeof observed> = { key, ...(page.loading ? { stale: page.title } : {}) };
      observed = entry;
      const permitted = () => { const policy = host.policy(); return policy && (policy.context ?? policy.key) === context; };
      // Device coordination and the settle overlap; neither delays local feedback.
      const ready = activity ? host.activity().then(() => true, () => false) : Promise.resolve(true);
      void Promise.resolve(host.preview?.(identity, shown(page, entry.stale))).catch(() => {});
      const settle = async () => {
        timer = undefined;
        if (!await ready) throw new Error('device unavailable');
        if (observed !== entry || disposed || !permitted()) return;
        const latest = await host.activePage();
        if (observed !== entry || disposed) return;
        const settled = latest && sharedPage(latest.url);
        if (!settled || sharedKey(settled) !== sharedKey(identity)) { void refresh(); return; }
        entry.sent = sentKey(latest, entry.stale);
        await host.publish(identity, shown(latest, entry.stale));
      };
      timer = setTimeout(() => {
        void settle().catch(() => {
          if (observed !== entry || disposed) return;
          observed = undefined;
          void host.failed?.().catch(() => {});
        });
      }, settleMs);
    } catch { if (check === checks && !disposed) { invalidate(); void host.failed?.().catch(() => {}); } }
  }
  return {
    refresh,
    /** A new runtime (offscreen replacement or account reset) knows no page: tell it again without clearing anything first. */
    replay() { observed = undefined; clearTimeout(timer); timer = undefined; return refresh(false); },
    dispose() { disposed = true; checks++; invalidate(); },
  };
}
