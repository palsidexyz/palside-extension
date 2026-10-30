import type { HandlerRegistry } from '../composition/handler-registry';
import { createPacketInput } from './packets';

export const walletHandlers = {
  'wallet-team': async function (command) { return this.runtime.wallet.team(command.payload.teamId, command.payload.cursor); },
  'wallet-room': async function (command) { return this.runtime.wallet.room(command.payload.key); },
  'wallet-person': async function (command) { return this.runtime.wallet.person(command.payload.accountId); },
  // A grab is assigned by the service and settled by its automation: no password, no payment order.
  'wallet-claim': async function (command) {
    const claim = await this.runtime.api.request('chain.claim', { params: { id: command.payload.packetId }, key: `claim:${command.payload.packetId}` });
    (await this.runtime.wallet.start()).noteGrab(command.payload.packetId);
    return claim;
  },
  'wallet-packet': async function (command) { return this.runtime.api.request('chain.packet', { params: command.payload }); },
  'wallet-refresh': async function () { return this.runtime.wallet.refresh(); },
  'wallet-unlock': async function (command) { return this.runtime.wallet.unlock(command.payload.password); },
  'wallet-records': async function (command) { return (await this.runtime.wallet.start()).records(command.payload.direction, command.payload.more); },
  'wallet-recovery': async function (command) { return (await this.runtime.wallet.start()).recoveries(command.payload?.more); },
  'wallet-recovery-check': async function (command) { return (await this.runtime.wallet.start()).checkRecovery(command.payload.orderId); },
  'wallet-recovery-resume': async function (command) { return (await this.runtime.wallet.start()).resumeRecovery(command.payload.orderId); },
  'wallet-review': async function (command) { return (await this.runtime.wallet.start()).review(command.payload.input); },
  'wallet-packet-review': async function (command) { return (await this.runtime.wallet.start()).review(createPacketInput(command.payload)); },
  'wallet-confirm': async function (command) { return this.runtime.wallet.confirm(command.payload); },
  'wallet-reconcile': async function () { return (await this.runtime.wallet.start()).reconcile(); },
  'wallet-dismiss': async function (command) { await this.runtime.wallet.dismiss(command.payload); },
  'wallet-opened-ack': async function () { (await this.runtime.wallet.start()).acknowledgeOpened(); },
  'wallet-preferences': async function (command) {
    const controller = await this.runtime.wallet.start(), payload = command.payload ?? {};
    if (payload.smallPayments !== undefined) await controller.setSmallPayments(payload.smallPayments, payload.password);
    if (payload.hideAmounts !== undefined) await controller.setHideAmounts(payload.hideAmounts);
  },
  'wallet-receive': async function (command) { return { uri: (await this.runtime.wallet.start()).receive(command.payload?.amount) }; },
  'wallet-export-private-key': async function (command) { return this.runtime.wallet.reveal(command.payload.password, command.payload.owner ?? ''); },
  'wallet-hide-private-key': async function (command) { this.runtime.wallet.hide(command.payload?.owner); },
  'wallet-panel-drop': async function (command) { this.runtime.wallet.hide(command.payload.owner); },
} satisfies HandlerRegistry;
