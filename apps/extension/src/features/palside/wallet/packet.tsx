'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { clockTime, deadlineTime, errorMessage, localeOrEnglish } from '@palside/i18n';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Crown, Minus, Plus, X } from 'lucide-react';
import { motionPresets } from '@palside/design/motion';
import { Button, IconButton } from '@palside/ui/button';
import { Sheet } from '@palside/ui/sheet';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { TEAM_MEMBER_LIMIT } from '@palside/shared/rules/teams';
import { graphemeLength } from '@palside/shared/contracts/rules';
import { CHAIN_RULES } from '@palside/shared/rules/wallet';
import type { ApiResult } from '../../../runtime/transport/api';
import { nearestEqualPacketTotal, parsePals } from '../../../domain/wallet/model';
import { personFor } from '../../../domain/account/model';
import type { PalsideController } from '../app/use-palside';
import { PersonAvatar } from '../ui/primitives';
import { Count, CountText, Pending, DrawnCheck, Rise, Swap } from '../ui/motion-details';
import { AnimatedAmount, formatPals, groupPals } from './amount';
import { openPayment, usePaymentRequest } from './payment-sheet';
import { usePacketCoins, type PacketCoins } from './packet-coins';
import { useText } from '../ui/text';
import s from './wallet.module.css';
import p from './packet.module.css';

type Detail = ApiResult<'chain.packet'>;
type Packet = Detail['packet'];

