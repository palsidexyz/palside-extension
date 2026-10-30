'use client';
import { useLayoutEffect, useRef } from 'react';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { Layers, Lock } from 'lucide-react';
import { Tooltip } from '@palside/ui/tooltip';
import { requestSitesAccess, requestTabs } from '../../../runtime/browser/permissions';
import { capability, unavailableReason } from '../settings/access';
import { ShareIcon } from '../ui/icons';
import { setSocialUi } from '../annotations/social-state';
import { useGrants } from '../settings/use-grants';
import type { PalsideController } from '../app/use-palside';
import s from './page-toggles.module.css';

/**
 * 网页互动 on this tab: `off`, `on`, `blocked` (on, but this page can never run it) or `need` (on, but Chrome has not allowed
 * this site).
 */
function interactState(c: PalsideController) {
  if (!c.toggles.interact) return 'off';
  const { state } = capability(c, 'pick');
  return state === 'blocked' || state === 'pending' ? 'blocked' : state === 'access' ? 'need' : 'on';
}

/**
 * One press of 网页互动. Off → on for every page; when Chrome has not allowed this site it asks in the same click, and a
 * refusal leaves the button on with the site unauthorized. An unauthorized site opens its sheet; otherwise on → off.
 */
function pressInteract(c: PalsideController) {
  const state = interactState(c);
  if (state === 'need') { setSocialUi({ grant: 'interact' }); return; }
  if (state !== 'off') { void c.toggle('interact', false); return; }
  if (c.live && capability(c, 'pick').state === 'access' && c.pageHost) void requestSitesAccess([c.pageHost]).catch(() => false);
  void c.toggle('interact', true);
}

/** The 网页互动 tooltip: the feature and its state, with why it is not drawing here when it is on. */
function interactLabel(c: PalsideController, t: ReturnType<typeof useTranslations>) {
  const state = interactState(c);
  if (state === 'need') return c.pageHost ? t('extension.toggle.interactNeed', { host: c.pageHost }) : t('extension.toggle.interactNeedHere');
  if (state === 'blocked') { const reason = unavailableReason(c, 'pick'); return t('extension.toggle.interactBlocked', { reason: reason ? t(reason) : '' }); }
  return t(state === 'on' ? 'extension.toggle.interactOn' : 'extension.toggle.interactOff');
}

/**
 * 共享在看, left of 网页互动: on means every page this window shows is shared until it is pressed again or the browser closes.
 * The first press asks Chrome for 读取您的浏览记录; a refusal keeps it off.
 */
export function ShareToggle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const operation = useRef({ version: 0 });
  const squad = c.current;
  const live = Boolean(c.live);
  useLayoutEffect(() => {
    const pending = operation.current;
    return () => { pending.version++; };
  }, [c.data.self, c.live?.state.account?.id, squad, live, c.web.share, c.canWrite, c.toggles.share]);
  if (!c.web.share || !c.canWrite) return null;
  const on = c.toggles.share;
  const blocked = on && c.live?.page?.capabilities.share.state === 'blocked';
  const published = c.live?.state.publishedViewing;
  const sharing = on && !blocked && published?.teamId === c.current && published.expiresAt > c.now;
  const label = !on ? t('extension.toggle.shareOff') : blocked ? t('extension.toggle.shareBlocked') : t('extension.toggle.shareOn');
  function press() {
    const token = ++operation.current.version;
    if (on) { void c.toggle('share', false); return; }
    if (!c.live || grants.tabs) { void c.toggle('share', true); return; }
    // Chrome's prompt must open synchronously from this click.
    void requestTabs().then(allowed => {
      if (allowed && token === operation.current.version) void c.toggle('share', true);
    }, () => {
      if (token === operation.current.version) c.setNotice(uiMessage('extension.share.blockedByChrome'));
    });
  }
  return <Tooltip content={label}>
    <button type="button" className={s.toggle} data-on={on || undefined} data-dim={blocked || undefined} data-live={sharing || undefined} aria-label={label} aria-pressed={on} onClick={press}>
      <ShareIcon className={{ center: s.center, inner: s.waveInner, outer: s.waveOuter }} />
    </button>
  </Tooltip>;
}

/** 网页互动 (信号、便利贴), left of send. Unauthorized reads 授权 in amber and opens the sheet that can allow the site. */
export function InteractToggle({ c }: { c: PalsideController }) {
  const t = useTranslations();
  if (!c.live || !c.interacting) return null;
  const state = interactState(c);
  const label = interactLabel(c, t);
  if (state === 'need') return <Tooltip content={label}><button type="button" className={s.grant} aria-label={label} aria-haspopup="dialog" onClick={() => pressInteract(c)}><Lock aria-hidden="true" />{t('extension.grant.allow')}</button></Tooltip>;
  return <Tooltip content={label}>
    <button type="button" className={s.toggle} data-on={state !== 'off' || undefined} data-dim={state === 'blocked' || undefined} aria-label={label} aria-pressed={state !== 'off'} onClick={() => pressInteract(c)}>
      <Layers />
    </button>
  </Tooltip>;
}
