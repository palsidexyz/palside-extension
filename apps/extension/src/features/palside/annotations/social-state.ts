'use client';
import { useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { pageScopeUrl } from '../../../domain/annotations/social';
import type { LocateReply, LocateResult, PageStatus } from '../../../runtime/browser/page-protocol';
import type { AssetKey } from '../../../domain/annotations/social';
import type { LivePort } from '../app/live-port';

/**
 * Panel-local social state shared by the chat, the asset discussion and the sheets; never sent anywhere.
 * - `returnTo`: the token page the user left by opening another token from the panel (one level).
 * - `follow`: the teammate this panel follows (跟看); ends on team switch or panel close.
 * - `site`: 添加网站, with `select` already chosen. `then` runs once after the sites are added, if the account, team and tab are unchanged.
 * - `grant`: the sheet for a site Chrome has not allowed while 网页互动 (`interact`) or 网页弹幕 (`danmaku`) is on.
 * - `allSites`: the sheet before Chrome's 所有网站 prompt.
 * - `read`: the 隐私与数据 drawer for one feature.
 * - `settingsTab`: the 互动选项 tab to show (弹幕, 信号 or 便利贴).
 * - `people`: the token 在看的人 shows (else the 弹幕 view's token). `roomPerson`: the card of someone met in 弹幕. `invite`: choosing a team to invite that person to.
 */
type SocialUi = {
  returnTo?: { id: number; origin: PageStatus; target: string; arrived: boolean };
  follow?: { teamId: string; personId: string };
  /** Saved marks for one exact page or an asset; focus identifies a saved record. */
  stickies?: { asset?: AssetKey; url?: string; focus?: string };
  site?: { select?: string[]; accountId?: string; teamId?: string; tabId?: number; then?: () => void };
  grant?: 'interact' | 'danmaku';
  allSites?: boolean;
  read?: ReadKey;
  settingsTab?: SettingsTab;
  people?: string;
  roomPerson?: string;
  roomPersonMessage?: string;
  /** The 弹幕 line a quote in chat asked to show; cleared once the room has loaded. */
  roomLine?: string;
  invite?: string;
};
/** A feature as 隐私与数据 lists it under the Chrome permission it runs on; each opens its own drawer. */
export type ReadKey = 'share' | 'token' | 'quote' | 'signal' | 'sticky' | 'room' | 'shot' | 'notify';
export type SettingsTab = 'danmaku' | 'signal' | 'sticky';
let value: SocialUi = {};
let owner: { accountId: string } | undefined;
let navigationId = 0;
const listeners = new Set<() => void>();
function publish(next: SocialUi) {
  value = next;
  for (const listener of listeners) listener();
}

/** One mounted panel session owns transient social state and its asynchronous completions. */
export function beginSocialSession(session: { accountId: string }) {
  owner = session;
  publish({});
  return () => { if (owner === session) { owner = undefined; publish({}); } };
}
export function captureSocialUi() {
  const session = owner;
  return {
    current: () => Boolean(session && owner === session),
    snapshot: () => session && owner === session ? value : undefined,
    set: (patch: Partial<SocialUi> | ((old: SocialUi) => Partial<SocialUi>)) => {
      if (session && owner === session) setSocialUi(patch);
    },
  };
}
export function SocialSession({ accountId, children }: { accountId: string; children: ReactNode }) {
  const session = useMemo(() => ({ accountId }), [accountId]);
  const ready = useSyncExternalStore(subscribe, () => owner === session, () => false);
  useLayoutEffect(() => beginSocialSession(session), [session]);
  return ready ? children : null;
}
export function setSocialUi(patch: Partial<SocialUi> | ((old: SocialUi) => Partial<SocialUi>)) {
  if (!owner) return;
  const next = { ...(typeof patch === 'function' ? patch(value) : patch) };
  if (next.site?.accountId && next.site.accountId !== owner.accountId) return;
  if (next.site?.then) {
    const session = captureSocialUi(), then = next.site.then;
    next.site = { ...next.site, then: () => { if (session.current()) then(); } };
  }
  publish({ ...value, ...next });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSocialUi() {
  return useSyncExternalStore(subscribe, () => value, () => value);
}

/** Arrival belongs to one opening, including when another opening starts from its destination. */
export function observeSocialPage(url: string | undefined) {
  const operation = value.returnTo;
  const page = pageScopeUrl(url);
  if (!operation || !page) return;
  if (page === operation.target) {
    if (!operation.arrived) setSocialUi({ returnTo: { ...operation, arrived: true } });
  } else if (operation.arrived) setSocialUi({ returnTo: undefined });
}

/** The supplied command owns opening; reference commands retain their background access checks. */
export function navigateWithReturn(live: Pick<LivePort, 'page'>, url: string, open: () => Promise<LocateReply>): Promise<LocateResult>;
export function navigateWithReturn(live: Pick<LivePort, 'page'>, url: string, open: () => Promise<void>): Promise<void>;
export async function navigateWithReturn(live: Pick<LivePort, 'page'>, url: string, open: () => Promise<void | LocateReply>) {
  const session = captureSocialUi();
  const previous = session.snapshot()?.returnTo;
  const target = pageScopeUrl(url), originUrl = pageScopeUrl(live.page?.url);
  const id = ++navigationId;
  const operation = target && originUrl && target !== originUrl && live.page
    ? { id, origin: { ...live.page, url: originUrl }, target, arrived: false } : undefined;
  session.set({ returnTo: operation ?? (previous?.target === originUrl ? previous : undefined) });
  const restore = () => {
    if (session.snapshot()?.returnTo?.id === operation?.id) session.set({ returnTo: previous });
  };
  try {
    const reply = await open();
    const result = typeof reply === 'object' ? reply.result : reply;
    if (typeof reply === 'object' && reply.opened && operation && session.snapshot()?.returnTo?.id === operation.id) session.set({ returnTo: { ...operation, arrived: true } });
    if (result && result !== 'shown' && !session.snapshot()?.returnTo?.arrived) restore();
    return result;
  } catch (error) { if (!session.snapshot()?.returnTo?.arrived) restore(); throw error; }
}
/** Opens another page from the panel and remembers the active tab independently of shared viewing. */
export function openWithReturn(live: Pick<LivePort, 'page' | 'openPage'>, url: string) {
  return navigateWithReturn(live, url, () => live.openPage(url, true));
}

/** Returning consumes the current stop only after its opening succeeds. */
export async function returnToOrigin(live: Pick<LivePort, 'page' | 'openPage'>) {
  const session = captureSocialUi();
  const origin = session.snapshot()?.returnTo?.origin;
  if (!origin?.url) return;
  const opening = openWithReturn(live, origin.url);
  const id = session.snapshot()?.returnTo?.id;
  await opening;
  if (session.snapshot()?.returnTo?.id === id) session.set({ returnTo: undefined });
}
