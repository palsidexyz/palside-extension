import { browser } from 'wxt/browser';
import { MessageError,message as uiMessage } from '@palside/i18n';
import { publicShareUrl } from '@palside/shared/navigation';
import { command } from '../transport/bridge.ts';

/**
 * Permission reads and removals belong to background commands. Requests stay in the sidepanel click context:
 * Chrome checks user activation even for grants restored without a prompt; an asynchronous worker hop cannot
 * guarantee that activation. Start requests before awaiting anything, then let the background refresh state.
 */
async function permissionRequested(request: Promise<boolean>): Promise<boolean> {
  const allowed = await request;
  if (allowed) await command('permissions-sync');
  return allowed;
}

type PermissionKind = 'sites' | 'tabs' | 'notifications';
const requests = new Map<PermissionKind, Set<Promise<boolean>>>();
const removals = new Map<PermissionKind, Promise<unknown>>();
export const permissionRemovalPending = (kind: PermissionKind) => removals.has(kind);

/** Requests start in the click; a removal already in progress requires another click after it settles. */
function requestPermission(kind: PermissionKind, request: () => Promise<boolean>) {
  if (permissionRemovalPending(kind)) return Promise.reject(new MessageError(uiMessage('common.error')));
  const pending = permissionRequested(request());
  const active = requests.get(kind) ?? new Set<Promise<boolean>>();
  requests.set(kind, active); active.add(pending);
  void pending.then(() => active.delete(pending), () => active.delete(pending));
  return pending;
}
function removePermission<T>(kind: PermissionKind, remove: () => Promise<T>): Promise<T> {
  const previous = removals.get(kind);
  const pending = Promise.allSettled([previous, ...requests.get(kind) ?? []]).then(remove);
  removals.set(kind, pending);
  const done = () => { if (removals.get(kind) === pending) removals.delete(kind); };
  void pending.then(done, done);
  return pending;
}

/**
 * Chrome access, as Palside uses it: 读取您的浏览记录 (`tabs`) for 共享在看, one exact site grant per 已授权网站 for 网页互动 and
 * 代币数据, plus optional 通知.
 * `site`: this origin is granted. `active`: Chrome gave this tab to Palside for now (the toolbar icon was clicked on it), without a site grant.
 */
export type AccessStatus = { site: boolean; active?: boolean };

/** Chrome match patterns are distinct from product host rules; never broaden to subdomains or both schemes. */
export function siteOriginPattern(input?: string): string | undefined {
  if (!input) return;
  const publicUrl = publicShareUrl(input);
  if (!publicUrl) return;
  const url = new URL(publicUrl);
  if (url.hostname.includes('*')) return;
  return `${url.origin}/*`;
}

const broadOrigins = new Set(['<all_urls>', '*://*/*', 'https://*/*']);
/** A grant that covers every site: 允许所有网站 in 网站, or Chrome's own menu. */
export const broadOrigin = (origin: string) => broadOrigins.has(origin);

/** The exact host of a granted `https://host/*` or `*://host/*` pattern. */
export function grantedHost(origin: string) {
  return /^(?:https|\*):\/\/([^*/]+)\/\*$/.exec(origin)?.[1];
}

/** Chrome's granted host patterns verbatim, including a broad grant made in Chrome's menu. */
export async function getHostPermissions(): Promise<string[]> {
  return (await command('permissions-get')).origins;
}

/**
 * 开启: every site in one Chrome prompt, all or nothing. Chrome names up to three hosts and lists more under "多个网站";
 * hosts it already allows pass without asking. Call synchronously from the click so its user activation survives.
 */
export function requestSitesAccess(hosts: readonly string[], host = browser): Promise<boolean> {
  const origins = [...new Set(hosts.map(site => siteOriginPattern(`https://${site}/`)).filter((origin): origin is string => Boolean(origin)))];
  return origins.length ? requestPermission('sites', () => host.permissions.request({ origins })) : Promise.resolve(false);
}

/** 允许所有网站: Chrome's 所有网站 prompt. Call synchronously from the click so its user activation survives. */
export function requestAllSites(host = browser): Promise<boolean> {
  return requestPermission('sites', () => host.permissions.request({ origins: ['<all_urls>'] }));
}

/** Removing broad access preserves individually added sites; Chrome determines whether restoration needs confirmation. */
export function revokeAllSitesKeepingHosts(host = browser, current = () => true): Promise<boolean> {
  return removePermission('sites', async () => {
    if (!current()) return false;
    const { removed, origins } = await command('permissions-remove', { kind: 'broad-sites' });
    if (!current() || !removed) return false;
    if (origins.length && !await permissionRequested(host.permissions.request({ origins }))) return false;
    const granted = await getHostPermissions();
    return !granted.some(broadOrigin) && origins.every(origin => granted.includes(origin));
  });
}

/** 网页互动 禁用: every site grant goes, including broad access. Returns the exact hosts only after confirmed removal. */
export function revokeAllSites(current = () => true): Promise<string[]> {
  return removePermission('sites', async () => {
    if (!current()) return [];
    const { removed, origins } = await command('permissions-remove', { kind: 'sites' });
    if (!removed || (await getHostPermissions()).length) throw new MessageError(uiMessage('common.error'));
    return [...new Set(origins.flatMap(origin => grantedHost(origin) ?? []))];
  });
}

/** Removing an exact grant cannot carve an exception out of a broad grant. */
export function revokeSiteAccess(url: string, current = () => true): Promise<boolean> {
  if (!siteOriginPattern(url)) return Promise.resolve(false);
  return removePermission('sites', async () => current() && (await command('permissions-remove', { kind: 'site', url })).removed);
}

export async function accessStatus(url?: string, host?: typeof browser): Promise<AccessStatus> {
  if (!host) return { site: (await command('permissions-get', { url })).site };
  const origin = siteOriginPattern(url);
  return { site: origin ? Boolean(await host.permissions.contains({ origins: [origin] })) : false };
}

/**
 * 共享在看's 读取您的浏览记录, with the shared page's icon: Chrome folds favicon's own warning into the browsing-history
 * line, so the prompt still shows one sentence. Call synchronously from the click so its user activation survives.
 */
export function requestTabs(host = browser): Promise<boolean> {
  return requestPermission('tabs', () => host.permissions.request({ permissions: ['tabs', 'favicon'] }));
}

export async function revokeTabs(current = () => true): Promise<boolean> {
  return removePermission('tabs', async () => current() && (await command('permissions-remove', { kind: 'tabs' })).removed && !await tabsGranted());
}

export async function tabsGranted(): Promise<boolean> {
  return (await command('permissions-get')).tabs;
}

export function requestNotifications(host = browser): Promise<boolean> {
  return requestPermission('notifications', () => host.permissions.request({ permissions: ['notifications'] }));
}

export async function revokeNotifications(current = () => true): Promise<boolean> {
  return removePermission('notifications', async () => current() && (await command('permissions-remove', { kind: 'notifications' })).removed && !await notificationsGranted());
}

export async function notificationsGranted(): Promise<boolean> {
  return (await command('permissions-get')).notifications;
}

export function watchPermissions(listener: () => void): () => void {
  browser.permissions.onAdded.addListener(listener);
  browser.permissions.onRemoved.addListener(listener);
  return () => {
    browser.permissions.onAdded.removeListener(listener);
    browser.permissions.onRemoved.removeListener(listener);
  };
}
