'use client';
import { useText } from '../ui/text';

import { useTranslations } from 'use-intl';
import { useRef, useState } from 'react';
import { LockKeyhole, WifiOff, ServerOff, LoaderCircle, CircleAlert } from 'lucide-react';
import { connectionNotices, readonlyNotice } from '../../../runtime/transport/connection';
import { ContextBar } from '../ui/context-bar';
import type { PalsideController } from '../app/use-palside';
import s from '../ui/refinement.module.css';

export function useReconnect(c: PalsideController) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  async function reconnect() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { if (c.live) await c.live.command('reconnect'); else c.setOffline(false); }
    catch { /* The shared connection notice owns failure feedback. */ }
    finally { pending.current = false; setBusy(false); }
  }
  return { reconnect, busy: busy || Boolean(c.live?.state.connection.retrying) };
}

/** Connection trouble or a read-only team, in the top slot: the 在看 chips are empty then anyway. The detail stays in the tooltip. */
export function SessionCard({ c }: { c: PalsideController }) {
  const text = useText();
  const t = useTranslations();
  const { reconnect, busy } = useReconnect(c);
  const issue = c.connection === 'connected' ? undefined : connectionNotices[c.connection];
  const content = c.team.readonly ? readonlyNotice(c.team.readonlyReason) : issue;
  if (!content) return null;
  const Icon = c.team.readonly ? LockKeyhole : c.connection === 'network-offline' ? WifiOff : c.connection === 'connecting' ? LoaderCircle : c.connection === 'initialization-failed' ? CircleAlert : ServerOff;
  const detail = `${text(content.detail)}${c.team.readonly && issue ? t('extension.runtime.readonlyConnection', { status: text(issue.title) }) : ''}`;
  const actions = issue ? [{ label: busy ? t('extension.copy.reconnecting') : t('extension.copy.reconnect'), onClick: () => { if (!busy) void reconnect(); } }] : [];
  return <ContextBar tone={c.team.readonly ? 'plain' : 'warning'} lead={<Icon size={16} className={c.connection === 'connecting' ? s.spin : undefined} />} title={text(content.title)}
    meta={c.team.readonly && issue ? <span>{text(issue.title)}</span> : undefined} actions={actions} hint={detail} />;
}
