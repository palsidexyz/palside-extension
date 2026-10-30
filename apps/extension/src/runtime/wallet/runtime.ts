import type { ChainEvent, ChainOrder, ChainOrderInput } from '@palside/shared/contracts/chain';
import type { PalsideService } from '../composition/core';
import { unlockLocalMnemonic } from '../account/local-password';
import { WalletController, type PaymentOwner } from './controller';
import { WalletKeys, deriveWalletAccount } from './keys';
import { walletApi } from './api';
import { signWalletBinding, verifyWalletBinding } from './binding';

/** Account-scoped composition adapter. Panels only see snapshots and typed commands. */
export class WalletRuntime {
  private runtime: PalsideService;
  private controller?: WalletController;
  private keys?: WalletKeys;
  private accountId?: string;
  private starting?: Promise<WalletController>;
  private generation = 0;
  private exposureGeneration = 0;
  private exposureOwner?: string;
  private recipients = new Map<string, string>();
  private teamFeed?: { teamId: string; tail: Promise<unknown>; paged: boolean };
  private roomRequest = 0;
  private messageRequest = 0;
  private personRequests = new Map<string, object>();
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  reset() { this.hide(); this.generation++; this.roomRequest++; this.messageRequest++; this.personRequests.clear(); this.teamFeed = undefined; this.recipients.clear(); this.controller?.dispose(); this.keys?.dispose(); this.controller = undefined; this.keys = undefined; this.starting = undefined; this.accountId = undefined; this.runtime.state.wallet = undefined; }
  async start(mnemonic?: string): Promise<WalletController> {
    const runtime = this.runtime, session = runtime.auth.session;
    if (!session) throw new Error('AUTH_REQUIRED');
    if (this.accountId !== undefined && this.accountId !== session.account.id) this.reset();
    if (this.starting) { await this.starting; return mnemonic ? this.start(mnemonic) : this.controller!; }
    if (this.controller && !mnemonic) return this.controller;
    const scope = runtime.auth.scope(), accountId = session.account.id, generation = this.generation;
    const check = () => { scope.check(); if (runtime.auth.session !== session || this.generation !== generation) throw new Error('WALLET_SESSION_CHANGED'); };
    let ownedController: WalletController | undefined, ownedKeys: WalletKeys | undefined;
    this.accountId = accountId;
    const work = (async () => {
      let address = mnemonic ? deriveWalletAccount(mnemonic).address : await runtime.storage.get<string>(`${accountId}:wallet-address`) ?? '';
      check();
      const keys = new WalletKeys({ storage: runtime.storage, accountId, check });
      ownedKeys = keys;
      if (mnemonic) keys.initialize(mnemonic);
      // Address is public; only the encrypted mnemonic vault persists signing material.
      if (address) await runtime.storage.put(`${accountId}:wallet-address`, accountId, 'wallet-address', address);
      check();
      if (!address) {
        try {
          const binding = await runtime.api.request('chain.wallet'); check();
          if (binding && verifyWalletBinding(binding, accountId, binding.chainId)) address = binding.address;
        } catch { check(); }
      }
      this.controller?.dispose(); this.keys = keys;
      const controller = new WalletController({ accountId, address, storage: runtime.storage, api: walletApi(runtime.api), keys, check,
        validateRecipient: (input, order) => this.validateRecipient(input, order),
        onChange: state => {
          check(); runtime.state.wallet = state;
          runtime.state.data.people = runtime.state.data.people.map(person => person.id === accountId ? { ...person, walletAddress: state.address || undefined, walletVerified: !!state.address } : person);
          runtime.emit();
        },
      });
      this.controller = ownedController = controller;
      await controller.start(); check();
      if (controller.snapshot().config?.deployment) {
        try {
          if (mnemonic) await this.bind(mnemonic, check);
          else {
            const binding = await runtime.api.request('chain.wallet'); check();
            if (!binding || !verifyWalletBinding(binding, accountId, controller.snapshot().config!.deployment!.chainId, address)) controller.lock();
          }
        } catch (error) { check(); controller.lock(); if (mnemonic) throw error; }
      }
      return controller;
    })();
    this.starting = work;
    try { return await work; } catch (error) {
      ownedController?.dispose(); ownedKeys?.dispose();
      if (this.generation === generation && this.starting === work) {
        if (this.controller === ownedController) { this.controller = undefined; runtime.state.wallet = undefined; runtime.emit(); }
        if (this.keys === ownedKeys) this.keys = undefined;
      }
      throw error;
    } finally { if (this.starting === work) this.starting = undefined; }
  }
  async refresh() {
    if (!this.controller || this.starting || this.accountId !== this.runtime.auth.session?.account.id) return (await this.start()).snapshot();
    return this.controller.refresh();
  }
  private async bind(mnemonic: string, check: () => void) {
    const runtime = this.runtime, controller = this.controller!;
    const state = controller.snapshot(), chainId = state.config!.deployment!.chainId, address = state.address, accountId = this.accountId!;
    const existing = await runtime.api.request('chain.wallet'); check();
    if (existing) { if (!verifyWalletBinding(existing, accountId, chainId, address)) throw new Error('WALLET_BINDING_MISMATCH'); return; }
    const challenge = await runtime.api.request('chain.walletChallenge', { body: { address }, key: crypto.randomUUID() }); check();
    const body = await signWalletBinding(mnemonic, challenge, { accountId, address, chainId }); check();
    const bound = await runtime.api.request('chain.walletBind', { body, key: challenge.id }); check();
    if (!verifyWalletBinding(bound, accountId, chainId, address)) throw new Error('WALLET_BINDING_MISMATCH');
    await controller.refresh();
  }
  private async paymentController(expected: PaymentOwner) {
    const session = this.runtime.auth.session;
    if (!session || expected.accountId !== session.account.id) throw new Error('WALLET_SESSION_CHANGED');
    const controller = await this.start();
    if (this.runtime.auth.session !== session) throw new Error('WALLET_SESSION_CHANGED');
    return controller;
  }
  async confirm(expected: PaymentOwner & { password?: string }) {
    return (await this.paymentController(expected)).confirm(expected, expected.password);
  }
  async dismiss(expected: PaymentOwner) {
    await (await this.paymentController(expected)).dismiss(expected);
  }
  async unlock(password: string) {
    const runtime = this.runtime, session = runtime.auth.session;
    if (!session) throw new Error('AUTH_REQUIRED');
    const scope = runtime.auth.scope();
    const mnemonic = await unlockLocalMnemonic({ storage: runtime.storage, accountId: session.account.id, password, check: scope.check }); scope.check();
    await this.start(mnemonic); scope.check();
    return this.controller!.snapshot();
  }
  async validateRecipient(input: ChainOrderInput, order: ChainOrder) {
    const runtime = this.runtime, accountId = this.accountId!;
    let recipientId: string | undefined;
    if (input.kind === 'transfer' && 'teamId' in input) {
      const team = runtime.state.remoteTeams.find(team => team.id === input.teamId && team.joined);
      if (!team || !team.memberIds.includes(accountId) || !team.memberIds.includes(input.recipientId)) throw new Error('RECIPIENT_NOT_TEAMMATE');
      recipientId = input.recipientId;
    } else if (input.kind === 'tip') {
      const message = runtime.state.rooms.current?.messages.find(message => message.id === input.messageId);
      recipientId = message?.author.id;
      if (!recipientId || this.recipients.has(order.id) && this.recipients.get(order.id) !== recipientId) throw new Error('TIP_MESSAGE_UNAVAILABLE');
      this.recipients.set(order.id, recipientId);
    }
    if (!recipientId) return;
    if (recipientId === accountId || runtime.state.rooms.blocked.some(person => person.id === recipientId)) throw new Error('RECIPIENT_BLOCKED');
    const scope = runtime.auth.scope();
    const binding = await runtime.api.request('chain.walletPeer', { params: { id: recipientId } }); scope.check();
    if (!binding || !verifyWalletBinding(binding, recipientId, order.deployment.chainId, order.recipient)) throw new Error('WALLET_BINDING_MISMATCH');
    if (runtime.state.rooms.blocked.some(person => person.id === recipientId)) throw new Error('RECIPIENT_BLOCKED');
    if (input.kind === 'tip' && !runtime.state.rooms.current?.messages.some(message => message.id === input.messageId && message.author.id === recipientId)) throw new Error('TIP_MESSAGE_UNAVAILABLE');
    if (input.kind === 'transfer' && 'teamId' in input && !runtime.state.remoteTeams.some(team => team.id === input.teamId && team.joined && team.memberIds.includes(accountId) && team.memberIds.includes(recipientId!))) throw new Error('RECIPIENT_NOT_TEAMMATE');
  }
  async person(accountId: string) {
    const runtime = this.runtime, scope = runtime.auth.scope(), request = {};
    this.personRequests.set(accountId, request);
    try {
      const result = await runtime.api.request('chain.person', { params: { id: accountId } }); scope.check();
      const binding = result.wallet;
      if (binding && !verifyWalletBinding(binding, accountId, binding.chainId)) throw new Error('WALLET_BINDING_MISMATCH');
      if (this.personRequests.get(accountId) !== request) return result;
      runtime.state.data.people = runtime.state.data.people.map(person => person.id === accountId ? { ...person, walletAddress: binding?.address, walletVerified: !!binding } : person);
      runtime.emit(); return result;
    } finally { if (this.personRequests.get(accountId) === request) this.personRequests.delete(accountId); }
  }
  async team(teamId: string, cursor?: string) {
    const runtime = this.runtime, scope = runtime.auth.scope(), selected = runtime.state.preferences.current;
    if (this.teamFeed?.teamId !== teamId) this.teamFeed = { teamId, tail: Promise.resolve(), paged: false };
    const context = this.teamFeed;
    // Serialize this team's pages and refreshes so a late page cannot overwrite newer statuses.
    const work = context.tail.catch(() => {}).then(async () => {
      scope.check();
      const current = () => this.teamFeed === context && runtime.state.preferences.current === selected;
      if (!current()) throw new Error('WALLET_TEAM_CHANGED');
      const feed = await runtime.api.request('chain.teamFeed', { params: { id: teamId }, query: { ...(cursor ? { cursor } : {}) } }); scope.check();
      if (!current()) return feed;
      const previous = runtime.state.chainTeam?.teamId === teamId ? runtime.state.chainTeam : undefined;
      const merge = <T>(old: T[], incoming: T[], key: (item: T) => string) => {
        const updates = new Map(incoming.map(item => [key(item), item]));
        const rows = cursor ? [...old.map(item => updates.get(key(item)) ?? item), ...incoming] : [...incoming, ...old.filter(item => !updates.has(key(item)))];
        return [...new Map(rows.map(item => [key(item), item])).values()];
      };
      runtime.state.chainTeam = {
        teamId,
        packets: merge(previous?.packets ?? [], feed.packets, item => item.packet.id),
        transfers: merge(previous?.transfers ?? [], feed.transfers, item => item.id),
        nextCursor: !cursor && previous && context.paged ? previous.nextCursor : feed.nextCursor,
      };
      if (cursor) context.paged = true;
      runtime.emit(); return feed;
    });
    context.tail = work;
    return work;
  }
  async room(key: string) {
    const runtime = this.runtime, scope = runtime.auth.scope(), selected = runtime.state.rooms.current;
    const request = ++this.roomRequest;
    const room = await runtime.api.request('chain.room', { query: { key } }); scope.check();
    if (request !== this.roomRequest || runtime.state.rooms.current !== selected) return room;
    runtime.state.chainRoom = { ...room, key }; runtime.emit(); return room;
  }
  async event(event: ChainEvent) {
    const runtime = this.runtime, scope = runtime.auth.scope();
    const controller = await this.start(); scope.check();
    await controller.handleEvent(event); scope.check();
    runtime.state.chainRevision = (runtime.state.chainRevision ?? 0) + 1;
    const key = runtime.state.rooms.current?.key;
    if (event.type === 'tip' && event.roomKey === key || event.type === 'packet' && event.scope === key) {
      if (key) await this.room(key);
    }
    const teamId = runtime.state.chainTeam?.teamId;
    if (teamId && (event.type === 'packet' && event.scope === teamId || event.type === 'order' && (event.order.payload.kind === 'transfer' && 'teamId' in event.order.payload && event.order.payload.teamId === teamId || event.order.payload.kind === 'packet' && event.order.payload.packet.scope === teamId))) await this.team(teamId);
    scope.check();
    if (event.type === 'tip') {
      const jobs: Promise<unknown>[] = [];
      const selected = runtime.state.rooms.current;
      if (key && selected?.key === key) {
        const request = ++this.messageRequest;
        jobs.push((async () => {
          const page = await runtime.api.request('rooms.messages', { query: { key } }); scope.check();
          if (request === this.messageRequest && runtime.state.rooms.current === selected) {
            runtime.rooms.refreshMessages(key, page.messages);
          }
        })());
      }
      await Promise.all(jobs); scope.check();
    }
    runtime.emit();
  }
  async reveal(password: string, owner: string) {
    if (!owner) throw new Error('PANEL_REQUIRED');
    if (this.accountId !== undefined && this.accountId !== this.runtime.auth.session?.account.id) this.reset();
    this.hide();
    this.exposureOwner = owner;
    const exposure = this.exposureGeneration;
    await this.start();
    if (exposure !== this.exposureGeneration) throw new Error('PRIVATE_KEY_EXPOSURE_CANCELLED');
    return this.keys!.reveal(password, owner);
  }
  hide(owner?: string) {
    if (owner === undefined || this.exposureOwner === owner) { this.exposureGeneration++; this.exposureOwner = undefined; }
    this.keys?.hide(owner);
  }
  async offline() { this.hide(); this.controller?.offline(); }
}
