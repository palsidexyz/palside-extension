import { errorMessage } from '@palside/i18n';
import type { PageAction,PageCapability } from '../../../runtime/browser/page-protocol';
import { accessStatus } from '../../../runtime/browser/permissions';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { captureSocialUi } from '../annotations/social-state';
import type { PalsideController } from '../app/use-palside';

let accessIntent = 0;
const requestIds = new WeakMap<object, number>();
let requestId = 0;
export function siteRequestId(request: object) {
  let id = requestIds.get(request);
  if (id === undefined) { id = ++requestId; requestIds.set(request, id); }
  return id;
}

/** The exact host of a web address, or nothing when it cannot be added. */
function urlHost(url: string | undefined) {
  try { return url && /^https?:$/.test(new URL(url).protocol) ? normalizeSiteHost(new URL(url).hostname) : undefined; } catch { return; }
}

/**
 * Opens 添加网站 with these hosts already selected (none when Chrome hides which site the tab is). `then` runs once after
 * the sites are added, if the account, team and tab are unchanged.
 */
export function addSite(c: PalsideController, request: { select?: string[]; tabId?: number; then?: () => void } = {}) {
  ++accessIntent;
  captureSocialUi().set({ site: { ...request, accountId: c.data.self, teamId: c.current } });
}

/** Locating a quote or a note needs the destination site, not the open page: a site Chrome does not allow is offered first. */
export function withTargetAccess(c: PalsideController, url: string, action: () => void) {
  const session = captureSocialUi(), intent = ++accessIntent, picker = session.snapshot()?.site;
  const current = () => session.current() && c.ownsAccess() && intent === accessIntent && session.snapshot()?.site === picker;
  void accessStatus(url).then(status => {
    if (!current()) return;
    if (status.site) action();
    else { const host = urlHost(url); addSite(c, { select: host ? [host] : [], then: action }); }
  }).catch(error => { if (current()) c.setNotice(errorMessage(error)); });
}

/** What the active tab allows for a page action right now; before the first page status it counts as still loading. */
export function capability(c: PalsideController, action: PageAction): PageCapability {
  return c.live?.page?.capabilities?.[action] ?? { state: 'pending' };
}

/** The tooltip reason when an action cannot run on this tab, or nothing when it can (allowing the site counts as can). */
export function unavailableReason(c: PalsideController, action: PageAction) {
  const value = capability(c, action);
  return value.state === 'pending' ? 'extension.capability.pending' : value.state === 'blocked' ? `extension.capability.${value.reason ?? 'none'}` : undefined;
}
