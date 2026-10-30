'use client';
import { useEffect,useRef,useState } from 'react';
import { broadOrigin,getHostPermissions,grantedHost,notificationsGranted,tabsGranted,watchPermissions } from '../../../runtime/browser/permissions';
import type { PalsideController } from '../app/use-palside';

/**
 * What Chrome has granted right now — exact sites, 所有网站 (asked for in 网站 or given in Chrome's menu), 读取您的浏览记录 and 通知 — kept live through
 * `permissions.onAdded/onRemoved`, so a change made in Chrome shows everywhere at once. The preview without a browser counts every site as allowed.
 */
export function useGrants(c: PalsideController) {
  const [value, setValue] = useState<{ origins: string[]; notifications: boolean; tabs: boolean; ready?: boolean; error?: boolean }>({ origins: [], notifications: false, tabs: false });
  const live = Boolean(c.live);
  const account = c.data.self;
  const version = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!live) return;
    let active = true;
    const refresh = () => {
      const request = ++version.current;
      void Promise.all([getHostPermissions(), notificationsGranted(), tabsGranted()]).then(([origins, notifications, tabs]) => {
        if (active && request === version.current) setValue({ origins, notifications, tabs, ready: !subscriptionError, error: subscriptionError });
      }, () => {
        if (active && request === version.current) setValue(old => ({ ...old, ready: false, error: true }));
      });
    };
    let subscriptionError = false;
    let stop: (() => void) | undefined;
    try { stop = watchPermissions(refresh); }
    catch { subscriptionError = true; }
    refresh();
    return () => { active = false; stop?.(); };
  }, [live, account, attempt]);
  const broad = live && value.origins.some(broadOrigin);
  const hosts = [...new Set(value.origins.map(grantedHost).filter((host): host is string => Boolean(host)))];
  return {
    error: live && Boolean(value.error),
    retry: () => setAttempt(value => value + 1),
    /** The latest completed read succeeded; failed refreshes retain the last verified grants. */
    ready: !live || Boolean(value.ready),
    notifications: !live || value.notifications,
    /** 读取您的浏览记录, which 共享在看 runs on. */
    tabs: !live || value.tabs,
    /** 所有网站 is allowed. */
    broad,
    /** Sites granted one by one, as Chrome lists them. */
    hosts,
    site: (host: string) => !live || broad || hosts.includes(host),
  };
}
export type Grants = ReturnType<typeof useGrants>;

/**
 * 已授权网站: the sites Chrome allows (the preview keeps its own list), in catalog order, then other hosts by name. `all`:
 * 所有网站 covers every site.
 */
export function allowedSites(c: PalsideController, grants: Grants) {
  const order = (host: string) => { const index = c.sites.findIndex(site => site.domain === host); return index < 0 ? Infinity : index; };
  const hosts = c.live ? grants.hosts : c.localSites;
  return { all: grants.broad, hosts: [...hosts].sort((a, b) => order(a) - order(b) || a.localeCompare(b)) };
}

/** Chrome allows reading and changing this site. */
export function siteAllowed(c: PalsideController, grants: Grants, host: string) {
  return c.live ? grants.site(host) : c.localSites.includes(host);
}
