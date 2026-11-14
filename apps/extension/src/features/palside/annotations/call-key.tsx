'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Megaphone } from 'lucide-react';
import { requestTabs } from '../../../runtime/browser/permissions';
import { Action } from '../ui/primitives';
import { capability, unavailableReason } from '../settings/access';
import type { PalsideController } from '../app/use-palside';

/** How long a just-granted tab address may take to reach the panel before the press is dropped. */
const ADDRESS_WAIT_MS = 3_000;

/**
 * 喊来看 from this panel: the page in front goes to the squad as a card that calls everyone, or one teammate. Any page that can be
 * shared works, whoever is online and wherever they are. Where Chrome has not told Palside the tab's address yet, the press asks for
 * the same browser permission as 共享在看 and sends once the address arrives. `reason` is why it cannot run here, if it cannot.
 */
export function useCall(c: PalsideController) {
  const [busy, setBusy] = useState(false);
  // A press waiting for the tab's address after the permission prompt; it is sent when the address arrives, or dropped.
  const pending = useRef<{ accountId?: string; then?: () => void; timer: ReturnType<typeof setTimeout> }>(undefined);
  const latest = useRef(c);
  useEffect(() => { latest.current = c; });
  const { state } = capability(c, 'share');
  const reason = state === 'access' ? undefined : unavailableReason(c, 'share');
  const url = c.live.page?.url;
  async function send(address: string, accountId?: string, then?: () => void) {
    setBusy(true);
    try { then?.(); await latest.current.call(address, accountId); } finally { setBusy(false); }
  }
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting || !url) return;
    pending.current = undefined; clearTimeout(waiting.timer);
    void send(url, waiting.accountId, waiting.then);
  }, [url]);
  useEffect(() => () => clearTimeout(pending.current?.timer), []);
  function press(accountId?: string, then?: () => void) {
    if (reason || busy) return;
    if (url && state === 'ready') { void send(url, accountId, then); return; }
    // Asked synchronously from the click, so Chrome keeps the user activation the prompt needs.
    setBusy(true);
    void requestTabs().then(allowed => {
      if (!allowed) { setBusy(false); return; }
      pending.current = { accountId, then, timer: setTimeout(() => { pending.current = undefined; setBusy(false); }, ADDRESS_WAIT_MS) };
    }, () => setBusy(false));
  }
  return { reason, busy, press };
}

/** 喊大家来看, in the composer's tools. Unavailable, it stays in place, greyed, and its tooltip says why. */
export function CallKey({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const { reason, busy, press } = useCall(c);
  const label = t('extension.member.callKey');
  return <Action label={reason ? `${label} · ${t(reason)}` : label} aria-disabled={reason ? true : undefined} aria-busy={busy || undefined} onClick={() => press()}><Megaphone /></Action>;
}
