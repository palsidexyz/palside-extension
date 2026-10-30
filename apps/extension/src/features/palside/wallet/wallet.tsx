'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, ChevronRight, Copy, Eye, EyeOff, History, Settings, Wallet, X } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Input, PinInput } from '@palside/ui/field';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { QRCodeSVG } from 'qrcode.react';
import { SettingGroup, SettingItem } from '../settings/setting-rows';
import type { PalsideController } from '../app/use-palside';
import { Token } from '../ui/primitives';
import { Dots, Swap } from '../ui/motion-details';
import { PalsAmount } from './amount';
import type { ChainRecord } from '@palside/shared/contracts/chain';
import { Sheet } from '@palside/ui/sheet';
import { shortAddress } from '@palside/shared/navigation';
import { PALS, openPayment, openTransfer } from './payment-sheet';
import { PacketDetail } from './packet';
import type { ApiResult } from '../../../runtime/transport/api';
import { WalletRecoveryList } from './recovery';
import { recordLabels } from './recovery-state';
import { EmptyState } from '../chat/history-scope';
import s from './wallet.module.css';


/** Copy feedback follows the latest clipboard result. */
function useCopied(c: PalsideController): [boolean, (value: string) => void, string | undefined] {
  const [copied, setCopied] = useState(false), [failedValue, setFailedValue] = useState<string>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined), attemptRef = useRef(0);
  useEffect(() => () => { attemptRef.current++; clearTimeout(timerRef.current); }, []);
  return [copied, value => {
    const attempt = ++attemptRef.current;
    clearTimeout(timerRef.current); setCopied(false); setFailedValue(undefined);
    void c.copy(value).then(success => {
      if (attempt !== attemptRef.current) return;
      if (!success) { setFailedValue(value); return; }
      setCopied(true); timerRef.current = setTimeout(() => setCopied(false), 1400);
    });
  }, failedValue];
}
function ManualCopy({ value }: { value: string | undefined }) {
  const t = useTranslations();
  return value === undefined ? null : <Input aria-label={t('extension.copy.copyManual')} readOnly value={value} onFocus={event => event.currentTarget.select()} />;
}
function AddressChip({ c, address }: { c: PalsideController; address: string }) {
  const t = useTranslations(), [copied, copy, failedValue] = useCopied(c);
  return <><button type="button" className={s.addressChip} data-copied={copied || undefined} title={address} aria-label={t('extension.wallet.copyAddress')} onClick={() => copy(address)}>
    {shortAddress(address)}<Swap k={copied ? 'ok' : 'copy'}>{copied ? <Check /> : <Copy />}</Swap>
  </button><ManualCopy value={failedValue} /></>;
}

