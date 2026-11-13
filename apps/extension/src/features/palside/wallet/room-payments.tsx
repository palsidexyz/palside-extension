'use client';
import { CHAIN_RULES, TIP_AMOUNTS } from '@palside/shared/rules/wallet';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'use-intl';
import { Button } from '@palside/ui/button';
import type { PalsideController } from '../app/use-palside';
import type { ApiResult } from '../../../runtime/transport/api';
import { Sheet } from '@palside/ui/sheet';
import { PacketCard, PacketDetail } from './packet';
import { formatPals, groupPals } from './amount';
import { PersonAvatar } from '../ui/primitives';
import { roomPerson } from '../rooms/rooms';
import { ROOM_PACKET_AFTER_EXPIRY_MS } from './clock';
import { parsePals, type WalletPayment } from '../../../domain/wallet/model';
import { openPayment, usePaymentRequest } from './payment-sheet';
import s from './wallet.module.css';

/**
 * A room's packets as its 弹幕 stream carries them: the live ones and those just ended (they fade in place), plus my own from 付款 on,
 * before the service lists it; the listed one replaces it in place. Read for the room on screen, refreshed by its chain events.
 */
export function useRoomPackets(c: PalsideController, roomKey: string): RoomPacket[] {
  const command = c.live.command, enabled = c.live.state.wallet?.config?.enabled;
  const data = c.live.state.chainRoom?.key === roomKey ? c.live.state.chainRoom : undefined;
  useEffect(() => { if (enabled) void command('wallet-room', { key: roomKey }).catch(() => {}); }, [command, enabled, roomKey]);
  if (!enabled) return [];
  const listed = data?.packets.filter(item => item.expiresAt + ROOM_PACKET_AFTER_EXPIRY_MS > c.now) ?? [];
  const sending = roomSending(c.live.state.wallet?.payment, roomKey, c.data.self);
  return sending && !listed.some(item => item.id === sending.id) ? [...listed, sending] : listed;
}

/** Whether a room packet can still be grabbed by me: what the composer's 弹幕 line lets pass through. */
export const roomPacketLive = (packet: RoomPacket, c: PalsideController) => packet.status === 'active' && packet.expiresAt > c.now && packet.claimedCount < packet.count && packet.accountId !== c.data.self;

/**
 * One room packet in the 弹幕 stream: the same card as in a squad, its detail read once it is on screen (and again when the room
 * stay ends), so a tap opens the envelope with its wish and seal ready. My own still on its way reads 发送中 and opens its payment.
 */
export function RoomPacketCard({ c, packet }: { c: PalsideController; packet: RoomPacket }) {
  const command = c.live.command, chainRevision = c.live.state.chainRevision;
  const [detail, setDetail] = useState<PacketDetailData>(), [revision, setRevision] = useState(0), [open, setOpen] = useState(false);
  const pending = packet.status === 'pending';
  useEffect(() => {
    if (pending) return;
    let current = true;
    void command('wallet-packet', { id: packet.id }).then(value => { if (current) setDetail(value); }, () => {});
    return () => { current = false; };
  }, [command, packet.id, pending, packet.claimedCount, packet.status, chainRevision, revision]);
  useEffect(() => { const at = detail?.eligibleAt; if (!at || at <= Date.now()) return; const timer = setTimeout(() => setRevision(value => value + 1), Math.min(at - Date.now() + 100, 2_147_483_647)); return () => clearTimeout(timer); }, [detail?.eligibleAt]);
  // Until the detail lands the card stands on the room's summary: the wish blank, the state line loading.
  const shown: PacketDetailData = detail ?? { packet, distribution: 'random', blessing: '', eligibility: 'unavailable', eligibleAt: null, myClaim: null, claims: [] };
  return <>
    <PacketCard c={c} detail={shown} loading={!pending && !detail} onOpen={() => setOpen(true)} />
    {open && <PacketDetail c={c} id={packet.id} initial={detail} summary={packet} onClose={() => setOpen(false)} />}
  </>;
}

