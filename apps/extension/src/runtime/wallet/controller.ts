import { chainBalance, chainRecords, type ChainClientConfig, type ChainEvent, type ChainOrder, type ChainOrderInput } from '@palside/shared/contracts/chain';
import type { Infer } from '@palside/shared/contracts/validation';
import type { ApiResult } from '../transport/api';
import { orderCalls, orderFingerprint, type OrderAuthorization } from '@palside/shared/chain/orders';
import type { RelaySigningEnvelope, RelaySigningExpectation, RelaySignature } from '@palside/shared/chain/signing';
import { chainAmount } from '@palside/shared/chain/rules';
import { paymentTotal, terminalPayment, type WalletBaseState, type WalletPayment } from '../../domain/wallet/model';
import { WalletLocalState } from './local-state';
import { WalletKeys } from './keys';
import { checkTransferAddress, receiveRequest } from './receive';
import type { LocalLocks, LocalSecretStorage } from '../account/local-password';

export type WalletBalance = Infer<typeof chainBalance>;
export type WalletRecords = Infer<typeof chainRecords>;
export type WalletRelayResult = { requestId: string; orderId: string; state: 'preparing' | 'prepared' | 'submitting' | 'uncertain' | 'submitted' | 'included' | 'confirmed' | 'failed' | 'expired' | 'cancelled'; envelope: RelaySigningEnvelope | null; transactionHash: string | null; error: string | null };
export type WalletPrice = ApiResult<'chain.price'>;
export type WalletRecovery = ApiResult<'chain.recovery'>;
export type WalletState = WalletBaseState & { balance?: WalletBalance; price?: WalletPrice; records: WalletRecords; recovery?: WalletRecovery & { loading?: boolean; error?: string }; error?: string };
export interface WalletApiPort {
  config(): Promise<ChainClientConfig>;
  balance(): Promise<WalletBalance>;
  price(): Promise<WalletPrice>;
  records(query: { direction: 'all' | 'in' | 'out'; cursor?: string }): Promise<WalletRecords>;
  recovery(query: { cursor?: string; orderId?: string }): Promise<WalletRecovery>;
  quote(input: ChainOrderInput, key: string): Promise<ChainOrder>;
  order(id: string): Promise<ChainOrder>;
  prepare(orderId: string, key: string): Promise<WalletRelayResult>;
  submit(orderId: string, signed: { requestId: string; signatures: RelaySignature[] }, key: string): Promise<WalletRelayResult>;
  status(requestId: string): Promise<WalletRelayResult>;
  cancel(requestId: string, key: string): Promise<WalletRelayResult>;
}
export type WalletControllerOptions = {
  accountId: string; address: string; storage: LocalSecretStorage; api: WalletApiPort;
  keys: WalletKeys; check: () => void; locks?: LocalLocks; now?: () => number;
  /** Verify recipient identity/address proof and current membership/block rules. Called again before signing. */
  validateRecipient: (input: ChainOrderInput, order: ChainOrder) => Promise<void>;
  onChange?: (state: WalletState) => void;
};
export type PaymentOwner = { accountId: string; paymentId: string };
export interface WalletControllerPort {
  snapshot(): WalletState;
  refresh(): Promise<WalletState>;
  records(direction: 'all' | 'in' | 'out', more?: boolean): Promise<WalletRecords>;
  review(input: ChainOrderInput): Promise<WalletPayment>;
  confirm(expected: PaymentOwner, password?: string): Promise<WalletPayment>;
  reconcile(): Promise<WalletPayment | undefined>;
  dismiss(expected: PaymentOwner): Promise<void>;
  setSmallPayments(enabled: boolean, password?: string): Promise<void>;
  setHideAmounts(hidden: boolean): Promise<void>;
  receive(amount?: string): string;
}
const code = (error: unknown) => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof Error ? error.message : 'WALLET_ERROR';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
/** One instance belongs to one account generation in the offscreen runtime. */
export class WalletController implements WalletControllerPort {
  private options: WalletControllerOptions;
  private local: WalletLocalState;
  private state: WalletState;
  private busy = false;
  private generation = 0;
  private refreshVersion = 0;
  private recordsVersion = 0;
  private recoveryVersion = 0;
  private direction: 'all' | 'in' | 'out' = 'all';
  private pollTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private grabbed = new Set<string>();
  private quoteAttempt?: { input: string; key: string };
  constructor(options: WalletControllerOptions) {
    this.options = options;
    this.local = new WalletLocalState(options.storage, options.accountId, () => this.check(), options.locks, options.now);
    this.state = { address: options.address, availability: 'loading', preferences: { smallPayments: false, hideAmounts: false }, records: { items: [], nextCursor: null }, openedNotice: false };
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private check(generation = this.generation) { this.options.check(); if (this.disposed || generation !== this.generation) throw new Error('WALLET_SESSION_CHANGED'); }
  private emit() { this.check(); this.options.onChange?.(this.snapshot()); }
  snapshot(): WalletState { return structuredClone(this.state); }
  private pendingKey() { return `${this.options.accountId}:wallet-payment`; }
  private async savePayment() {
    await this.options.storage.put(this.pendingKey(), this.options.accountId, 'wallet-payment', this.state.payment ?? null);
    this.check();
  }
  async start(): Promise<void> {
    this.check(); this.state.preferences = await this.local.preferences(); this.check();
    const cached = await this.options.storage.get<WalletBalance>(`${this.options.accountId}:wallet-balance`); this.check();
    if (cached && same(cached.address, this.state.address)) this.state.balance = cached;
    const payment = await this.options.storage.get<WalletPayment | null>(this.pendingKey()); this.check();
    if (payment && !terminalPayment(payment.phase)) {
      this.state.payment = payment;
      if (payment.phase === 'signing') { this.state.payment.phase = 'password'; this.state.payment.passwordRequired = true; }
      else if (['submitting', 'pending'].includes(payment.phase)) this.state.payment.phase = 'pending';
    }
    await this.refresh();
    if (this.state.payment?.phase === 'pending') await this.reconcile();
    await this.recoveries();
  }
  async recoveries(more = false): Promise<WalletRecovery> {
    this.check();
    const previous = this.state.recovery ?? { items: [], nextCursor: null };
    if (more && !previous.nextCursor) return previous;
    const version = ++this.recoveryVersion;
    this.state.recovery = { ...previous, loading: true, error: undefined }; this.emit();
    try {
      const page = await this.options.api.recovery(more ? { cursor: previous.nextCursor! } : {}); this.check();
      if (version !== this.recoveryVersion) return this.state.recovery!;
      if (page.items.some(item => item.order.accountId !== this.options.accountId)) throw new Error('ORDER_MISMATCH');
      const items = more ? [...previous.items, ...page.items] : page.items;
      this.state.recovery = { items: [...new Map(items.map(item => [item.order.id, item])).values()], nextCursor: page.nextCursor };
    } catch (error) {
      this.check();
      if (version === this.recoveryVersion) this.state.recovery = { ...previous, error: code(error) };
    }
    this.emit(); return structuredClone(this.state.recovery!);
  }
  private async recoveryItem(orderId: string) {
    const page = await this.options.api.recovery({ orderId }); this.check();
    const item = page.items.find(item => item.order.id === orderId);
    if (!item || item.order.accountId !== this.options.accountId) throw new Error('ORDER_MISMATCH');
    return item;
  }
  async checkRecovery(orderId: string) {
    const item = await this.recoveryItem(orderId);
    // These existing endpoints only reconcile the original operation; never prepare or send.
    if (item.relay) { await this.options.api.status(item.relay.requestId); this.check(); }
    await this.options.api.order(orderId); this.check();
    const updated = await this.recoveryItem(orderId);
    const current = this.state.recovery;
    if (current) { this.recoveryVersion++; this.state.recovery = { ...current, loading: false, items: current.items.map(row => row.order.id === orderId ? updated : row) }; this.emit(); }
    return updated;
  }
  async resumeRecovery(orderId: string): Promise<WalletPayment> {
    this.ready();
    if (this.busy || this.state.payment && !terminalPayment(this.state.payment.phase)) throw new Error('PAYMENT_BUSY');
    this.busy = true;
    try {
      const item = await this.recoveryItem(orderId);
      if (!item.canResume || item.order.status !== 'quoted' || item.relay && item.relay.state !== 'prepared') throw new Error('PAYMENT_BUSY');
      this.verifyOrder(item.order, item.order.payload);
      await this.options.validateRecipient(item.order.payload, item.order); this.check();
      this.state.payment = { id: item.order.id, input: structuredClone(item.order.payload), order: structuredClone(item.order), phase: 'review', passwordRequired: true, total: paymentTotal(item.order).toString(), ...(item.relay ? { requestId: item.relay.requestId } : {}) };
      await this.savePayment(); this.emit(); return structuredClone(this.state.payment);
    } finally { this.busy = false; }
  }
  async refresh(): Promise<WalletState> {
    const generation = this.generation, version = ++this.refreshVersion;
    try {
      const config = await this.options.api.config(); this.check(generation);
      if (version !== this.refreshVersion || this.state.config && config.version < this.state.config.version) return this.snapshot();
      await this.applyConfig(config); this.check(generation);
      if (!config.enabled || !config.deployment) return this.snapshot();
      if (!this.state.address) { this.state.availability = 'locked'; this.emit(); return this.snapshot(); }
      const [balance, price] = await Promise.all([this.options.api.balance(), this.options.api.price().catch(() => null)]); this.check(generation);
      if (version !== this.refreshVersion || this.state.config?.version !== config.version || !this.state.config.enabled) return this.snapshot();
      if (!same(balance.address, this.state.address) || !same(balance.token, config.deployment.token) || balance.chainId !== config.deployment.chainId) throw new Error('INVALID_WALLET_BALANCE');
      chainAmount(balance.balance);
      await this.options.storage.put(`${this.options.accountId}:wallet-balance`, this.options.accountId, 'wallet-balance', balance); this.check(generation);
      if (version !== this.refreshVersion || this.state.config?.version !== config.version || !this.state.config.enabled) return this.snapshot();
      this.state.price = price && BigInt(price.denominator) > 0n ? price : null;
      this.state.balance = balance; this.state.availability = 'ready'; this.state.error = undefined; this.emit();
    } catch (error) {
      this.check(generation);
      if (version === this.refreshVersion) { this.state.availability = code(error) === 'CHAIN_WALLET_REQUIRED' ? 'locked' : 'offline'; this.state.error = code(error); this.emit(); }
    }
    return this.snapshot();
  }
  async applyConfig(config: ChainClientConfig): Promise<void> {
    this.check();
    if (this.state.config && config.version < this.state.config.version) return;
    const previous = this.state.config;
    this.state.config = structuredClone(config);
    if (previous?.deployment && config.deployment && (previous.deployment.chainId !== config.deployment.chainId || !same(previous.deployment.token, config.deployment.token))) {
      this.state.balance = undefined; this.state.records = { items: [], nextCursor: null };
    }
    if (!config.enabled || !config.deployment) { this.state.availability = 'closed'; this.state.price = null; }
    else {
      if (this.state.availability === 'closed') this.state.availability = 'loading';
      if (await this.local.claimOpenedNotice()) this.state.openedNotice = true;
    }
    this.check(); this.emit();
  }
  acknowledgeOpened() { this.check(); this.state.openedNotice = false; this.emit(); }
  lock() { this.check(); if (this.state.config?.enabled) this.state.availability = 'locked'; this.emit(); }
  offline() { this.check(); this.state.availability = this.state.config?.enabled ? 'offline' : 'closed'; this.emit(); }
  async handleEvent(event: ChainEvent): Promise<void> {
    this.check();
    if (event.type === 'config') { await this.applyConfig(event.config); if (event.config.enabled) await this.refresh(); }
    else if (event.type === 'order' && event.accountId === this.options.accountId) {
      if (event.order.id === this.state.payment?.order.id) await this.acceptOrder(event.order);
      if (event.order.status === 'confirmed') await this.refresh();
    }
    // Money that arrives without my own order: a teammate's transfer to me, or a packet share the service settles for me.
    // Room keys contain ':'; a busy room only refreshes for packets I grabbed.
    else if (event.type === 'order' && event.order.status === 'confirmed' && same(event.order.recipient, this.state.address)) await this.refresh();
    else if (event.type === 'packet' && (!event.scope.includes(':') || this.grabbed.has(event.packetId))) await this.refresh();
  }
  /** A grab settles later through packet events; remember it so a room packet still refreshes my balance. */
  noteGrab(packetId: string) { this.grabbed.add(packetId); void this.refresh().catch(() => undefined); }
  async records(direction: 'all' | 'in' | 'out', more = false): Promise<WalletRecords> {
    this.check();
    const version = ++this.recordsVersion;
    const cursor = more && direction === this.direction ? this.state.records.nextCursor : undefined;
    if (more && !cursor) return structuredClone(this.state.records);
    const page = await this.options.api.records({ direction, ...(cursor ? { cursor } : {}) }); this.check();
    if (version !== this.recordsVersion) return structuredClone(this.state.records);
    const incoming = page.items.filter(item => chainAmount(item.amount) > 0n && (same(item.from, this.state.address) || same(item.to, this.state.address)));
    const items = cursor ? [...this.state.records.items, ...incoming] : incoming;
    this.direction = direction;
    this.state.records = { items: [...new Map(items.map(item => [item.id, item])).values()], nextCursor: page.nextCursor };
    this.emit(); return structuredClone(this.state.records);
  }
  private async refreshAfterConfigError(error: unknown) {
    if (code(error) === 'CHAIN_CONFIG_CHANGED' || code(error) === 'CHAIN_DISABLED') await this.refresh();
  }
  private ready() {
    this.check();
    if (this.state.availability !== 'ready' || !this.state.config?.enabled || !this.state.config.deployment) throw new Error('CHAIN_DISABLED');
    return this.state.config;
  }
  private verifyOrder(order: ChainOrder, input: ChainOrderInput) {
    const config = this.ready();
    if (input.kind === 'transfer' && 'recipient' in input) checkTransferAddress(input.recipient, this.state.address, config.deployment!);
    if (order.accountId !== this.options.accountId || !same(order.payer, this.state.address) || order.kind !== input.kind || canonical(order.payload) !== canonical(input)) throw new Error('ORDER_MISMATCH');
    if (order.status !== 'quoted' || order.expiresAt <= this.now()) throw new Error('ORDER_EXPIRED');
    if (order.deployment.chainId !== config.deployment!.chainId || canonical(order.deployment) !== canonical(config.deployment)) throw new Error('DEPLOYMENT_CHANGED');
    if (order.configVersion > config.version) throw new Error('CHAIN_CONFIG_CHANGED');
    const expectedAmount = 'amount' in input ? chainAmount(input.amount) : input.packet.amounts.reduce((total, value) => total + chainAmount(value), 0n);
    if (chainAmount(order.amount) !== expectedAmount) throw new Error('PRICE_CHANGED');
    if (input.kind === 'transfer' && 'recipient' in input && !same(order.recipient, input.recipient)) throw new Error('RECIPIENT_MISMATCH');
    if (paymentTotal(order) <= 0n || !this.state.balance || paymentTotal(order) > chainAmount(this.state.balance.balance)) throw new Error('INSUFFICIENT_BALANCE');
  }
  async review(input: ChainOrderInput): Promise<WalletPayment> {
    const config = this.ready();
    if (this.state.payment?.requestId && !terminalPayment(this.state.payment.phase)) throw new Error('PAYMENT_BUSY');
    if (this.busy || this.state.payment && !terminalPayment(this.state.payment.phase) && !['review', 'password'].includes(this.state.payment.phase)) throw new Error('PAYMENT_BUSY');
    this.busy = true;
    try {
      if (input.kind === 'transfer' && 'recipient' in input) checkTransferAddress(input.recipient, this.state.address, config.deployment!);
      const encoded = JSON.stringify(input);
      if (this.state.payment && terminalPayment(this.state.payment.phase)) this.quoteAttempt = undefined;
      if (this.quoteAttempt?.input !== encoded) this.quoteAttempt = { input: encoded, key: crypto.randomUUID() };
      const order = await this.options.api.quote(structuredClone(input), this.quoteAttempt.key); this.check();
      this.verifyOrder(order, input);
      await this.options.validateRecipient(input, order); this.check();
      const total = paymentTotal(order);
      const passwordRequired = !this.options.keys.unlocked || !await this.local.canSkip(input, total, order.deployment.decimals); this.check();
      this.state.payment = { id: order.id, input: structuredClone(input), order: structuredClone(order), phase: 'review', passwordRequired, total: total.toString() };
      await this.savePayment(); this.emit(); return structuredClone(this.state.payment);
    } catch (error) {
      this.check(); await this.refreshAfterConfigError(error); throw error;
    } finally { this.busy = false; }
  }
  private checkPayment(expected: PaymentOwner) {
    this.check();
    if (expected?.accountId !== this.options.accountId) throw new Error('WALLET_SESSION_CHANGED');
    if (!this.state.payment || expected.paymentId !== this.state.payment.id) throw new Error('ORDER_MISMATCH');
  }
  async confirm(expected: PaymentOwner, password?: string): Promise<WalletPayment> {
    this.checkPayment(expected);
    this.ready();
    const payment = this.state.payment;
    if (!payment || !['review', 'password'].includes(payment.phase) || this.busy) throw new Error('PAYMENT_BUSY');
    this.busy = true;
    let reserved = false, submitted = false, signatureIssued = false;
    try {
      if (payment.order.expiresAt <= this.now()) { payment.phase = 'expired'; throw new Error('ORDER_EXPIRED'); }
      signatureIssued = !!payment.signed;
      await this.options.validateRecipient(payment.input, payment.order); this.check();
      if (password === undefined && this.options.keys.unlocked && !payment.passwordRequired) reserved = await this.local.reserve(payment.id, payment.input, BigInt(payment.total), payment.order.deployment.decimals);
      this.check();
      if (!reserved) {
        payment.passwordRequired = true; payment.phase = 'password'; this.emit();
        if (password === undefined) return structuredClone(payment);
        const address = await this.options.keys.unlock(password); this.check();
        if (!same(address, this.state.address)) throw new Error('WALLET_ADDRESS_MISMATCH');
      }
      this.ready();
      payment.phase = 'signing'; payment.error = undefined; await this.savePayment(); this.emit();
      const prepared = await this.options.api.prepare(payment.order.id, `${payment.id}_prepare`); this.check();
      if (prepared.orderId !== payment.order.id) throw new Error('ORDER_MISMATCH');
      payment.requestId = prepared.requestId;
      // Another device may have submitted the recovered request after review.
      if (prepared.state !== 'prepared') {
        submitted = ['submitting', 'uncertain', 'submitted', 'included', 'confirmed'].includes(prepared.state);
        payment.phase = 'pending'; await this.applyRelay(prepared); await this.savePayment(); this.emit();
        await this.reconcile(); return structuredClone(payment);
      }
      const envelope = prepared.envelope;
      if (!envelope) throw new Error(prepared.error ?? 'PREPARATION_UNAVAILABLE');
      this.ready();
      await this.options.validateRecipient(payment.input, payment.order); this.check();
      const authorization = (envelope as RelaySigningEnvelope & { orderAuthorization?: OrderAuthorization }).orderAuthorization ?? {};
      const calls = orderCalls(payment.order, authorization);
      const expected: RelaySigningExpectation = { orderId: payment.order.id, orderFingerprint: orderFingerprint(payment.order, calls), account: this.state.address as `0x${string}`, chainId: payment.order.deployment.chainId, calls };
      if (envelope.fee.mode !== 'sponsored') throw new Error('INVALID_GAS_QUOTE');
      if (payment.order.deployment.chainId !== this.state.config?.deployment?.chainId || canonical(payment.order.deployment) !== canonical(this.state.config?.deployment)) throw new Error('DEPLOYMENT_CHANGED');
      payment.signed = true; await this.savePayment();
      signatureIssued = true;
      const signed = await this.options.keys.sign(envelope, expected); this.check(); this.ready();
      if (payment.order.deployment.chainId !== this.state.config?.deployment?.chainId || canonical(payment.order.deployment) !== canonical(this.state.config?.deployment)) throw new Error('DEPLOYMENT_CHANGED');
      payment.phase = 'submitting'; await this.savePayment(); this.emit();
      submitted = true;
      const result = await this.options.api.submit(payment.order.id, signed, `${payment.id}_submit`); this.check();
      payment.phase = 'pending'; await this.applyRelay(result); await this.savePayment(); this.emit();
      await this.reconcile(); return structuredClone(payment);
    } catch (error) {
      this.check();
      payment.error = code(error);
      if (submitted) { payment.phase = 'pending'; this.schedulePoll(); }
      else {
        if (reserved && !signatureIssued) await this.local.release(payment.id);
        if (payment.phase !== 'expired') payment.phase = 'password';
      }
      await this.savePayment(); this.emit();
      await this.refreshAfterConfigError(error);
      if (submitted) return structuredClone(payment);
      throw error;
    } finally { this.busy = false; }
  }
  private async applyRelay(result: WalletRelayResult) {
    const payment = this.state.payment;
    if (!payment || result.orderId !== payment.id || result.requestId !== payment.requestId) throw new Error('ORDER_MISMATCH');
    if (terminalPayment(payment.phase)) return;
    // A successful receipt is the payment done for the payer; records, balances and the recipient's entitlement still wait for the index.
    if (result.state === 'included' || result.state === 'confirmed') {
      payment.phase = 'confirmed'; payment.error = undefined;
      clearTimeout(this.pollTimer); this.pollTimer = undefined; this.quoteAttempt = undefined;
    } else if (result.state === 'failed' || result.state === 'expired' || result.state === 'cancelled') {
      payment.phase = result.state === 'cancelled' ? 'expired' : result.state; await this.local.release(payment.id, result.state === 'failed' ? 0n : payment.signed ? BigInt(payment.total) : 0n); payment.error = result.error ?? undefined;
      clearTimeout(this.pollTimer); this.pollTimer = undefined; this.quoteAttempt = undefined;
    } else if (result.state === 'prepared' && payment.phase === 'pending') {
      payment.phase = 'password'; payment.passwordRequired = true;
    } else payment.phase = 'pending';
  }
  private async acceptOrder(order: ChainOrder) {
    const payment = this.state.payment;
    if (!payment || payment.order.id !== order.id) return;
    if (order.accountId !== this.options.accountId || !same(order.payer, this.state.address)) throw new Error('ORDER_MISMATCH');
    const immutable = (value: ChainOrder) => canonical({ id: value.id, accountId: value.accountId, payer: value.payer, recipient: value.recipient, kind: value.kind, amount: value.amount, createdAt: value.createdAt, expiresAt: value.expiresAt, deployment: value.deployment, payload: value.payload, configVersion: value.configVersion });
    if (immutable(order) !== immutable(payment.order)) throw new Error('ORDER_MISMATCH');
    // Ignore stale SSE/query responses after a terminal result.
    if (terminalPayment(payment.phase)) return;
    if (order.status === 'quoted' && payment.phase === 'pending') return;
    payment.order = structuredClone(order);
    if (order.status === 'confirmed') payment.phase = 'confirmed';
    else if (order.status === 'failed') { payment.phase = 'failed'; await this.local.release(payment.id, 0n); }
    else if (order.status === 'expired' && payment.phase !== 'pending') { payment.phase = 'expired'; await this.local.release(payment.id, payment.signed ? BigInt(payment.total) : 0n); }
    else if (order.status === 'submitted') payment.phase = 'pending';
    if (terminalPayment(payment.phase)) { clearTimeout(this.pollTimer); this.pollTimer = undefined; this.quoteAttempt = undefined; payment.error = undefined; }
    await this.savePayment(); this.emit();
  }
  async reconcile(): Promise<WalletPayment | undefined> {
    this.check();
    const payment = this.state.payment;
    if (!payment) return;
    try {
      if (payment.phase === 'pending' && payment.requestId) { const status = await this.options.api.status(payment.requestId); this.check(); await this.applyRelay(status); }
      const order = await this.options.api.order(payment.order.id); this.check(); await this.acceptOrder(order);
    }
    catch (error) { this.check(); payment.error = code(error); this.emit(); await this.refreshAfterConfigError(error); }
    if (payment.phase === 'pending') this.schedulePoll();
    return structuredClone(payment);
  }
  private schedulePoll() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; void this.reconcile().catch(() => {}); }, 3000);
  }
  async dismiss(expected: PaymentOwner) {
    this.checkPayment(expected);
    if (this.busy || this.state.payment && !terminalPayment(this.state.payment.phase) && !['review', 'password'].includes(this.state.payment.phase)) throw new Error('PAYMENT_BUSY');
    this.busy = true;
    try {
    const payment = this.state.payment;
    if (payment?.requestId && !terminalPayment(payment.phase)) {
      const result = await this.options.api.cancel(payment.requestId, `${payment.id}_cancel`); this.check();
      if (result.state !== 'cancelled' && result.state !== 'expired' && result.state !== 'failed') throw new Error('PAYMENT_BUSY');
      await this.local.release(payment.id, payment.signed ? BigInt(payment.total) : 0n);
    }
    this.state.payment = undefined; this.quoteAttempt = undefined;
    await this.savePayment(); this.emit();
    } finally { this.busy = false; }
  }
  async setSmallPayments(enabled: boolean, password?: string) {
    this.check();
    if (enabled) {
      if (!password) throw new Error('PASSWORD_REQUIRED');
      const address = await this.options.keys.unlock(password); this.check();
      if (!same(address, this.state.address)) throw new Error('WALLET_ADDRESS_MISMATCH');
    }
    this.state.preferences = await this.local.setPreferences({ smallPayments: enabled }); this.check(); this.emit();
  }
  async setHideAmounts(hidden: boolean) { this.state.preferences = await this.local.setPreferences({ hideAmounts: hidden }); this.check(); this.emit(); }
  receive(amount?: string) { this.check(); return receiveRequest(this.state.address, this.state.config?.deployment ?? undefined, amount); }
  dispose() { this.disposed = true; this.generation++; clearTimeout(this.pollTimer); this.options.keys.dispose(); this.state.payment = undefined; }
}
