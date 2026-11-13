'use client';
import { useText } from '../ui/text';

import { useTranslations } from 'use-intl';
import { useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpCircle, LockKeyhole, WifiOff, ServerOff, LoaderCircle, CircleAlert } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { motionPresets } from '@palside/design/motion';
import { message as uiMessage } from '@palside/i18n';
import { connectionNotices, readonlyNotice, type ConnectionStatus } from '../../../runtime/transport/connection';
import { ContextBar } from '../ui/context-bar';
import { PageState } from '../ui/page-state';
import { Swap } from '../ui/motion-details';
import type { PalsideController } from '../app/use-palside';
import { useExtensionUpdate } from './extension-update';
import s from '../ui/refinement.module.css';

export function useReconnect(c: PalsideController) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  async function reconnect() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await c.live.command('reconnect'); }
    catch { /* The shared connection notice owns failure feedback. */ }
    finally { pending.current = false; setBusy(false); }
  }
  return { reconnect, busy: busy || Boolean(c.live.state.connection.retrying) };
}

/** The one action a connection state offers: 更新 when the service refuses this version (it updates, nothing reconnects), else 重新连接. */
function useIssueAction(c: PalsideController, status: ConnectionStatus | undefined) {
  const t = useTranslations();
  const { reconnect, busy } = useReconnect(c);
  const update = useExtensionUpdate(c);
  return status === 'update-required'
    ? { label: update.busy ? t('extension.copy.updateChecking') : t('extension.copy.update'), busy: update.busy, run: update.run }
    : { label: busy ? t('extension.copy.reconnecting') : t('extension.copy.reconnect'), busy, run: reconnect };
}

/**
 * Which connection a page depends on. Chat needs the message sync and local encryption as well; every other page that talks to the
 * server needs only the network and the business service, so a message-sync problem never shows there.
 */
export type ConnectionScope = 'chat' | 'service';
export function pageIssue(c: PalsideController, scope: ConnectionScope): ConnectionStatus | undefined {
  if (scope === 'chat' || c.connection === 'update-required') return c.connection === 'connected' ? undefined : c.connection;
  const { networkOnline, service } = c.live.state.connection;
  return !networkOnline ? 'network-offline' : service === 'unavailable' ? 'service-unavailable' : service === 'connecting' ? 'connecting' : undefined;
}
function issueTitle(status: ConnectionStatus, scope: ConnectionScope) {
  return status === 'connected' ? undefined : scope === 'service' && status === 'connecting' ? uiMessage('extension.runtime.serviceConnectingTitle') : connectionNotices[status].title;
}
function IssueIcon({ status, readonly }: { status?: ConnectionStatus; readonly?: boolean }) {
  const Icon = readonly ? LockKeyhole : status === 'update-required' ? ArrowUpCircle : status === 'network-offline' ? WifiOff : status === 'connecting' ? LoaderCircle : status === 'initialization-failed' ? CircleAlert : ServerOff;
  return <Icon size={16} className={!readonly && status === 'connecting' ? s.spin : undefined} />;
}

/** Connection trouble or a read-only team, in the chat's top slot: the 在看 chips are empty then anyway. The detail stays in the tooltip. */
export function SessionCard({ c }: { c: PalsideController }) {
  const text = useText();
  const t = useTranslations();
  const action = useIssueAction(c, c.connection);
  const issue = c.connection === 'connected' ? undefined : connectionNotices[c.connection];
  const content = c.team.readonly ? readonlyNotice(c.team.readonlyReason) : issue;
  if (!content) return null;
  const detail = `${text(content.detail)}${c.team.readonly && issue ? t('extension.runtime.readonlyConnection', { status: text(issue.title) }) : ''}`;
  const actions = issue ? [{ label: action.label, onClick: () => { if (!action.busy) void action.run(); } }] : [];
  return <ContextBar tone={c.team.readonly ? 'plain' : 'warning'} lead={<IssueIcon status={c.connection} readonly={c.team.readonly} />} title={<Swap k={c.team.readonly ? 'readonly' : c.connection}>{text(content.title)}</Swap>}
    meta={c.team.readonly && issue ? <span>{text(issue.title)}</span> : undefined} actions={actions} hint={detail} />;
}

/**
 * The same card at the top of a secondary page whose content comes from the server. It opens and closes in place (height and fade),
 * so the page below slides instead of jumping; nothing is shown while connected.
 */
export function ConnectionCard({ c, scope = 'service' }: { c: PalsideController; scope?: ConnectionScope }) {
  const text = useText();
  const reduced = useReducedMotion();
  const status = pageIssue(c, scope);
  const action = useIssueAction(c, status);
  const title = status && issueTitle(status, scope);
  return <AnimatePresence initial={false}>
    {status && title && <motion.div key="connection" style={{ overflow: 'hidden', flexShrink: 0 }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, marginBottom: -16 }} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 420, damping: 38 }}>
      <ContextBar tone="warning" lead={<IssueIcon status={status} />} title={<Swap k={status}>{text(title)}</Swap>}
        actions={[{ label: action.label, onClick: () => { if (!action.busy) void action.run(); } }]} />
    </motion.div>}
  </AnimatePresence>;
}

/** A whole page that cannot show anything without the connection: the state in one sentence and 重新连接. */
export function ConnectionState({ c, scope = 'service', fallback }: { c: PalsideController; scope?: ConnectionScope; fallback?: string }) {
  const text = useText();
  const t = useTranslations();
  const status = pageIssue(c, scope);
  const action = useIssueAction(c, status);
  const title = status ? issueTitle(status, scope) : undefined;
  return <PageState busy={status === 'connecting' || !title} title={title ? text(title) : fallback}
    action={title && <Button variant={status === 'update-required' ? 'primary' : 'surface'} loadingLabel={t('common.working')} loading={action.busy} onClick={() => void action.run()}>{action.label}</Button>} />;
}

/**
 * Controls that only the server can carry out. Without it they are disabled in place (a native disabled fieldset, laid out as if absent),
 * so nothing invites a tap that can only fail; the page's connection card says why.
 */
export function NeedsService({ c, children }: { c: PalsideController; children: ReactNode }) {
  return <fieldset disabled={Boolean(pageIssue(c, 'service'))} style={{ display: 'contents' }}>{children}</fieldset>;
}
