'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { clockTime, localeOrEnglish } from '@palside/i18n';
import { personFor } from '../../../domain/account/model';
import { PersonAvatar, Token } from '../ui/primitives';
import { Dots, DrawnCheck, Swap } from '../ui/motion-details';
import { PALS } from './payment-sheet';
import m from '../app/palside.module.css';
import type { ApiResult } from '../../../runtime/transport/api';
import type { PalsideController } from '../app/use-palside';
import { PalsAmount } from './amount';
import { Button } from '@palside/ui/button';
import { Envelope, PacketCard } from './packet';
import s from './wallet.module.css';

type FeedPacket = ApiResult<'chain.teamFeed'>['packets'][number];
type ClaimLine = { sender: string; claimer: string; last: boolean };
type TeamPaymentItem = { id: string; timestamp: number; packet?: FeedPacket; transfer?: ApiResult<'chain.teamFeed'>['transfers'][number]; level?: number; claim?: ClaimLine };
/** Like a group chat: the sender sees each grab, the grabber sees their own, and the sender hears when the last share went. */
function claimLines(packet: FeedPacket, self: string): TeamPaymentItem[] {
  const sender = packet.packet.accountId, full = packet.packet.claimedCount === packet.packet.count;
  return packet.claims.filter(claim => sender === self || claim.accountId === self).map((claim, index, list) => ({
    id: `${packet.packet.id}:${claim.accountId}`, timestamp: claim.claimedAt, claim: { sender, claimer: claim.accountId, last: sender === self && full && index === list.length - 1 && list.length === packet.packet.count },
  }));
}
export function useTeamPayments(c: PalsideController): TeamPaymentItem[] {
  const command = c.live?.command, enabled = c.live?.state.wallet?.config?.enabled, teamId = c.current;
  useEffect(() => { if (enabled) void command?.('wallet-team', { teamId }).catch(() => {}); }, [command, enabled, teamId]);
  const feed = c.live?.state.chainTeam?.teamId === teamId ? c.live.state.chainTeam : undefined;
  return [
    ...(feed?.packets.flatMap(packet => [{ id: packet.packet.id, timestamp: packet.packet.createdAt, packet }, ...claimLines(packet, c.data.self)]) ?? []),
    ...(feed?.transfers.map(transfer => ({ id: transfer.id, timestamp: transfer.confirmedAt ?? transfer.createdAt, transfer })) ?? []),
    ...(c.live?.state.teamLevelEvents?.filter(event => event.teamId === teamId).map(event => ({ id: event.id, timestamp: event.timestamp, level: event.to })) ?? []),
  ].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
export function MoreTeamPayments({ c }: { c: PalsideController }) {
  const t = useTranslations(), [busy, setBusy] = useState(false), feed = c.live?.state.chainTeam;
  if (feed?.teamId !== c.current || !feed.nextCursor) return null;
  return <Button size="sm" loading={busy} onClick={() => { if (busy) return; setBusy(true); void c.run('wallet-team', { teamId: c.current, cursor: feed.nextCursor! }).finally(() => setBusy(false)); }}>{t('extension.wallet.more')}</Button>;
}
export function TeamPaymentCard({ c, item }: { c: PalsideController; item: TeamPaymentItem }) {
  const t = useTranslations();
  if (item.level) return <p className={s.levelEvent}>{t('extension.wallet.level')} · Lv{item.level}</p>;
  if (item.claim) return <ClaimEvent c={c} line={item.claim} timestamp={item.timestamp} />;
  if (item.packet) return <PaymentRow c={c} author={item.packet.packet.accountId} timestamp={item.timestamp}><PacketCard c={c} detail={item.packet} /></PaymentRow>;
  if (item.transfer) return <PaymentRow c={c} author={item.transfer.accountId} timestamp={item.timestamp}><TransferCard c={c} transfer={item.transfer} /></PaymentRow>;
  return null;
}

/** A one-line system event under the packet, with a small envelope; it rises in when a grab arrives live. */
function ClaimEvent({ c, line, timestamp }: { c: PalsideController; line: ClaimLine; timestamp: number }) {
  const t = useTranslations(), reduced = useReducedMotion(), [arriving] = useState(() => Date.now() - timestamp < 5_000);
  const name = (id: string) => personFor(c.people, id, t('common.member')).name, self = c.data.self;
  const text = line.claimer === self ? line.sender === self ? t('extension.wallet.youClaimedOwn') : t('extension.wallet.youClaimed', { name: name(line.sender) }) : t('extension.wallet.claimedYours', { name: name(line.claimer) });
  return <motion.p className={`${s.levelEvent} ${s.claimEvent}`} initial={arriving && !reduced ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
    <Envelope size="xs" /><span>{text}{line.last && <>{t('extension.wallet.allClaimedSuffix')}</>}</span>
  </motion.p>;
}

/** A payment sits in the timeline like a message from whoever paid: their avatar and name, on their side, with the time beside it. */
function PaymentRow({ c, author, timestamp, children }: { c: PalsideController; author: string; timestamp: number; children: ReactNode }) {
  const t = useTranslations(), locale = useLocale(), self = author === c.data.self;
  const person = personFor(c.people, author, t('common.member')), known = c.people.some(item => item.id === author);
  return <div className={`${m.message} ${self ? m.selfMessage : ''}`}>
    <PersonAvatar person={person} onClick={known ? () => c.setPersonId(author) : undefined} />
    <div className={m.messageContent}>
      {!self && <div className={m.messageMeta}><strong>{person.name}</strong></div>}
      <div className={m.messageLine}>
        <div className={m.messageStack}>{children}</div>
        <div className={m.messageAside}><time dateTime={new Date(timestamp).toISOString()}>{clockTime(timestamp, localeOrEnglish(locale))}</time></div>
      </div>
    </div>
  </div>;
}

/** The token, the amount and who it went to; the foot names it and settles from 转账中 to a drawn check and 已到账. */
function TransferCard({ c, transfer }: { c: PalsideController; transfer: NonNullable<TeamPaymentItem['transfer']> }) {
  const t = useTranslations(), reduced = useReducedMotion();
  const [arriving] = useState(() => Date.now() - transfer.createdAt < 5_000), [settled] = useState(transfer.status === 'confirmed');
  // Everyone in the squad reads it the same way: the row already shows who paid, the line says to whom.
  const line = transfer.recipientId === c.data.self ? t('extension.wallet.transferToYou') : t('extension.wallet.transferTo', { name: personFor(c.people, transfer.recipientId, t('common.member')).name });
  const state = transfer.status === 'confirmed' ? 'done' : transfer.status === 'failed' || transfer.status === 'expired' ? 'failed' : 'sending';
  return <motion.div className={s.transferCard} data-state={state} initial={arriving && !reduced ? { opacity: 0, y: 14, scale: .96 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}>
    <span className={s.transferTop}><Token view={PALS} size="card" /><span><strong><PalsAmount value={transfer.amount} /></strong><small>{line}</small></span></span>
    <span className={s.transferFoot}><span>PALS {t('extension.wallet.transfer')}</span><span data-state={state}>
      {state === 'done' ? settled ? <Check className={s.settled} /> : <DrawnCheck size="sm" /> : state === 'sending' ? <Dots /> : null}
      <Swap k={state}>{t(state === 'done' ? 'extension.wallet.arrived' : state === 'failed' ? 'extension.wallet.recoveryFailed' : 'extension.wallet.sending')}</Swap>
    </span></span>
  </motion.div>;
}
