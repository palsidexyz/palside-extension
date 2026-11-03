'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { message as uiMessage } from '@palside/i18n';
import { Tooltip } from '@palside/ui/tooltip';
import { requestTabs } from '../../../runtime/browser/permissions';
import { useGrants } from '../settings/use-grants';
import type { PalsideController } from '../app/use-palside';
import s from './page-toggles.module.css';

/** 共享在看 belongs to squads that can be written to; a read-only squad has no key. */
export function shareShown(c: PalsideController) {
  return c.canWrite;
}

/** `off` not sharing · `on` sharing every page this window shows · `blocked` on, but this page cannot be shared (it resumes on the next). */
export type ShareState = 'off' | 'on' | 'blocked';

export function shareState(c: PalsideController): ShareState {
  if (!c.share) return 'off';
  return c.live?.page?.capabilities.share.state === 'blocked' ? 'blocked' : 'on';
}

/**
 * 共享在看, the right half of the header capsule: one press on, one press off, kept across browser restarts. The first press asks Chrome for
 * 读取您的浏览记录 in the same click; a refusal keeps it off and says so. A press answered after the squad, the account or the session
 * changed — or after a newer press — does nothing.
 */
export function ShareToggle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const operation = useRef({ version: 0 });
  const [asking, setAsking] = useState(false);
  const squad = c.current;
  const live = Boolean(c.live);
  useLayoutEffect(() => {
    const pending = operation.current;
    return () => { pending.version++; };
  }, [c.data.self, c.live?.state.account?.id, squad, live, c.canWrite]);
  if (!shareShown(c)) return null;
  const state = shareState(c);
  const on = state !== 'off';
  const published = c.live?.state.publishedViewing;
  const sharing = state === 'on' && (!c.live || (published?.teamId === c.current && published.expiresAt > c.now));
  const label = t(state === 'off' ? 'extension.toggle.shareOff' : state === 'blocked' ? 'extension.toggle.shareBlocked' : 'extension.toggle.shareOn');
  function press() {
    // While Chrome's prompt is open a second press changes nothing — unless 共享在看 came on elsewhere meanwhile: then it turns off,
    // and the prompt's answer is ignored.
    if (asking && !on) return;
    const token = ++operation.current.version;
    if (asking) setAsking(false);
    if (on) { void c.toggle('share', false); return; }
    if (!c.live || grants.tabs) { void c.toggle('share', true); return; }
    // Chrome's prompt must open synchronously from this click.
    setAsking(true);
    void requestTabs().then(allowed => {
      if (token !== operation.current.version) return;
      if (allowed) void c.toggle('share', true);
      else c.setNotice(uiMessage('extension.share.blockedByChrome'));
    }, () => {
      if (token === operation.current.version) c.setNotice(uiMessage('extension.share.blockedByChrome'));
    }).finally(() => { if (token === operation.current.version) setAsking(false); });
  }
  return <Tooltip content={label}>
    <button type="button" className={s.toggle} data-tour="share" data-on={on || undefined} data-dim={state === 'blocked' || undefined} data-live={sharing || undefined}
      aria-label={label} aria-pressed={on} aria-busy={asking || undefined} onClick={press}>
      <span className={s.key} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle className={s.center} cx="12" cy="12" r="2" />
          <path className={s.waveInner} pathLength={1} d="M16.247 7.761a6 6 0 0 1 0 8.478M7.753 16.239a6 6 0 0 1 0-8.478" />
          <path className={s.waveOuter} pathLength={1} d="M19.075 4.933a10 10 0 0 1 0 14.134M4.925 19.067a10 10 0 0 1 0-14.134" />
          <line className={s.knock} pathLength={1} x1="5" y1="19" x2="19" y2="5" />
          <line className={s.slash} pathLength={1} x1="5" y1="19" x2="19" y2="5" />
        </svg>
      </span>
      <span className={s.ban} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><circle cx="12" cy="12" r="8" /><path d="m6.5 17.5 11-11" /></svg></span>
    </button>
  </Tooltip>;
}
