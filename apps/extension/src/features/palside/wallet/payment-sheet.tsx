'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, X } from 'lucide-react';
import { errorMessage } from '@palside/i18n';
import { shortAddress } from '@palside/shared/navigation';
import { Button, IconButton } from '@palside/ui/button';
import { PinInput } from '@palside/ui/field';
import { Sheet } from '@palside/ui/sheet';
import { parsePals, terminalPayment, type PaymentPhase, type WalletPayment } from '../../../domain/wallet/model';
import { personFor, type Person } from '../../../domain/account/model';
import type { Viewing } from '../../../domain/assets/model';
import { roomPerson } from '../rooms/rooms';
import type { PalsideController } from '../app/use-palside';
import { useText } from '../ui/text';
import { PersonAvatar, Token } from '../ui/primitives';
import { Dots, DrawnCheck, Fit, Rise, Step, Swap } from '../ui/motion-details';
import { PalsAmount, formatPals } from './amount';
import { recordLabels } from './recovery-state';
import s from './payment.module.css';

export const PALS = { id: 'pals', name: 'PALS', kind: 'asset', url: '', color: '#f2ffcc', logo: '/brand/palside.svg' } as Viewing;

/**
 * One sheet carries every payment, from wherever it starts: a transfer begins with who and how much; tips, packets,
 * claims and recoveries arrive already quoted. The flow then reads 确认 → 进行中 → 完成 in place, never leaving the screen.
 */
