import { identifyPage,type PageIdentity } from '@palside/shared/navigation';

/** Who observes for which team: every public page in the focused panel window qualifies while a policy exists. */
export type ObservationPolicy = { key: string; context?: string };
export type ActivePage = { tabId: number; windowId: number; url: string; title?: string; favicon?: string; loading?: boolean };
type ObserverHost = {
  policy: () => ObservationPolicy | undefined;
  activePage: () => Promise<ActivePage | undefined>;
  clear: (preparing?: boolean) => Promise<unknown>;
  failed?: () => Promise<unknown>;
  preview?: (identity: PageIdentity, page: ActivePage) => Promise<unknown> | unknown;
  publish: (identity: PageIdentity, page: ActivePage) => Promise<unknown>;
  activity: () => Promise<unknown>;
  metadata?: (identity: Extract<PageIdentity, { kind: 'asset' }>, page: ActivePage) => Promise<unknown>;
};

/** Real navigation clears immediately; harmless repeated notifications keep the current generation. */
export function createTabObserver(host: ObserverHost, settleMs = 1000) {
  let generation = 0;
  let checks = 0;
  let observed: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMetadata = 0;
  function invalidate(preparing: boolean) {
    generation++; observed = undefined; clearTimeout(timer); clearTimeout(metadataTimer); metadataTimer = undefined; lastMetadata = 0;
    void host.clear(preparing).catch(() => {});
  }
  async function refresh(activity = false, preserve = false) {
    const check = ++checks;
    const selected = host.policy();
    if (!preserve) invalidate(Boolean(selected));
    if (disposed || !selected) { if (preserve) invalidate(false); return; }
    const policy = { ...selected };
    try {
      const page = await host.activePage();
      if (check !== checks || disposed) return;
      const identity = page && identifyPage(page.url);
      if (!page || !identity || host.policy()?.key !== policy.key) { invalidate(false); return; }
      const key = JSON.stringify([policy.context ?? policy.key, page.windowId, page.tabId, identity.url]);
      if (preserve && observed === key) { if (activity) await host.activity(); return; }
      if (preserve) invalidate(true);
      observed = key;
      const revision = generation;
      const permitted = () => { const current = host.policy(); return current && (current.context ?? current.key) === (policy.context ?? policy.key); };
      // Device coordination and the stability window overlap; neither delays local feedback.
      const ready = activity ? host.activity().then(() => true, () => false) : Promise.resolve(true);
      void Promise.resolve(host.preview?.(identity, page)).catch(() => {});
      let waitingForLoad = Boolean(page.loading);
      let loadingChecks = 0;
      const schedule = () => { timer = setTimeout(() => { void settle().catch(() => { if (revision === generation && !disposed) { observed = undefined; void host.failed?.().catch(() => {}); } }); }, settleMs); };
      const settle = async () => {
        if (!await ready) throw new Error('device unavailable');
        if (revision !== generation || disposed || !permitted()) return;
        const current = await host.activePage();
        if (revision !== generation || disposed) return;
        if (!current || current.tabId !== page.tabId || current.windowId !== page.windowId || identifyPage(current.url)?.url !== identity.url) { invalidate(false); return; }
        // Chrome can report loading again after its complete event without a second
        // completion notification. Keep checking this exact foreground page, bounded
        // to twelve intervals; do not claim device activity again or publish while loading.
        if (current.loading) {
          if (++loadingChecks >= 12) throw new Error('page still loading');
          waitingForLoad = true; schedule(); return;
        }
        if (waitingForLoad) { waitingForLoad = false; schedule(); return; }
        await host.publish(identity, current);
      };
      schedule();
    } catch { if (check === checks && !disposed) { invalidate(false); void host.failed?.().catch(() => {}); } }
  }
  function metadataChanged() {
    if (disposed || !host.metadata || metadataTimer || Date.now() - lastMetadata < 1500) return;
    const revision = generation;
    metadataTimer = setTimeout(() => {
      metadataTimer = undefined; lastMetadata = Date.now();
      void (async () => {
        const policy = host.policy();
        if (!policy || disposed || revision !== generation) return;
        const page = await host.activePage();
        const identity = page && identifyPage(page.url);
        if (!page || page.loading || identity?.kind !== 'asset' || disposed || revision !== generation || host.policy()?.key !== policy.key) return;
        const key = JSON.stringify([policy.context ?? policy.key, page.windowId, page.tabId, identity.url]);
        if (key === observed) await host.metadata!(identity, page);
      })().catch(() => {});
    }, settleMs);
  }
  return { refresh, metadataChanged, dispose() { disposed = true; checks++; invalidate(false); } };
}
