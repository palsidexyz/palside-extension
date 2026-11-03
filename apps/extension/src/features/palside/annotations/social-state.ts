'use client';
import { useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { AssetKey } from '../../../domain/annotations/social';

/**
 * Panel-local social state shared by the chat, the asset discussion and the sheets; never sent anywhere.
 * - `follow`: the teammate this panel follows (跟看); ends on team switch or panel close.
 * - `site`: 添加网站, with `select` already chosen. `then` runs once after the sites are added, if the account, team and tab are unchanged.
 * - `grant`: the 网页互动 sheet for the tab's site: what it draws there, its switches, and Chrome's permission for it.
 * - `allSites`: the sheet before Chrome's 所有网站 prompt.
 * - `read`: the 隐私与数据 drawer for one feature.
 * - `settingsTab`: the 互动选项 tab to show (弹幕, 信号 or 便利贴).
 * - `people`: the token 在看的人 shows (else the 弹幕 view's token). `roomPerson`: the card of someone met in 弹幕. `invite`: choosing a team to invite that person to.
 */
type SocialUi = {
  follow?: { teamId: string; personId: string };
  /** Saved marks for one exact page or an asset; focus identifies a saved record. */
  stickies?: { asset?: AssetKey; url?: string; focus?: string };
  site?: { select?: string[]; accountId?: string; teamId?: string; tabId?: number; then?: () => void };
  grant?: boolean;
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
export type ReadKey = 'share' | 'token' | 'quote' | 'signal' | 'sticky' | 'room' | 'shot' | 'presence' | 'notify';
export type SettingsTab = 'danmaku' | 'signal' | 'sticky';
let value: SocialUi = {};
let owner: { accountId: string } | undefined;
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