export function WalletHome({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live?.state.wallet, command = c.live?.command;
  useEffect(() => { void command?.('wallet-refresh', {}).catch(() => {}); }, [command]);
  const loading = Boolean(c.live) && (!wallet || wallet.availability === 'loading');
  // Loading never sits there for good: past a few seconds it says the wallet is unavailable and offers another try.
  const [stalled, setStalled] = useState(false), [attempt, setAttempt] = useState(0);
  const retry = () => { setStalled(false); setAttempt(value => value + 1); void c.run('wallet-refresh', {}); };
  useEffect(() => { if (!loading) return; const timer = setTimeout(() => setStalled(true), 6000); return () => { clearTimeout(timer); setStalled(false); }; }, [loading, attempt]);
  if (!c.live) return <div className={s.empty}><Wallet /><p>{t('extension.wallet.soon')}</p></div>;
  if (loading && stalled) return <div className={s.empty}><Wallet /><p>{t('extension.wallet.unavailable')}</p><Button onClick={retry}>{t('common.retry')}</Button></div>;
  if (!wallet || wallet.availability === 'loading') return <p className={s.empty}>{t('extension.copy.loading')}</p>;
  if (wallet.availability === 'locked') return <><WalletUnlock c={c} /><WalletRecoveryList c={c} /></>;
  const hidden = wallet.preferences.hideAmounts, ready = wallet.availability === 'ready';
  const pending = wallet.payment && !['confirmed', 'expired', 'failed'].includes(wallet.payment.phase) && <button type="button" className={s.pendingRow} onClick={() => openPayment(wallet.payment!.id)}><Dots /><span>{t('extension.wallet.pending')}</span><ChevronRight size={16} /></button>;
  // Closed, the page holds only what is still settling; once that resolves there is nothing left to show.
  if (wallet.availability === 'closed') return pending || wallet.recovery?.items.length ? <div className={s.page}>{pending}<WalletRecoveryList c={c} /></div> : <div className={s.empty}><Wallet /><p>{t('extension.wallet.closed')}</p></div>;
  return <div className={s.page}>
    <div className={s.balance}>
      <IconButton size="sm" variant="quiet" className={s.icon} label={t(hidden ? 'extension.wallet.show' : 'extension.wallet.hide')} onClick={() => void c.run('wallet-preferences', { hideAmounts: !hidden })}><Swap k={String(hidden)}>{hidden ? <Eye size={18} /> : <EyeOff size={18} />}</Swap></IconButton>
      <Token view={PALS} size="lg" />
      <span>{t('extension.wallet.balance')}</span>
      <strong><Swap k={String(hidden)}><PalsAmount value={wallet.balance?.balance} hidden={hidden} price={wallet.price} /></Swap></strong>
      <AddressChip c={c} address={wallet.address} />
    </div>
    {wallet.availability === 'offline' && <div className={s.error} role="status">{t('extension.wallet.offline')}<Button size="sm" onClick={retry}>{t('common.retry')}</Button></div>}
    {wallet.openedNotice && <Button className={s.opened} onClick={() => void c.run('wallet-opened-ack', {})}>{t('extension.wallet.opened')}</Button>}
    <div className={s.tiles}>
      <button type="button" className={s.tile} onClick={() => c.go('wallet-receive')}><ArrowDownLeft /><span>{t('extension.wallet.receive')}</span></button>
      <button type="button" className={s.tile} disabled={!ready} onClick={() => openTransfer()}><ArrowLeftRight /><span>{t('extension.wallet.transfer')}</span></button>
    </div>
    <SettingGroup><SettingItem title={t('extension.wallet.records')} icon={<History size={16} />} onClick={() => c.go('wallet-records')} /><SettingItem title={t('extension.wallet.settings')} icon={<Settings size={16} />} onClick={() => c.go('wallet-settings')} /></SettingGroup>
    {pending}
    <WalletRecoveryList c={c} />
  </div>;
}
function WalletUnlock({ c }: { c: PalsideController }) {
  const t = useTranslations(), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  return <div className={s.page}><h2>{t('extension.wallet.password')}</h2><PinInput outlined value={password} onValueChange={setPassword} aria-label={t('extension.wallet.password')} autoComplete="off" /><Button variant="primary" loading={busy} disabled={password.length !== 6} onClick={() => { if (busy) return; setBusy(true); void c.run('wallet-unlock', { password }).finally(() => { setPassword(''); setBusy(false); }); }}>{t('common.confirm')}</Button></div>;
}
export function WalletReceive({ c }: { c: PalsideController }) {
  const t = useTranslations(), command = c.live?.command, address = c.live?.state.wallet?.address;
  const [uri, setUri] = useState(''), [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [copied, copy, failedValue] = useCopied(c);
  const reduced = useReducedMotion();
  useEffect(() => { let current = true; void command?.('wallet-receive', {}).then(value => { if (current) setUri(value.uri); }, () => { if (current) setError(true); }); return () => { current = false; }; }, [command, attempt]);
  return <div className={s.receive}>
    <h2>{t('extension.wallet.receive')}</h2>
    <div className={s.qrCard}>
      {uri && <motion.div className={s.qr} initial={reduced ? false : { opacity: 0, scale: .96, filter: 'blur(3px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}><QRCodeSVG value={uri} size={216} level="H" marginSize={2} imageSettings={{ src: '/brand/palside.svg', width: 40, height: 40, excavate: true }} /></motion.div>}
      <span className={s.chainChip}>{t('extension.wallet.onlyChain')}</span>
      <p className={s.fullAddress}>{address}</p>
    </div>
    {error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: () => { setError(false); setAttempt(value => value + 1); } }}>{t('extension.wallet.unavailable')}</InlineFeedback>}
    <Button variant="primary" disabled={!address} leadingIcon={<Swap k={copied ? 'ok' : 'copy'}>{copied ? <Check size={16} /> : <Copy size={16} />}</Swap>} onClick={() => address && copy(address)}><Swap k={copied ? 'ok' : 'copy'}>{t(copied ? 'extension.copy.copied' : 'extension.wallet.copyAddress')}</Swap></Button>
    <ManualCopy value={failedValue} />
  </div>;
}

function RecordDetail({ c, record, onClose }: { c: PalsideController; record: ChainRecord; onClose: () => void }) {
  const t = useTranslations(), [packet, setPacket] = useState(false), [copied, copy, failedValue] = useCopied(c), command = c.live?.command, packetId = record.packetId;
  // The packet is read while this sheet is up, so 红包 opens on its content; a failed read still opens and offers retry there.
  const [detail, setDetail] = useState<ApiResult<'chain.packet'> | null>();
  useEffect(() => { if (!packetId) return; let current = true; void command?.('wallet-packet', { id: packetId }).then(value => { if (current) setDetail(value); }, () => { if (current) setDetail(null); }); return () => { current = false; }; }, [command, packetId]);
  const incoming = record.to.toLowerCase() === c.live?.state.wallet?.address.toLowerCase();
  if (packet && packetId && detail !== undefined) return <PacketDetail c={c} id={packetId} initial={detail ?? undefined} onClose={() => setPacket(false)} />;
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }} boundarySelector="[data-palside-app]" aria-labelledby="record-title"><div className={`${s.page} ${s.sheetContent} ${s.detail}`}>
    <IconButton size="sm" variant="quiet" className={s.close} label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>
    <h2 id="record-title">{t(recordLabels[record.kind])}</h2>
    <div className={s.hero}><span className={s.heroAmount} data-incoming={incoming || undefined}>{incoming ? '+' : '−'}<PalsAmount value={record.amount} /></span><small className={s.ok}>{t('extension.wallet.confirmed')}</small></div>
    <dl className={s.facts}>
      <div><dt>{t('extension.wallet.payer')}</dt><dd className={s.mono}>{record.from}</dd></div>
      <div><dt>{t('extension.wallet.recipient')}</dt><dd className={s.mono}>{record.to}</dd></div>
      <div><dt>{t('extension.wallet.time')}</dt><dd>{new Date(record.occurredAt).toLocaleString()}</dd></div>
      <div><dt>{t('extension.wallet.transaction')}</dt><dd className={s.mono}>{record.transactionHash}<button type="button" className={s.copyMini} aria-label={t('extension.copy.copy')} data-copied={copied || undefined} onClick={() => copy(record.transactionHash)}><Swap k={copied ? 'ok' : 'copy'}>{copied ? <Check /> : <Copy />}</Swap></button></dd></div>
    </dl>
    <ManualCopy value={failedValue} />
    {packetId && <Button loading={packet && detail === undefined} onClick={() => setPacket(true)}>{t('extension.wallet.packet')}</Button>}
  </div></Sheet>;
}

export function WalletRecords({ c }: { c: PalsideController }) {
  const t = useTranslations(), wallet = c.live?.state.wallet, command = c.live?.command, reduced = useReducedMotion();
  const [selected, setSelected] = useState<ChainRecord>();
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all'), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; void command?.('wallet-records', { direction }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setBusy(false); }); return () => { current = false; }; }, [command, direction, revision]);
  const hidden = wallet?.preferences.hideAmounts;
  return <div className={s.page}>
    <div className={s.segment}>{(['all', 'in', 'out'] as const).map(value => <button key={value} aria-pressed={direction === value} onClick={() => { if (value !== direction) { setBusy(true); setFailed(false); setDirection(value); } }}>{t(value === 'in' ? 'extension.wallet.incoming' : value === 'out' ? 'extension.wallet.outgoing' : 'extension.hot.all')}</button>)}</div>
    {wallet?.records.items.length ? <div className={s.lines}>{wallet.records.items.map((record, index) => {
      const incoming = record.to.toLowerCase() === wallet.address.toLowerCase();
      return <motion.button key={record.id} type="button" className={s.line} onClick={() => setSelected(record)}
        initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: [.22, 1, .36, 1], delay: Math.min(index, 8) * .04 }}>
        <span className={s.glyph}>{incoming ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
        <span className={s.lineText}><strong>{t(recordLabels[record.kind])} · {t(incoming ? 'extension.wallet.incoming' : 'extension.wallet.outgoing')}</strong><small>{new Date(record.occurredAt).toLocaleString()}</small></span>
        <span className={s.lineEnd} data-incoming={incoming || undefined}>{!hidden && (incoming ? '+' : '−')}<PalsAmount value={record.amount} hidden={hidden} /></span>
      </motion.button>;
    })}</div> : null}
    {failed && <div className={s.error} role="alert">{t('extension.wallet.unavailable')}<Button onClick={() => { setFailed(false); setBusy(true); setRevision(value => value + 1); }}>{t('common.retry')}</Button></div>}
    {!failed && !wallet?.records.items.length && (busy ? <p className={s.empty}>{t('extension.copy.loading')}</p> : <EmptyState icon={<History />} title={t('extension.wallet.empty')} />)}
    {wallet?.records.nextCursor && <Button disabled={busy || failed} onClick={() => void c.run('wallet-records', { direction, more: true })}>{t('extension.wallet.more')}</Button>}
    {selected && <RecordDetail c={c} record={selected} onClose={() => setSelected(undefined)} />}
  </div>;
}