type SheetState = { open: false; session: number } | { open: true; accountId: string; session: number; mode: 'transfer' | 'payment'; recipientId?: string; owned?: string; onDone?: () => void };
let current: SheetState = { open: false, session: 0 };
let paymentSession: { accountId: string } | undefined;
const listeners = new Set<() => void>();
function update(next: SheetState) { current = next; for (const listener of listeners) listener(); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function useSheetState() { return useSyncExternalStore(subscribe, () => current, () => current); }
/** Presentation belongs to the mounted account session; runtime payments settle independently. */
export function usePaymentSession(accountId: string | undefined) {
  useLayoutEffect(() => {
    const owner = accountId ? { accountId } : undefined;
    paymentSession = owner;
    update({ open: false, session: current.session + 1 });
    return () => {
      if (paymentSession !== owner) return;
      paymentSession = undefined;
      update({ open: false, session: current.session + 1 });
    };
  }, [accountId]);
}
/** Starts a transfer; with a recipient the sheet opens on the amount for that teammate. */
export function openTransfer(recipientId?: string) { if (paymentSession) update({ open: true, accountId: paymentSession.accountId, session: current.session + 1, mode: 'transfer', recipientId }); }
/** Shows the payment the wallet already holds (quoted, settling or finished); `onDone` runs once it is confirmed and closed. */
export function openPayment(paymentId: string, onDone?: () => void) { if (paymentSession) update({ open: true, accountId: paymentSession.accountId, session: current.session + 1, mode: 'payment', owned: paymentId, onDone }); }
function own(paymentId: string | undefined, sheet: SheetState) { if (current.open && current === sheet) update({ ...current, owned: paymentId }); }

/** Async reviews may update only their initiating account, view and sheet opening. */
export function usePaymentRequest(c: PalsideController, context: string) {
  const lifetime = useRef<object | undefined>(undefined);
  const accountId = c.live?.state.account?.id;
  useLayoutEffect(() => { lifetime.current = {}; return () => { lifetime.current = undefined; }; }, [accountId, context]);
  return {
    cancel: () => { lifetime.current = undefined; },
    capture: () => {
      const mounted = lifetime.current, owner = paymentSession, session = current.session;
      const isMounted = () => !!mounted && lifetime.current === mounted && !!owner && paymentSession === owner && owner.accountId === accountId;
      return {
        isMounted,
        isCurrent: () => isMounted() && current.session === session,
        discard: (paymentId: string) => { if (accountId) void c.live?.command('wallet-dismiss', { accountId, paymentId }).catch(() => {}); },
      };
    },
  };
}

type FlowStep = 'compose' | 'confirm' | 'busy' | 'done' | 'failed';
const stepOf = (phase: PaymentPhase): FlowStep => phase === 'review' || phase === 'password' ? 'confirm' : phase === 'confirmed' ? 'done' : phase === 'failed' || phase === 'expired' ? 'failed' : 'busy';
const ORDER: Record<FlowStep, number> = { compose: 0, confirm: 1, busy: 2, done: 3, failed: 3 };

export function PaymentSheet({ c }: { c: PalsideController }) {
  const sheet = useSheetState(), payment = c.live?.state.wallet?.payment;
  const visible = sheet.open && sheet.accountId === c.live?.state.account?.id && c.live.state.authenticated;
  const owned = visible && sheet.owned && payment?.id === sheet.owned ? payment : undefined;
  // A payment-mode sheet whose payment is gone (dismissed elsewhere, account changed) has nothing left to show.
  useEffect(() => { if (current === sheet && sheet.open && sheet.mode === 'payment' && !owned) update({ open: false, session: sheet.session }); }, [sheet, owned]);
  function close() {
    if (!sheet.open || current !== sheet) return;
    // Nothing is signed before 付款, so leaving a quote discards it; a payment already on its way keeps settling on its own.
    if (owned && (terminalPayment(owned.phase) || owned.phase === 'review' || owned.phase === 'password')) void c.run('wallet-dismiss', { accountId: sheet.accountId, paymentId: owned.id });
    update({ open: false, session: sheet.session + 1 });
    if (owned?.phase === 'confirmed') sheet.onDone?.();
  }
  return <Sheet open={Boolean(visible)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="payment-title" className={s.sheet}>
    {visible && <PaymentFlow key={sheet.session} c={c} sheet={sheet} mode={sheet.mode} initialRecipient={sheet.recipientId} payment={owned} onClose={close} />}
  </Sheet>;
}

function PaymentFlow({ c, sheet, mode, initialRecipient, payment, onClose }: { c: PalsideController; sheet: Extract<SheetState, { open: true }>; mode: 'transfer' | 'payment'; initialRecipient?: string; payment?: WalletPayment; onClose: () => void }) {
  const t = useTranslations();
  const step: FlowStep = payment ? stepOf(payment.phase) : 'compose';
  const [seen, setSeen] = useState({ step, dir: 1 });
  if (seen.step !== step) setSeen({ step, dir: ORDER[step] < ORDER[seen.step] ? -1 : 1 });
  const [draft, setDraft] = useState<Draft>({ to: 'mate', recipient: initialRecipient ?? '', address: '', amount: '' });
  const back = mode === 'transfer' && step === 'confirm' ? () => { own(undefined, sheet); if (payment) void c.run('wallet-dismiss', { accountId: sheet.accountId, paymentId: payment.id }); }
    : mode === 'transfer' && step === 'compose' && !initialRecipient && draft.to === 'mate' && draft.recipient ? () => setDraft(value => ({ ...value, recipient: '' })) : undefined;
  const title = step === 'compose' ? t('extension.wallet.transfer') : payment ? t(titleKey(payment, step)) : '';
  return <>
    <header className={s.head}>
      {back ? <IconButton size="sm" variant="quiet" label={t('common.back')} onClick={back}><ArrowLeft size={18} /></IconButton> : <span />}
      <h2 id="payment-title" role="status"><Swap k={title}>{title}</Swap></h2>
      <IconButton size="sm" variant="quiet" label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>
    </header>
    <Fit><Step k={step} dir={seen.dir} className={s.step}>
      {step === 'compose' && <Compose c={c} sheet={sheet} draft={draft} setDraft={setDraft} fixed={Boolean(initialRecipient)} />}
      {payment && step !== 'compose' && <Settle c={c} payment={payment} step={step} onClose={onClose} onRestart={mode === 'transfer' ? () => { own(undefined, sheet); if (payment) void c.run('wallet-dismiss', { accountId: sheet.accountId, paymentId: payment.id }); } : undefined} />}
    </Step></Fit>
  </>;
}
function titleKey(payment: WalletPayment, step: FlowStep) {
  if (step === 'done') return 'extension.wallet.confirmed';
  if (step === 'failed') return payment.phase === 'expired' ? 'extension.wallet.expired' : 'extension.wallet.failedTitle';
  // While it settles the title names the payment; the line under the hero carries the progress.
  if (step === 'busy') return recordLabels[payment.order.kind];
  return ({ transfer: 'extension.wallet.confirmTransfer', tip: 'extension.wallet.confirmTip', packet: 'extension.wallet.confirmPacket' } as const)[payment.order.kind];
}

type Draft = { to: 'mate' | 'address'; recipient: string; address: string; amount: string };

/** 转账: who (a teammate, or any address), then the amount, large. The balance is fetched again as the sheet opens. */
function Compose({ c, sheet, draft, setDraft, fixed }: { c: PalsideController; sheet: SheetState; draft: Draft; setDraft: (update: (value: Draft) => Draft) => void; fixed: boolean }) {
  const t = useTranslations(), text = useText(), wallet = c.live?.state.wallet, command = c.live?.command;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requests = usePaymentRequest(c, String(sheet.session));
  useEffect(() => { void command?.('wallet-refresh', {}).catch(() => {}); }, [command]);
  const mates = c.people.filter(person => person.id !== c.data.self && c.team.memberIds.includes(person.id));
  const decimals = wallet?.config?.deployment?.decimals ?? 18, balance = wallet?.balance?.balance;
  let value: bigint | undefined; try { value = draft.amount ? parsePals(draft.amount, decimals) : undefined; } catch { value = undefined; }
  const amountError = draft.amount && (value === undefined || value <= 0n) ? t('extension.wallet.invalidAmount') : value !== undefined && balance !== undefined && value > BigInt(balance) ? t('extension.wallet.insufficient') : undefined;
  const person = draft.to === 'mate' && draft.recipient ? personFor(c.people, draft.recipient, t('common.member')) : undefined;
  const target = draft.to === 'mate' ? draft.recipient : draft.address;
  const set = (patch: Partial<Draft>) => { setError(''); setDraft(value => ({ ...value, ...patch })); };
  async function next() {
    if (!wallet || busy || value === undefined || value <= 0n || amountError) return;
    const request = requests.capture();
    setBusy(true); setError('');
    try {
      const input = draft.to === 'address' ? { kind: 'transfer' as const, recipient: draft.address, amount: value.toString() } : { kind: 'transfer' as const, teamId: c.current, recipientId: draft.recipient, amount: value.toString() };
      const quoted = await command?.('wallet-review', { input });
      if (quoted) { if (request.isCurrent()) own(quoted.id, sheet); else request.discard(quoted.id); }
    } catch (failure) { if (request.isCurrent()) setError(text(errorMessage(failure))); }
    finally { if (request.isCurrent()) setBusy(false); }
  }
  if (draft.to === 'mate' && !draft.recipient) return <>
    <Segment value={draft.to} onChange={to => set({ to })} />
    {mates.length ? <div className={s.list}>{mates.map(mate => <button key={mate.id} type="button" className={s.line} onClick={() => set({ recipient: mate.id })}>
      <PersonAvatar person={mate} size="sm" /><span className={s.lineText}><strong>{mate.name}</strong>{mate.walletAddress && <small className={s.mono}>{shortAddress(mate.walletAddress)}</small>}</span>
    </button>)}</div> : <p className={s.empty}>{t('extension.wallet.noTeammates')}</p>}
  </>;
  return <>
    {!fixed && <Segment value={draft.to} onChange={to => set({ to })} />}
    {person ? <div className={s.recipient}><PersonAvatar person={person} size="md" /><span className={s.lineText}><strong>{person.name}</strong><small>{person.walletAddress ? <span className={s.mono}>{shortAddress(person.walletAddress)}</span> : c.team.name}</small></span></div>
      : <label className={s.addressField}><span>{t('extension.wallet.externalAddress')}</span><input autoComplete="off" spellCheck={false} value={draft.address} onChange={event => set({ address: event.target.value.trim() })} placeholder="0x" autoFocus data-autofocus /></label>}
    <AmountBox c={c} value={draft.amount} onChange={amount => set({ amount })} error={error || amountError} autoFocus={Boolean(person)} />
    <Button className={s.primary} variant="primary" size="lg" loading={busy} disabled={!target || !draft.amount || Boolean(amountError) || wallet?.availability !== 'ready'} onClick={() => void next()}>{t('extension.wallet.next')}</Button>
  </>;
}
function Segment({ value, onChange }: { value: Draft['to']; onChange: (value: Draft['to']) => void }) {
  const t = useTranslations();
  return <div className={s.segment} role="radiogroup" aria-label={t('extension.wallet.recipient')}>{(['mate', 'address'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}>{t(option === 'mate' ? 'extension.room.mate' : 'extension.wallet.toAddress')}</button>)}</div>;
}

/** The amount, large, with the token beside it; below, what it is worth and what is available. It shakes on an error. */
function AmountBox({ c, value, onChange, error, autoFocus }: { c: PalsideController; value: string; onChange: (value: string) => void; error?: string; autoFocus?: boolean }) {
  const t = useTranslations(), reduced = useReducedMotion(), wallet = c.live?.state.wallet, balance = wallet?.balance?.balance;
  return <motion.div className={s.amountBox} data-error={error ? true : undefined} animate={error && !reduced ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: .36 }}>
    <label className={s.amountTop}>
      <input className={s.amountField} inputMode="decimal" placeholder="0" aria-label={t('extension.wallet.amount')} value={value} onChange={event => onChange(event.target.value.replace(/[^\d.]/g, ''))} autoFocus={autoFocus} data-autofocus={autoFocus || undefined} />
      <span className={s.unit}><Token view={PALS} size="sm" />PALS</span>
    </label>
    <div className={s.amountFoot}>
      <Swap k={error ?? 'ok'}><span data-error={error ? true : undefined}>{error ?? (value && wallet?.price ? <UsdValue c={c} value={value} /> : ' ')}</span></Swap>
      {balance !== undefined && <span className={s.available}>{t('extension.wallet.available', { amount: formatPals(balance) })}<button type="button" className={s.max} onClick={() => onChange(formatPals(balance))}>{t('extension.wallet.max')}</button></span>}
    </div>
  </motion.div>;
}
function UsdValue({ c, value }: { c: PalsideController; value: string }) {
  const price = c.live?.state.wallet?.price, decimals = c.live?.state.wallet?.config?.deployment?.decimals ?? 18;
  let amount: bigint; try { amount = parsePals(value, decimals); } catch { return <>{' '}</>; }
  if (!price || BigInt(price.denominator) <= 0n) return <>{' '}</>;
  const cents = amount * BigInt(price.numerator) * 100n / (10n ** BigInt(decimals) * BigInt(price.denominator));
  return <>≈ ${(cents / 100n).toLocaleString('en-US')}.{(cents % 100n).toString().padStart(2, '0')}</>;
}

/** Who a payment goes to, as the hero shows it: a person, or an address behind a wallet glyph. */
function usePayee(c: PalsideController, payment: WalletPayment): { person?: Person; line: string; done: string } {
  const t = useTranslations(), input = payment.input;
  const tipLine = input.kind === 'tip' ? c.live?.state.rooms.current?.messages.find(item => item.id === input.messageId) : undefined;
  if (tipLine) { const person = roomPerson(c, tipLine.author, t('common.member')); return { person, line: t('extension.wallet.tipTo', { name: person.name }), done: t('extension.wallet.tippedTo', { name: person.name }) }; }
  if (input.kind === 'transfer' && 'recipientId' in input) { const person = personFor(c.people, input.recipientId, t('common.member')); return { person, line: t('extension.wallet.transferTo', { name: person.name }), done: t('extension.wallet.sentTo', { name: person.name }) }; }
  if (input.kind === 'transfer') return { line: t('extension.wallet.transferToAddress', { address: shortAddress(input.recipient) }), done: t('extension.wallet.sentToAddress', { address: shortAddress(input.recipient) }) };
  // A tip whose line has since left the room still names what it is.
  if (input.kind === 'tip') return { line: t('extension.wallet.tip'), done: t('extension.wallet.tip') };
  return { line: t('extension.wallet.packetShares', { count: input.packet.count }), done: t('extension.wallet.packetSent') };
}

function Settle({ c, payment, step, onClose, onRestart }: { c: PalsideController; payment: WalletPayment; step: FlowStep; onClose: () => void; onRestart?: () => void }) {
  const t = useTranslations(), text = useText(), reduced = useReducedMotion();
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const payee = usePayee(c, payment), input = payment.input;
  const needsPin = payment.phase === 'password' || payment.passwordRequired;
  const submitted = useRef('');
  async function pay(pin?: string) {
    if (busy) return; setBusy(true);
    try { await c.live?.command('wallet-confirm', { accountId: payment.order.accountId, paymentId: payment.id, password: pin || undefined }); } catch { /* The payment carries its own error and shakes the cells. */ }
    finally { setPassword(''); setBusy(false); }
  }
  // Six digits pay at once, as a payment pad does; with a PIN there is no 付款 button to press as well.
  useEffect(() => { if (password.length === 6 && submitted.current !== password && !busy) { submitted.current = password; void pay(password); } if (password.length < 6) submitted.current = ''; });
  // A known cause is named (wrong PIN, balance, expiry); anything else stays the general line.
  const failure = payment.error ? errorMessage({ code: payment.error }) : undefined;
  const failureText = failure && failure.key !== 'common.error' ? text(failure) : t('extension.wallet.failed');
  const hero = (muted = false) => <div className={s.hero} data-muted={muted || undefined}>
    {payee.person ? <span className={s.party}><PersonAvatar person={payee.person} size="xl" /><span className={s.badge}><Token view={PALS} size="sm" /></span></span> : <Token view={PALS} size="lg" />}
    <span className={s.heroAmount}><PalsAmount value={payment.order.amount} /></span>
    <small>{payee.line}</small>
  </div>;
  if (step === 'confirm') return <>
    {hero()}
    <dl className={s.facts}>
      {input.kind === 'transfer' && 'recipient' in input && <div data-stack><dt>{t('extension.wallet.externalAddress')}</dt><dd className={s.mono}>{payment.order.recipient}</dd></div>}
      <div><dt>{t('extension.wallet.gas')}</dt><dd>{t('extension.wallet.sponsored')}</dd></div>
    </dl>
    {needsPin ? <div className={s.pin}>
      <span>{t('extension.wallet.password')}</span>
      <motion.div key={payment.error ?? 'pin'} animate={payment.error && !reduced ? { x: [0, -10, 10, -6, 6, -2, 0] } : { x: 0 }} transition={{ duration: .42 }}>
        <PinInput outlined aria-label={t('extension.wallet.password')} value={password} onValueChange={setPassword} autoComplete="off" autoFocus data-autofocus disabled={busy} />
      </motion.div>
      <p className={s.error} role="alert" data-busy={busy || undefined}><Swap k={busy ? 'busy' : payment.error ?? 'ok'}>{busy ? <Dots /> : payment.error ? failureText : ' '}</Swap></p>
    </div> : <div className={s.foot}>
      <Swap k={payment.error ?? 'ok'}><p className={s.error} role="alert">{payment.error ? failureText : ' '}</p></Swap>
      <Button className={s.primary} variant="primary" size="lg" loading={busy} onClick={() => void pay()}>{t('extension.wallet.pay')}</Button>
    </div>}
  </>;
  if (step === 'busy') return <>
    {hero()}
    <Stages at={STAGES.indexOf(payment.phase as typeof STAGES[number])} labels={[t('extension.wallet.stageSign'), t('extension.wallet.stageSend'), t('extension.wallet.stageConfirm')]} />
    <div className={s.foot}><Button className={s.primary} variant="quiet" loading={checking} onClick={() => { setChecking(true); void c.run('wallet-reconcile', {}).finally(() => setChecking(false)); }}>{t('extension.wallet.checkStatus')}</Button></div>
  </>;
  if (step === 'done') return <>
    <div className={s.hero}>
      <DrawnCheck />
      <Rise delay={reduced ? 0 : .32} className={s.heroAmount}><PalsAmount value={payment.order.amount} /></Rise>
      <Rise delay={reduced ? 0 : .4}><small>{payee.done}</small></Rise>
    </div>
    <Rise delay={reduced ? 0 : .52} className={s.foot}><Button className={s.primary} variant="primary" size="lg" onClick={onClose}>{t('extension.capture.done')}</Button></Rise>
  </>;
  return <>
    {hero(true)}
    <p className={s.error} role="alert" data-center>{payment.phase === 'expired' ? t('extension.errors.ORDER_EXPIRED') : failureText}</p>
    <div className={s.foot}>
      {onRestart && <Button className={s.primary} variant="primary" size="lg" onClick={onRestart}>{t('extension.wallet.again')}</Button>}
      <Button className={s.primary} size="lg" onClick={onClose}>{t('common.close')}</Button>
    </div>
  </>;
}

const STAGES = ['signing', 'submitting', 'pending'] as const;
/** 签名 → 发送 → 确认 on one track: passed stages are checked, the current one breathes, the line fills behind it. */
function Stages({ at, labels }: { at: number; labels: string[] }) {
  const reduced = useReducedMotion(), current = Math.max(0, at);
  return <ol className={s.stages} aria-label={labels[current]}>
    <motion.span className={s.stageFill} aria-hidden="true" initial={false} animate={{ scaleX: current / (labels.length - 1) }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 34 }} />
    {labels.map((label, index) => <li key={label} data-state={index < current ? 'done' : index === current ? 'current' : undefined} aria-current={index === current ? 'step' : undefined}>
      <span className={s.stageNode}>{index < current ? <DrawnCheck size="sm" /> : index === current ? <Dots /> : null}</span>
      <span>{label}</span>
    </li>)}
  </ol>;
}