/** The packet itself as a small drawing: a red envelope, a lighter flap and a gold seal. Flat, no gradient. */
export function Envelope({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return <span className={p.envelope} data-size={size} aria-hidden="true" />;
}

function kindLabel(t: ReturnType<typeof useTranslations>, detail: Detail) {
  const { kind } = detail.packet;
  return t(kind === 'room' ? 'extension.wallet.kindRoom' : detail.distribution === 'random' ? 'extension.wallet.kindRandom' : 'extension.wallet.kindEqual');
}
const ended = (packet: Packet, now: number) => packet.status === 'exhausted' || packet.status === 'refunded' || packet.expiresAt <= now;
const openable = (detail: Detail, now: number) => detail.eligibility === 'eligible' && detail.packet.status === 'active' && detail.packet.expiresAt > now;

/** The packet's state for me right now, in the fewest words. */
function useStateLine(c: PalsideController, detail: Detail): { key: string; dim: boolean; line: ReactNode } {
  const t = useTranslations(), { packet } = detail;
  // Only the sender sees a packet before it is on chain: on its way like a sent message, or failed where it stands.
  if (packet.status === 'pending') return { key: 'sending', dim: false, line: <span className={p.sending}><Pending />{t('extension.copy.sending')}</span> };
  if (packet.status === 'failed') return { key: 'failed', dim: true, line: t('extension.wallet.recoveryFailed') };
  return { key: 'ready', ...readyLine(c, detail, t) };
}
function readyLine(c: PalsideController, detail: Detail, t: ReturnType<typeof useTranslations>): { dim: boolean; line: ReactNode } {
  const { packet } = detail;
  if (detail.myClaim && detail.myClaim.status !== 'failed') return { dim: true, line: t('extension.wallet.claimedAmount', { amount: groupPals(formatPals(detail.myClaim.amount)) }) };
  if (packet.accountId === c.data.self && !ended(packet, c.now)) return { dim: false, line: <CountText text={t('extension.wallet.claimedOf', { claimed: packet.claimedCount, count: packet.count })} value={packet.claimedCount} /> };
  if (packet.status === 'exhausted') return { dim: true, line: t('extension.wallet.gone') };
  if (packet.status === 'refunded') return { dim: true, line: t('extension.wallet.refunded') };
  if (packet.expiresAt <= c.now) return { dim: true, line: t('extension.wallet.packetExpired') };
  return { dim: false, line: t(detail.eligibility === 'eligible' ? 'extension.wallet.claim' : `extension.wallet.eligibility.${detail.eligibility}`) };
}

/** 红包卡片 in chat: red top with the wish and what it means for me now, a quiet foot with the kind; spent packets fade. */
/** `onOpen` lets the timeline own the detail sheet, so the claim notes under the card open the same packet. */
export function PacketCard({ c, detail, onOpen }: { c: PalsideController; detail: Detail; onOpen?: () => void }) {
  const t = useTranslations(), reduced = useReducedMotion(), [open, setOpen] = useState(false);
  const [arriving] = useState(() => Date.now() - detail.packet.createdAt < 5_000);
  const { key, dim, line } = useStateLine(c, detail);
  // Until it is on chain there is nothing to grab or look back on; the card opens the payment still settling, if this panel holds it.
  const settling = key !== 'ready', payment = c.live?.state.wallet?.payment;
  const tap = () => settling ? payment?.id === detail.packet.id && openPayment(payment.id) : onOpen ? onOpen() : setOpen(true);
  return <>
    <motion.button type="button" className={p.card} data-self={detail.packet.accountId === c.data.self || undefined} data-dim={dim || undefined} data-settling={settling || undefined} onClick={tap}
      initial={arriving && !reduced ? { opacity: 0, y: 14, scale: .96 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}>
      <span className={p.cardTop}><Envelope /><span><strong>{detail.blessing || t('extension.wallet.blessingPlaceholder')}</strong><small><Swap k={`${key}:${dim}`}><span>{line}</span></Swap></small></span></span>
      <span className={p.cardFoot}><span>PALS {t('extension.wallet.packet')}</span><span>{kindLabel(t, detail)}</span></span>
    </motion.button>
    {open && <PacketDetail c={c} id={detail.packet.id} initial={detail} onClose={() => setOpen(false)} />}
  </>;
}

type EnvelopeState = 'idle' | 'spinning' | 'opened' | 'lost' | 'leaving';

/**
 * The envelope: tap 开 and the seal spins while the service assigns the share (no password, nothing to sign), then the
 * flap lifts away and the result rises. When the last share went first, the seal stops, the envelope shakes and says so.
 * Opened from a banner before its detail arrived, it shows the sender at once and the seal breathes until the wish lands.
 */
function PacketEnvelope({ c, packet, detail, onClose, onClaim, onOpened, onBurst, feedback }: { c: PalsideController; packet: Packet; detail?: Detail; onClose: () => void; onClaim: () => void; onOpened: () => void; onBurst: (seal: Element) => void; feedback?: ReactNode }) {
  const t = useTranslations(), text = useText(), reduced = useReducedMotion();
  const dialogRef = useRef<HTMLDialogElement>(null), sealRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<EnvelopeState>('idle'), [note, setNote] = useState<string>(), [claiming, setClaiming] = useState(false);
  const sender = personFor(c.people, packet.accountId, t('common.member'), t('common.deletedMember'));
  // From the tap on 开 the envelope plays its own story: the claim's live update already reads 已领取, which must not swap the
  // spinning seal for the spent one or the wish for that word before the flap has lifted.
  const canOpen = claiming || (detail ? openable(detail, c.now) : undefined);
  const closed = claiming || !detail || canOpen ? undefined : detail.packet.status === 'exhausted' ? t('extension.wallet.lost') : detail.packet.expiresAt <= c.now ? t('extension.wallet.packetExpired') : t(`extension.wallet.eligibility.${detail.eligibility}`);
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  // With reduced motion the flap does not travel, so nothing would report the end of its lift.
  useEffect(() => { if (state === 'opened' && reduced) onOpened(); }, [state, reduced, onOpened]);
  async function open() {
    if (state !== 'idle' || !c.live) return;
    setState('spinning'); setClaiming(true); onClaim();
    const started = Date.now(), turn = () => new Promise(resolve => setTimeout(resolve, reduced ? 0 : Math.max(0, started + 700 - Date.now())));
    try {
      await c.live.command('wallet-claim', { packetId: packet.id }); await turn();
      // The share is assigned: PALS fan out of the seal as the flap lifts.
      if (!reduced && sealRef.current) onBurst(sealRef.current);
      setState('opened');
    }
    catch (error) {
      await turn();
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      setNote(code === 'CHAIN_PACKET_UNAVAILABLE' ? t('extension.wallet.lost') : text(errorMessage(error))); setClaiming(false); setState('lost');
    }
  }
  const leave = () => { if (state !== 'spinning') setState('leaving'); };
  const shown = note ?? closed;
  return <dialog ref={dialogRef} className={p.envDialog} data-packet-envelope aria-label={t('extension.wallet.packetFrom', { name: sender.name })} onCancel={event => { event.preventDefault(); leave(); }}
    onClick={event => { if (event.target === event.currentTarget) leave(); }}>
    <motion.div className={p.env} initial={reduced ? false : { opacity: 0, scale: .9, y: 12 }}
      animate={state === 'leaving' ? { opacity: 0, scale: .96 } : state === 'lost' && !reduced ? { x: [0, -8, 8, -5, 5, 0], opacity: 1, scale: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
      transition={state === 'leaving' ? { duration: .16 } : state === 'lost' ? { duration: .4 } : { type: 'spring', stiffness: 420, damping: 30 }}
      onAnimationComplete={() => { if (state === 'leaving') onClose(); }}>
      <motion.div className={p.envFlap} animate={state === 'opened' && !reduced ? { y: '-104%' } : { y: 0 }} transition={{ duration: .42, ease: [.65, 0, .35, 1] }}
        onAnimationComplete={() => { if (state === 'opened') onOpened(); }}>
        <button type="button" className={p.envClose} aria-label={t('common.close')} disabled={state === 'spinning'} onClick={leave}><X /></button>
        <span className={p.envFrom}><PersonAvatar person={sender} size="sm" /><span>{t('extension.wallet.packetFrom', { name: sender.name })}</span></span>
        <strong className={p.envWish}><Swap k={shown ?? (detail ? 'wish' : 'waiting')}>{shown ?? (detail ? detail.blessing || t('extension.wallet.blessingPlaceholder') : ' ')}</Swap></strong>
      </motion.div>
      {canOpen !== false && state !== 'lost'
        ? <motion.button ref={sealRef} type="button" className={p.envSeal} aria-label={t('extension.wallet.open')} disabled={state !== 'idle' || !canOpen} onClick={() => void open()}
          animate={state === 'spinning' && !reduced ? { rotateY: [0, 360] } : state === 'opened' ? { scale: .6, opacity: 0 } : canOpen === undefined && !reduced ? { opacity: [1, .72, 1] } : { rotateY: 0, opacity: 1 }}
          transition={state === 'spinning' ? { duration: .6, repeat: Infinity, ease: 'linear' } : canOpen === undefined ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: .2 }} whileTap={reduced || !canOpen ? undefined : { scale: .94 }}>{t('extension.wallet.open')}</motion.button>
        : <motion.span className={p.envSealOff} aria-hidden="true" initial={state === 'lost' && !reduced ? { scale: 1.6, opacity: 1 } : false} animate={{ scale: 1, opacity: .55 }} />}
      <motion.button type="button" className={p.envLink} animate={{ opacity: state === 'opened' || !detail ? 0 : 1 }} disabled={state === 'spinning' || !detail} onClick={onOpened}>{t('extension.wallet.luck')}</motion.button>
    </motion.div>
    {feedback}
  </dialog>;
}

/** Where my share is: assigned and settling (pending arc), in 零钱 (drawn check), or the escrow closed before it settled. */
function ShareState({ claim, delay }: { claim: NonNullable<Detail['myClaim']>; delay: number }) {
  const t = useTranslations(), state = claim.status;
  return <Rise delay={delay} className={p.saved} data-state={state}>
    {state === 'confirmed' ? <DrawnCheck size="sm" /> : state === 'issued' ? <Pending /> : <span className={s.failGlyph}><X /></span>}
    <Swap k={state}>{t(state === 'confirmed' ? 'extension.wallet.saved' : state === 'issued' ? 'extension.wallet.settling' : 'extension.wallet.settleFailed')}</Swap>
  </Rise>;
}

/**
 * What I got rolls up from zero, then says whether it is already in 零钱; below, who got what, in the order they grabbed.
 * Coins from the envelope, when still floating, fly into the amount once the sheet has risen; it rolls as the first lands.
 */
function PacketResult({ c, detail, coins, onClose }: { c: PalsideController; detail: Detail; coins?: PacketCoins; onClose: () => void }) {
  const t = useTranslations(), locale = useLocale(), reduced = useReducedMotion(), { packet } = detail;
  const [shown, setShown] = useState('0'), [pocketing] = useState(() => !reduced && !!coins?.pending()), amountRef = useRef<HTMLSpanElement>(null);
  const mine = packet.accountId === c.data.self, claim = detail.myClaim && detail.myClaim.status !== 'failed' ? detail.myClaim : undefined, got = claim?.amount;
  const sender = personFor(c.people, packet.accountId, t('common.member'), t('common.deletedMember'));
  useEffect(() => {
    if (got === undefined) return;
    if (reduced || !coins?.pending()) { const timer = setTimeout(() => setShown(got), reduced ? 0 : 260); return () => clearTimeout(timer); }
    let live = true;
    const timer = setTimeout(() => {
      const target = amountRef.current;
      if (!target) { coins.drop(); setShown(got); return; }
      void coins.pocket(target, index => {
        if (!live) return;
        if (index === 0) setShown(got);
        target.animate([{ scale: 1 }, { scale: 1.04 }, { scale: 1 }], { duration: 160, easing: 'ease-out' });
      });
    }, 260);
    return () => { live = false; clearTimeout(timer); };
  }, [got, reduced, coins]);
  const status = packet.status === 'refunded' ? t('extension.wallet.refunded') : packet.status === 'exhausted' ? t('extension.wallet.gone') : packet.expiresAt <= c.now ? t('extension.wallet.packetExpired')
    : mine ? t('extension.wallet.closesAt', { time: deadlineTime(packet.expiresAt, localeOrEnglish(locale), c.now) }) : t(`extension.wallet.eligibility.${detail.eligibility}`);
  return <div className={`${s.page} ${s.sheetContent} ${p.result}`}>
    <IconButton size="sm" variant="quiet" className={p.close} label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>
    <div className={p.hero}>
      <span className={p.from} id="packet-detail-title"><PersonAvatar person={sender} size="xs" />{mine ? t('extension.wallet.packetMine') : t('extension.wallet.packetFrom', { name: sender.name })}</span>
      <small>{detail.blessing || t('extension.wallet.blessingPlaceholder')}</small>
      {claim && got !== undefined ? <>
        <span ref={amountRef} className={p.amount}><AnimatedAmount value={shown} minimumFractionDigits={2} /><small>PALS</small></span>
        <ShareState claim={claim} delay={reduced ? 0 : pocketing ? 1.3 : .9} />
      </> : <p className={s.note}>{detail.myClaim?.status === 'failed' ? t('extension.wallet.settleFailed') : status}</p>}
    </div>
    <section className={p.claims}>
      <header><span><CountText text={t('extension.wallet.claimedOf', { claimed: packet.claimedCount, count: packet.count })} value={packet.claimedCount} /></span><span>{groupPals(formatPals(packet.claimedAmount))}/{groupPals(formatPals(packet.amount))} PALS</span></header>
      {detail.claims.map((item, index) => <motion.div key={item.accountId ?? `deleted:${index}`} className={p.claim} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionPresets.feedback, delay: .05 * index + .2 }}>
        <PersonAvatar person={personFor(c.people, item.accountId, t('common.member'), t('common.deletedMember'))} size="sm" />
        <span className={p.claimWho}><strong>{item.accountId === c.data.self ? t('common.self') : personFor(c.people, item.accountId, t('common.member'), t('common.deletedMember')).name}</strong>
          <small>{clockTime(item.claimedAt, localeOrEnglish(locale))}{item.status === 'issued' && <> · {t('extension.wallet.settling')}</>}</small></span>
        <span><b>{groupPals(formatPals(item.amount))}</b>{item.best && <small className={p.best}><Crown />{t('extension.wallet.best')}</small>}</span>
      </motion.div>)}
    </section>
    {claim && (packet.status !== 'active' || packet.expiresAt <= c.now) && <p className={`${s.note} ${p.centered}`}>{status}</p>}
  </div>;
}

/**
 * One packet by id. A chat card hands over the detail it already shows, so the envelope or the result opens at once and
 * only refreshes behind it; a banner hands over its summary and the envelope waits on that until the detail lands.
 */
export function PacketDetail({ c, id, initial, summary, onClose }: { c: PalsideController; id: string; initial?: Detail; summary?: Packet; onClose: () => void }) {
  const t = useTranslations(), command = c.live?.command;
  const [detail, setDetail] = useState<Detail | undefined>(initial), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0), [opened, setOpened] = useState(false), [claiming, setClaiming] = useState(false);
  const chainRevision = c.live?.state.chainRevision, coins = usePacketCoins();
  const feedback = failed && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => { setFailed(false); setRevision(value => value + 1); } }}>{t('extension.wallet.unavailable')}</InlineFeedback>;
  useEffect(() => { let current = true; void command?.('wallet-packet', { id }).then(value => { if (current) { setFailed(false); setDetail(value); } }, () => { if (current) setFailed(true); }); return () => { current = false; }; }, [command, id, chainRevision, revision]);
  useEffect(() => { const at = detail?.eligibleAt; if (!at || at <= Date.now()) return; const timer = setTimeout(() => setRevision(value => value + 1), Math.min(at - Date.now() + 100, 2_147_483_647)); return () => clearTimeout(timer); }, [detail?.eligibleAt]);
  useEffect(() => {
    const at = detail?.packet.expiresAt;
    if (!at || detail.packet.status !== 'active' || at <= Date.now()) return;
    const timer = setTimeout(() => setRevision(value => value + 1), Math.min(at - Date.now() + 100, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [detail?.packet.expiresAt, detail?.packet.status]);
  // The envelope while it can still be opened (or to say why not); the sender and anyone holding a share see the result.
  const packet = detail?.packet ?? summary;
  const fresh = detail ? !detail.myClaim && (openable(detail, c.now) || detail.packet.accountId !== c.data.self) : !failed;
  // From the tap on 开 the envelope stays until its flap has lifted, though the claim's own live update already marks it claimed;
  // then it closes and the result sheet rises. One already opened shows its result sheet at once.
  const envelope = packet && !opened && (claiming || fresh);
  // The result sheet opens in the top layer after the coins did; lift them back above it.
  const { raise } = coins;
  useEffect(() => { if (opened) raise(); }, [opened, raise]);
  return <>
    {coins.node}
    {envelope ? <PacketEnvelope c={c} packet={packet} detail={detail} feedback={feedback} onClose={onClose} onBurst={coins.burst} onClaim={() => setClaiming(true)} onOpened={() => { setOpened(true); setRevision(value => value + 1); }} />
      : <Sheet open onOpenChange={open => { if (!open) onClose(); }} boundarySelector="[data-palside-app]" aria-labelledby="packet-detail-title">
        {detail ? <><PacketResult c={c} detail={detail} coins={coins} onClose={onClose} />{feedback}</>
          : <div className={`${s.page} ${s.sheetContent}`}><VisuallyHidden asChild><h2 id="packet-detail-title">{t('extension.wallet.packet')}</h2></VisuallyHidden><p className={s.empty}>{t(failed ? 'extension.wallet.unavailable' : 'extension.copy.loading')}</p>{failed && <Button onClick={() => setRevision(value => value + 1)}>{t('common.retry')}</Button>}</div>}
      </Sheet>}
  </>;
}

/** Count with − and + around it, bounded. */
function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  const t = useTranslations();
  return <span className={p.stepper}>
    <button type="button" aria-label={t('extension.wallet.countDown')} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}><Minus /></button>
    <b><Count value={value} /></b>
    <button type="button" aria-label={t('extension.wallet.countUp')} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus /></button>
  </span>;
}

