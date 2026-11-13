'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { clockTime, localeOrEnglish } from '@palside/i18n';
import { personFor } from '../../../domain/account/model';
import { PersonAvatar, Token } from '../ui/primitives';
import { CountText, Pending, DrawnCheck, Swap } from '../ui/motion-details';
import { PALS } from './payment-sheet';
import m from '../app/palside.module.css';
import type { ApiResult } from '../../../runtime/transport/api';
import type { PalsideController } from '../app/use-palside';
import { PalsAmount } from './amount';
import type { PaymentPhase, WalletPayment } from '../../../domain/wallet/model';
import { Button } from '@palside/ui/button';
import { Envelope, PacketCard, PacketDetail } from './packet';
import h from '../annotations/page-hint.module.css';
import s from './wallet.module.css';

type FeedPacket = ApiResult<'chain.teamFeed'>['packets'][number];
type TeamPaymentItem = { id: string; timestamp: number; packet?: FeedPacket; transfer?: ApiResult<'chain.teamFeed'>['transfers'][number]; level?: number };
/** One note under a packet, worded like a signal hint: your own grab, or everyone else's grabs of your packet merged into one. */
type ClaimNote = { key: 'self' | 'others'; at: number; claimers: (string | null)[]; last: boolean };
/** Like a group chat: the grabber sees their own, the sender sees the others as one line that grows, and hears when the last share went. */
function claimNotes(packet: FeedPacket, self: string): ClaimNote[] {
  const sender = packet.packet.accountId, claims = packet.claims.toSorted((a, b) => a.claimedAt - b.claimedAt);
  const mine = claims.find(claim => claim.accountId === self), others = sender === self ? claims.filter(claim => claim.accountId !== self) : [];
  const notes: ClaimNote[] = [
    ...(mine ? [{ key: 'self' as const, at: mine.claimedAt, claimers: [self], last: false }] : []),
    ...(others.length ? [{ key: 'others' as const, at: others[0]!.claimedAt, claimers: others.map(claim => claim.accountId), last: false }] : []),
  ].sort((a, b) => a.at - b.at);
  if (sender === self && notes.length && packet.packet.claimedCount === packet.packet.count && claims.length === packet.packet.count) notes.at(-1)!.last = true;
  return notes;
}
/** Phases in which the payment has left the sheet: the chat already carries it, like a message just sent. */
const SENT_PHASES: ReadonlySet<PaymentPhase> = new Set(['signing', 'submitting', 'pending', 'confirmed']);
/**
 * The squad payment this panel is sending right now, drawn from 付款 on, before the service has recorded it. The service's
 * row for the same order replaces it in place; a failure before it was sent leaves nothing behind.
 */
