'use client';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { message as uiMessage } from '@palside/i18n';
import { Globe, Layers } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { siteAllows } from '../../../domain/annotations/interaction';
import { requestSitesAccess, requestTabs } from '../../../runtime/browser/permissions';
import { iconDataUrl } from '../../../runtime/viewing/viewing';
import { capability } from '../settings/access';
import { captureSocialUi } from '../annotations/social-state';
import { SiteFace } from '../assets/site-logo';
import { useGrants } from '../settings/use-grants';
import { ShareToggle, shareShown } from './page-toggles';
import { siteOf, type Site } from '../settings/site-catalog';
import type { PalsideController } from '../app/use-palside';
import s from './page-key.module.css';

/**
 * The site the tab shows, as 网页互动 sees it:
 * `none` the page can never run it · `loading` the page is still being read · `asking` Chrome's prompt is open for it ·
 * `blind` Palside does not know the site yet (no 读取您的浏览记录 and the site not allowed) · `lock` Chrome has not allowed it ·
 * `on` 网页互动 runs here · `off` allowed, switched off here.
 */
export type SiteState = 'none' | 'loading' | 'asking' | 'blind' | 'lock' | 'on' | 'off';

// The one Chrome prompt this panel has open for the page key, so it waits with it instead of claiming an answer.
let asking: string | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export function useAsking() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => asking, () => undefined);
}
function wait<T>(key: string, request: Promise<T>) {
  asking = key; emit();
  return request.finally(() => { if (asking === key) { asking = undefined; emit(); } });
}

/** Asks Chrome for one site. Must run synchronously from a click; the page key shows the wait until Chrome answers. */
export function askSiteAccess(host: string) {
  return wait(host, requestSitesAccess([host]));
}

export function siteState(c: PalsideController, waiting?: string): SiteState {
  const { state } = capability(c, 'interact');
  if (state === 'blocked') return 'none';
  if (state === 'pending') return waiting === '' ? 'asking' : 'loading';
  if (state === 'access') return !c.pageHost ? waiting === '' ? 'asking' : 'blind' : waiting === c.pageHost ? 'asking' : 'lock';
  return siteAllows(c.siteInteraction, c.pageHost) ? 'on' : 'off';
}

/**
 * The tab's site, resolved like every other site face (see `siteOf`), with the tab's own icon as the last resort: Chrome's cached
 * copy, else the tab's icon address. Known from the address alone, so it is drawn while the page is still loading.
 */
export function pageSite(c: PalsideController): Site | undefined {
  const host = c.pageHost;
  if (!host) return;
  const page = c.live.page;
  return siteOf(c, host, iconDataUrl(page?.favicon) ?? iconDataUrl(page?.icon));
}

/** Chrome names the tab, and it is no website Palside can work on: a browser page, a local file, or a local, private or ported address. */
export function pageUnusable(c: PalsideController) {
  const page = c.live.page;
  if (!page) return false;
  return capability(c, 'interact').state === 'blocked' || Boolean(page.url && !c.pageHost);
}

/**
 * Opens the 网页互动 sheet for the tab's site. While Palside cannot see which site it is, Chrome is asked for 读取您的浏览记录 in this
 * click first — the same permission 共享在看 uses, asked once for both — and the sheet opens when Chrome allows it.
 */
export function openSiteSheet(c: PalsideController, tabs: boolean) {
  const session = captureSocialUi();
  if (c.pageHost || tabs || pageUnusable(c)) { session.set({ grant: true }); return; }
  void wait('', requestTabs()).then(allowed => {
    if (!session.current() || !c.ownsAccess()) return;
    if (allowed) session.set({ grant: true });
    else c.setNotice(uiMessage('extension.sites.denied'));
  }, () => { if (session.current()) c.setNotice(uiMessage('extension.sites.denied')); });
}

/**
 * The left half of the page capsule: the tab's site, opening its 网页互动 sheet. The logo keeps its own colours; a corner badge says
 * 网页互动 can run here — grey while it is off or Chrome has not allowed the site yet, neon once it runs, so the feature is always found
 * 网页互动 runs here. A globe while Palside does not know the site (pressing it asks Chrome first), an empty dashed tile on a page
 * Palside can never use. While the page loads or Chrome's prompt is open, a sheen crosses the tile — over the site's logo once the
 * address names the site, since the logo needs only the address; the badge and the sheet wait for the page.
 */
function SiteKey({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const waiting = useAsking();
  const grants = useGrants(c);
  const unusable = pageUnusable(c);
  const state = unusable ? 'none' : siteState(c, waiting);
  const site = state === 'none' || state === 'blind' ? undefined : pageSite(c);
  const name = site?.name ?? t('extension.web.thisSite');
  const label = unusable ? t('extension.web.pageUnusable') : {
    none: t('extension.web.siteNone'),
    loading: t('extension.web.siteLoading'),
    asking: t('extension.web.siteAsking'),
    blind: t('extension.settings.interaction'),
    lock: t('extension.web.siteOff', { name }),
    off: t('extension.web.siteOff', { name }),
    on: t('extension.web.siteLive', { name }),
  }[state];
  const inert = state === 'none' || state === 'loading' || state === 'asking';
  return <Tooltip content={label}>
    <button type="button" className={s.site} data-tour="site" data-state={state} aria-label={label} aria-haspopup={inert ? undefined : 'dialog'} aria-disabled={inert || undefined}
      onClick={() => { if (!inert) openSiteSheet(c, grants.tabs); }}>
      <span className={s.slot}>
        {state === 'none' ? <i className={s.empty} aria-hidden="true" />
          : state === 'blind' || (state === 'asking' && !site) ? <span className={s.globe} aria-hidden="true"><Globe /></span>
          : site && <SiteFace key={site.domain} site={site} className={s.face} />}
        {(state === 'loading' || state === 'asking') && <i className={s.sheen} aria-hidden="true" />}
      </span>
      {(state === 'on' || state === 'off' || state === 'lock') && <i className={s.badge} data-idle={state !== 'on' || undefined} aria-hidden="true"><Layers /></i>}
    </button>
  </Tooltip>;
}

/** The page capsule, in the header: 网页互动 on this site | 共享在看 — one surface, two keys, each doing one thing. */
export function PageCapsule({ c }: { c: PalsideController }) {
  const share = shareShown(c);
  return <div className={s.capsule}>
    <SiteKey c={c} />
    {share && <><i className={s.rule} aria-hidden="true" /><ShareToggle c={c} /></>}
  </div>;
}