export type RoomPacket = ApiResult<'chain.room'>['packets'][number];
type PacketDetailData = ApiResult<'chain.packet'>;
/** The room packet this panel is sending right now, until the service lists it. */
function roomSending(payment: WalletPayment | undefined, roomKey: string, self: string): RoomPacket | undefined {
  if (!payment || !['signing', 'submitting', 'pending'].includes(payment.phase)) return undefined;
  const { input, order } = payment;
  if (input.kind !== 'packet' || input.packet.kind !== 'room' || input.packet.scope !== roomKey) return undefined;
  return { id: order.id, accountId: self, kind: 'room', scope: roomKey, status: 'pending', count: input.packet.count, amount: order.amount, claimedCount: 0, claimedAmount: '0', createdAt: payment.sentAt ?? order.createdAt, expiresAt: order.expiresAt };
}

/** 打赏: the line being thanked, then quick amounts or a custom one; the author receives all of it. */
export function TipPayment({ c, messageId, onClose }: { c: PalsideController; messageId: string; onClose: () => void }) {
  const t = useTranslations(), [amount, setAmount] = useState<string>(TIP_AMOUNTS.initial), [custom, setCustom] = useState(false), [busy, setBusy] = useState(false), [invalid, setInvalid] = useState(0);
  const reduced = useReducedMotion(), command = c.live.command;
  useEffect(() => { void command('wallet-refresh', {}).catch(() => {}); }, [command]);
  const requests = usePaymentRequest(c, JSON.stringify([c.screen, c.current, c.live.state.rooms.current?.key, messageId]));
  const close = () => { requests.cancel(); onClose(); };
  const target = c.live.state.rooms.current?.messages.find(item => item.id === messageId);
  const author = target && roomPerson(c, target.author, t('common.member'));
  const decimals = c.live.state.wallet?.config?.deployment?.decimals ?? 18;
  let value: bigint | undefined; try { value = parsePals(amount, decimals); } catch { /* The amount is still being entered. */ }
  const overLimit = !!amount && /^\d+$/.test(amount) && BigInt(amount) > BigInt(CHAIN_RULES.maxTipPals);
  const valid = Boolean(value && value > 0n && !overLimit);
  async function review() {
    if (busy) return;
    if (!valid || !value) { setInvalid(count => count + 1); return; }
    const request = requests.capture();
    setBusy(true);
    try { const quoted = await c.run('wallet-review', { input: { kind: 'tip', messageId, amount: value.toString() } }); if (!request.isCurrent()) { if (quoted) request.discard(quoted.id); return; } if (quoted) { openPayment(quoted.id); close(); } else setInvalid(count => count + 1); }
    finally { if (request.isCurrent()) setBusy(false); }
  }
  return <Sheet open onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="tip-title"><div className={`${s.page} ${s.sheetContent} ${s.tipSheet}`}>
    <h2 id="tip-title">{author ? t('extension.wallet.tipTo', { name: author.name }) : t('extension.wallet.tip')}</h2>
    {target && author && <div className={s.tipQuote}><PersonAvatar person={author} size="xs" /><span>{target.text}</span></div>}
    <motion.div className={s.tipChips} role="radiogroup" aria-label={t('extension.wallet.amount')} key={invalid} animate={invalid && !reduced ? { x: [0, -8, 8, -5, 5, 0] } : undefined} transition={{ duration: .36 }}>
      {TIP_AMOUNTS.options.map(option => <button key={option} type="button" role="radio" aria-checked={!custom && amount === option} onClick={() => { setCustom(false); setAmount(option); }}><b>{groupPals(option)}</b><small>PALS</small></button>)}
      <button type="button" role="radio" aria-checked={custom} onClick={() => { setCustom(true); setAmount(''); }}><b>{t('extension.wallet.custom')}</b></button>
    </motion.div>
    <AnimatePresence initial={false}>{custom && <motion.label key="custom" className={s.tipCustom} initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <input inputMode="numeric" autoFocus aria-label={t('extension.wallet.amount')} placeholder="0" value={amount} onChange={event => setAmount(event.target.value.replace(/[^\d]/g, ''))} /><span>PALS</span>
    </motion.label>}</AnimatePresence>
    <Button variant="primary" size="lg" className={s.wide} loading={busy} disabled={!valid} onClick={() => void review()}>{overLimit ? t('extension.wallet.tipLimit', { max: groupPals(String(CHAIN_RULES.maxTipPals)) }) : valid ? <span>{t('extension.wallet.tipAmount', { amount: groupPals(formatPals(value!.toString(), decimals)) })}</span> : t('extension.wallet.tip')}</Button>
  </div></Sheet>;
}