/**
 * 发红包: the type on top, the three inputs as one grouped list (count, amount with its token pill, wish), and the total
 * set large in the space between the list and the button — the one number you are about to send.
 */
export function PacketPage({ c }: { c: PalsideController }) {
  const t = useTranslations(), reduced = useReducedMotion(), wallet = c.live?.state.wallet, room = c.live?.state.rooms.pinned;
  const requests = usePaymentRequest(c, JSON.stringify([c.screen, c.current, room]));
  const command = c.live?.command, kind = room ? 'room' : 'team';
  useEffect(() => { void command?.('wallet-refresh', {}).catch(() => {}); }, [command]);
  // Like a group packet: one share per member at most, the sender included; the service rejects more, so the stepper never offers them.
  const mates = Math.max(0, c.team.memberIds.length - 1), teamMax = Math.min(TEAM_MEMBER_LIMIT, c.team.memberIds.length);
  const [distribution, setDistribution] = useState<'equal' | 'random'>('random'), [picked, setCount] = useState(room ? 20 : Math.max(1, Math.min(5, teamMax)));
  const [amount, setAmount] = useState(''), [blessing, setBlessing] = useState(''), [busy, setBusy] = useState(false), [invalid, setInvalid] = useState(false);
  const max = kind === 'team' ? Math.max(1, teamMax) : CHAIN_RULES.maxPacketCount;
  const count = Math.min(max, Math.max(1, picked));
  const decimals = wallet?.config?.deployment?.decimals ?? 18, noMates = kind === 'team' && mates === 0;
  const each = kind === 'team' && distribution === 'equal';
  let total: bigint | undefined; try { total = amount ? parsePals(amount, decimals) * (each ? BigInt(count) : 1n) : undefined; } catch { total = undefined; }
  const nearest = total !== undefined && count > 0 && each ? nearestEqualPacketTotal(total, count, decimals) : total;
  const balance = wallet?.balance?.balance;
  const error = noMates ? t('extension.wallet.noTeammates') : amount && total === undefined || invalid ? t('extension.wallet.invalidAmount') : nearest !== total && nearest !== undefined ? t('extension.wallet.equalAmount', { amount: groupPals(formatPals(each ? (nearest / BigInt(count)).toString() : nearest.toString(), decimals)) }) : total !== undefined && balance !== undefined && total > BigInt(balance) ? t('extension.wallet.insufficient') : undefined;
  const usd = wallet?.price && total !== undefined && BigInt(wallet.price.denominator) > 0n ? (total * BigInt(wallet.price.numerator) * 100n / (10n ** BigInt(decimals) * BigInt(wallet.price.denominator))).toString() : undefined;
  async function review() {
    if (busy || !total || error) return;
    const request = requests.capture();
    setBusy(true); setInvalid(false);
    try { const quoted = await c.run('wallet-packet-review', { kind, scope: kind === 'room' ? room! : c.current, count, distribution: kind === 'room' ? 'random' : distribution, total: total.toString(), blessing }); if (!request.isCurrent()) { if (quoted) request.discard(quoted.id); return; } if (quoted) { setBusy(false); openPayment(quoted.id, () => { if (request.isMounted()) c.back(); }); } else setInvalid(true); }
    catch { if (request.isCurrent()) setInvalid(true); } finally { if (request.isCurrent()) setBusy(false); }
  }
  const types = room ? [] : (['random', 'equal'] as const);
  return <div className={`${s.page} ${p.form}`}>
    {types.length > 0 && <div className={s.segment} role="radiogroup" aria-label={t('extension.wallet.packetType')}>{types.map(value => {
      return <button key={value} type="button" role="radio" aria-checked={distribution === value} onClick={() => setDistribution(value)}>
        {t(value === 'random' ? 'extension.wallet.random' : 'extension.wallet.equal')}</button>;
    })}</div>}
    <motion.div className={p.rows} animate={error && !reduced ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: .36 }}>
      <div className={p.row}><span>{t('extension.wallet.count')}</span><Stepper value={count} max={max} onChange={setCount} /></div>
      <label className={p.row} data-error={error ? true : undefined}>
        <span><Swap k={String(each)}>{t(each ? 'extension.wallet.singleAmount' : 'extension.wallet.totalAmount')}</Swap></span>
        <input className={p.rowAmount} inputMode="decimal" placeholder="0" value={amount} onChange={event => { setAmount(event.target.value.replace(/[^\d.]/g, '')); setInvalid(false); }} />
        <span className={p.pill}>PALS</span>
      </label>
      <label className={p.row}><span>{t('extension.wallet.blessing')}</span><input className={p.rowText} placeholder={t('extension.wallet.blessingPlaceholder')} value={blessing} onChange={event => { if (graphemeLength(event.target.value) <= CHAIN_RULES.blessingLength) setBlessing(event.target.value); }} /></label>
    </motion.div>
    <div className={p.totalArea}>
      <span className={p.totalBig}><AnimatedAmount value={(total ?? 0n).toString()} decimals={decimals} /><small>PALS</small></span>
      <span className={p.totalSub}><Swap k={error ?? 'ok'}>{error ? <span data-error>{error}</span>
        : <>{usd !== undefined && <><AnimatedAmount value={usd} decimals={2} prefix="≈ $" minimumFractionDigits={2} maximumFractionDigits={2} /><span className={p.dot}>·</span></>}{balance !== undefined && t('extension.wallet.available', { amount: groupPals(formatPals(balance)) })}</>}</Swap></span>
    </div>
    <div className={`${s.bottom} ${p.submit}`}><Button variant="primary" size="lg" loading={busy} disabled={!wallet?.config?.enabled || !total || Boolean(error)} onClick={() => void review()}>{t('extension.wallet.createPacket')}</Button></div>
  </div>;
}