function sendingItem(payment: WalletPayment, teamId: string, self: string): TeamPaymentItem | undefined {
  if (!SENT_PHASES.has(payment.phase)) return undefined;
  const { input, order } = payment, at = payment.sentAt ?? order.createdAt, status = payment.phase === 'confirmed' ? 'confirmed' as const : 'submitted' as const;
  if (input.kind === 'transfer' && 'teamId' in input && input.teamId === teamId) {
    return { id: order.id, timestamp: at, transfer: { id: order.id, accountId: self, recipientId: input.recipientId, teamId, amount: order.amount, createdAt: order.createdAt, submittedAt: at, confirmedAt: null, status, transactionHash: null } };
  }
  if (input.kind === 'packet' && input.packet.kind === 'team' && input.packet.scope === teamId) {
    const packet = { id: order.id, accountId: self, kind: 'team' as const, scope: teamId, status: status === 'confirmed' ? 'active' as const : 'pending' as const, count: input.packet.count, amount: order.amount, claimedCount: 0, claimedAmount: '0', createdAt: at, expiresAt: order.expiresAt };
    return { id: order.id, timestamp: at, packet: { packet, distribution: input.packet.distribution, blessing: input.packet.blessing ?? '', eligibility: 'unavailable', eligibleAt: null, myClaim: null, claims: [] } };
  }
  return undefined;
}
export function useTeamPayments(c: PalsideController): TeamPaymentItem[] {
  const command = c.live?.command, enabled = c.live?.state.wallet?.config?.enabled, teamId = c.current, payment = c.live?.state.wallet?.payment;
  useEffect(() => { if (enabled) void command?.('wallet-team', { teamId }).catch(() => {}); }, [command, enabled, teamId]);
  const feed = c.live?.state.chainTeam?.teamId === teamId ? c.live.state.chainTeam : undefined;
  const recorded = (id: string) => !!feed && (feed.packets.some(item => item.packet.id === id) || feed.transfers.some(item => item.id === id));
  const local = payment && !recorded(payment.order.id) ? sendingItem(payment, teamId, c.data.self) : undefined;
  return [
    ...(feed?.packets.map(packet => ({ id: packet.packet.id, timestamp: packet.packet.createdAt, packet })) ?? []),
    ...(feed?.transfers.map(transfer => ({ id: transfer.id, timestamp: transfer.confirmedAt ?? transfer.submittedAt ?? transfer.createdAt, transfer })) ?? []),
    ...(local ? [local] : []),
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
  if (item.packet) return <PacketEntry c={c} packet={item.packet} timestamp={item.timestamp} />;
  if (item.transfer) return <PaymentRow c={c} author={item.transfer.accountId} timestamp={item.timestamp}><TransferCard c={c} transfer={item.transfer} timestamp={item.timestamp} /></PaymentRow>;
  return null;
}

/** The packet card with its claim notes right under it, so a grab is never read against another packet; a note opens the same detail. */
function PacketEntry({ c, packet, timestamp }: { c: PalsideController; packet: FeedPacket; timestamp: number }) {
  const [open, setOpen] = useState(false);
  const notes = claimNotes(packet, c.data.self);
  return <div>
    <PaymentRow c={c} author={packet.packet.accountId} timestamp={timestamp}><PacketCard c={c} detail={packet} onOpen={() => setOpen(true)} /></PaymentRow>
    {notes.map(note => <ClaimNoteRow key={note.key} c={c} sender={packet.packet.accountId} note={note} onOpen={() => setOpen(true)} />)}
    {open && <PacketDetail c={c} id={packet.packet.id} initial={packet} onClose={() => setOpen(false)} />}
  </div>;
}

/** A claim note is a timeline hint like a signal or a drawing: the same soft pill, spacing and arrival; the count rolls as grabs join. */
function ClaimNoteRow({ c, sender, note, onOpen }: { c: PalsideController; sender: string | null; note: ClaimNote; onOpen: () => void }) {
  const t = useTranslations(), reduced = useReducedMotion(), [arriving] = useState(() => Date.now() - note.at < 5_000);
  const name = (id: string | null) => personFor(c.people, id, t('common.member'), t('common.deletedMember')).name;
  const [first, second] = note.claimers;
  const text = note.key === 'self' ? sender === c.data.self ? t('extension.wallet.youClaimedOwn') : t('extension.wallet.youClaimed', { name: name(sender) })
    : note.claimers.length === 1 ? t('extension.wallet.claimedYours', { name: name(first ?? null) })
    : note.claimers.length === 2 ? t('extension.wallet.claimedYoursTwo', { first: name(first ?? null), second: name(second ?? null) })
    : <CountText text={t('extension.wallet.claimedYoursMany', { name: name(first ?? null), count: note.claimers.length })} value={note.claimers.length} />;
  return <motion.div className={h.row} initial={!arriving ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
    <span className={h.note}>
      <button type="button" className={h.open} onClick={onOpen}><span className={s.claimArt}><Envelope size="xs" /></span><span className={h.text}>{text}{note.last && t('extension.wallet.allClaimedSuffix')}</span></button>
    </span>
  </motion.div>;
}

/** A payment sits in the timeline like a message from whoever paid: their avatar and name, on their side, with the time beside it. */
function PaymentRow({ c, author, timestamp, children }: { c: PalsideController; author: string | null; timestamp: number; children: ReactNode }) {
  const t = useTranslations(), locale = useLocale(), self = author === c.data.self;
  const person = personFor(c.people, author, t('common.member'), t('common.deletedMember')), known = author !== null && c.people.some(item => item.id === author);
  return <div className={`${m.message} ${self ? m.selfMessage : ''}`}>
    <PersonAvatar person={person} onClick={known ? () => c.setPersonId(author!) : undefined} />
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
function TransferCard({ c, transfer, timestamp }: { c: PalsideController; transfer: NonNullable<TeamPaymentItem['transfer']>; timestamp: number }) {
  const t = useTranslations(), reduced = useReducedMotion();
  // It rises in when it has just been sent or just arrived, however long its quote sat on the confirm step.
  const [arriving] = useState(() => Date.now() - timestamp < 5_000), [settled] = useState(transfer.status === 'confirmed');
  // Everyone in the squad reads it the same way: the row already shows who paid, the line says to whom.
  const line = transfer.recipientId === c.data.self ? t('extension.wallet.transferToYou') : t('extension.wallet.transferTo', { name: personFor(c.people, transfer.recipientId, t('common.member'), t('common.deletedMember')).name });
  const state = transfer.status === 'confirmed' ? 'done' : transfer.status === 'failed' || transfer.status === 'expired' ? 'failed' : 'sending';
  return <motion.div className={s.transferCard} data-state={state} initial={arriving && !reduced ? { opacity: 0, y: 14, scale: .96 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}>
    <span className={s.transferTop}><Token view={PALS} size="card" /><span><strong><PalsAmount value={transfer.amount} /></strong><small>{line}</small></span></span>
    <span className={s.transferFoot}><span>PALS {t('extension.wallet.transfer')}</span><span data-state={state}>
      {state === 'done' ? settled ? <Check className={s.settled} /> : <DrawnCheck size="sm" /> : state === 'sending' ? <Pending /> : <span className={s.failGlyph}><X /></span>}
      <Swap k={state}>{t(state === 'done' ? 'extension.wallet.arrived' : state === 'failed' ? 'extension.wallet.recoveryFailed' : 'extension.wallet.sending')}</Swap>
    </span></span>
  </motion.div>;
}
