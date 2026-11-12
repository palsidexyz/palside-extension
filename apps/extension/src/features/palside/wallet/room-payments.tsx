'use client';
import { CHAIN_RULES, TIP_AMOUNTS } from '@palside/shared/rules/wallet';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'use-intl';
import { Button } from '@palside/ui/button';
import type { PalsideController } from '../app/use-palside';
import { Sheet } from '@palside/ui/sheet';
import { RoomPacketBanner } from './packet';
import { formatPals, groupPals } from './amount';
import { PersonAvatar } from '../ui/primitives';
import { roomPerson } from '../rooms/rooms';
import { ROOM_PACKET_AFTER_EXPIRY_MS } from './clock';
import { parsePals } from '../../../domain/wallet/model';
import { openPayment, usePaymentRequest } from './payment-sheet';
import s from './wallet.module.css';

export function RoomPayments({ c, roomKey }: { c: PalsideController; roomKey: string }) {
  const command = c.live?.command, enabled = c.live?.state.wallet?.config?.enabled;
  const data = c.live?.state.chainRoom?.key === roomKey ? c.live.state.chainRoom : undefined;
  useEffect(() => { if (enabled) void command?.('wallet-room', { key: roomKey }).catch(() => {}); }, [command, enabled, roomKey]);
  const packets = data?.packets.filter(item => item.expiresAt + ROOM_PACKET_AFTER_EXPIRY_MS > c.now) ?? [];
  if (!enabled || !packets.length) return null;
  return <div className={s.roomPayments}><RoomPacketBanner c={c} packets={packets} /></div>;
}

/** 打赏: the line being thanked, then quick amounts or a custom one; the author receives all of it. */
export function TipPayment({ c, messageId, onClose }: { c: PalsideController; messageId: string; onClose: () => void }) {
  const t = useTranslations(), [amount, setAmount] = useState<string>(TIP_AMOUNTS.initial), [custom, setCustom] = useState(false), [busy, setBusy] = useState(false), [invalid, setInvalid] = useState(0);
  const reduced = useReducedMotion(), command = c.live?.command;
  useEffect(() => { void command?.('wallet-refresh', {}).catch(() => {}); }, [command]);
  const requests = usePaymentRequest(c, JSON.stringify([c.screen, c.current, c.live?.state.rooms.current?.key, messageId]));
  const close = () => { requests.cancel(); onClose(); };
  const target = c.live?.state.rooms.current?.messages.find(item => item.id === messageId);
  const author = target && roomPerson(c, target.author, t('common.member'));
  const decimals = c.live?.state.wallet?.config?.deployment?.decimals ?? 18;
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