/**
 * The live packets of a room, as one banner above the lines: who sent it, how many are left and one button whose state says
 * everything. Several at once: the envelope becomes a small stack and a 1/3 pager steps through them.
 */
export function RoomPacketBanner({ c, packets }: { c: PalsideController; packets: Packet[] }) {
  const t = useTranslations(), reduced = useReducedMotion();
  const [index, setIndex] = useState(0), [selected, setSelected] = useState<string>(), [details, setDetails] = useState<Record<string, Detail>>({});
  // My own packet still on its way stands with the live ones: it says so, and offers nothing to grab yet.
  const live = packets.filter(packet => packet.status === 'active' && packet.expiresAt > c.now || packet.status === 'pending' && packet.accountId === c.data.self);
  // Fetched while the banner is on screen, so tapping 抢 opens the envelope with its wish and seal ready.
  const command = c.live?.command, liveKey = live.map(packet => `${packet.id}:${packet.claimedCount}`).join();
  useEffect(() => {
    let current = true;
    for (const packet of live) void command?.('wallet-packet', { id: packet.id }).then(value => { if (current) setDetails(previous => ({ ...previous, [packet.id]: value })); }, () => {});
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, liveKey]);
  const list = live.length ? live : packets;
  const current = list[Math.min(index, list.length - 1)];
  if (!current) return null;
  const mine = current.accountId === c.data.self, left = current.count - current.claimedCount, sending = current.status === 'pending';
  const picked = list.find(packet => packet.id === selected);
  const sender = personFor(c.people, current.accountId, t('common.member'), t('common.deletedMember'));
  return <>
    <motion.div className={p.banner} initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} transition={reduced ? motionPresets.reduced : motionPresets.expand}>
      <div className={p.bannerIn} data-state={left === 0 ? 'gone' : undefined}>
        <span className={p.stack} data-many={list.length > 1 || undefined}><Envelope size="sm" /></span>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={current.id} className={p.bannerText} initial={{ opacity: 0, x: reduced ? 0 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -24 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            <strong>{mine ? t('extension.wallet.packetMine') : t('extension.wallet.packetFrom', { name: sender.name })}</strong>
            <small><Swap k={sending ? 'sending' : left === 0 ? 'gone' : 'left'}><span>{sending ? <span className={p.sending}><Pending />{t('extension.copy.sending')}</span> : left === 0 ? t('extension.wallet.gone') : <CountText text={t('extension.wallet.leftOf', { left, count: current.count })} value={left} />}</span></Swap></small>
          </motion.span>
        </AnimatePresence>
        {list.length > 1 && <button type="button" className={p.pager} onClick={() => setIndex((index + 1) % list.length)}><Count value={index + 1} />/{list.length}</button>}
        {sending ? null : left > 0 && !mine
          ? <motion.button type="button" className={p.grab} whileTap={reduced ? undefined : { scale: .92 }} onClick={() => setSelected(current.id)}>{t('extension.wallet.grab')}</motion.button>
          : <button type="button" className={p.luck} onClick={() => setSelected(current.id)}>{t('extension.wallet.luckShort')}</button>}
      </div>
    </motion.div>
    {selected && <PacketDetail c={c} id={selected} initial={details[selected]} summary={picked} onClose={() => setSelected(undefined)} />}
  </>;
}
