import { HOUR_MS, MINUTE_MS } from '@palside/shared/units';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';

/** scene=danmaku-modes: a test-only 零钱 for 弹幕 红包 — someone's packet to grab, and sending one through the real 发红包 page and payment sheet. */
const unit = 10n ** 18n, address = '0x1111111111111111111111111111111111111111';
const deployment = { chainId: 4663 as const, token: '0x3333333333333333333333333333333333333333', packetContract: '0x5555555555555555555555555555555555555555', decimals: 18 as const };
type Packet = { id: string; accountId: string; kind: 'room'; scope: string; status: 'active' | 'pending' | 'exhausted'; count: number; amount: string; claimedCount: number; claimedAmount: string; createdAt: number; expiresAt: number };
type Detail = { packet: Packet; distribution: 'random'; blessing: string; eligibility: string; eligibleAt: null; myClaim: unknown; claims: unknown[] };

export function demoWallet(now: number): RuntimeState['wallet'] {
  return { address, availability: 'ready', preferences: { smallPayments: true, hideAmounts: false }, openedNotice: true,
    config: { enabled: true, version: 1, deployment, dailySponsoredLimit: 50, quickPay: { single: String(200n * unit), daily: String(1000n * unit) }, minimumLiquidity: String(1000n * unit), updatedAt: now },
    balance: { address, token: deployment.token, chainId: 4663, balance: String(4200n * unit), blockNumber: '1200' }, records: { items: [], nextCursor: null } } as never;
}

let serial = 0;
const hex = (char: string) => '0x' + char.repeat(64);
/** Someone in the room sends a 红包 (or `self` when your own payment lands). */
export function demoPacket(key: string, accountId: string, blessing: string, count = 20, amount = 100n): Detail {
  const id = hex('0123456789abcdef'[serial++ % 16]!).slice(0, 62) + String(serial).padStart(2, '0');
  return { packet: { id, accountId, kind: 'room', scope: key, status: 'active', count, amount: String(amount * unit), claimedCount: 3, claimedAmount: String(12n * unit), createdAt: Date.now(), expiresAt: Date.now() + HOUR_MS },
    distribution: 'random', blessing, eligibility: 'eligible', eligibleAt: null, myClaim: null, claims: [] };
}

/** Public names the demo service knows for senders who have not spoken in the room. */
const names: Record<string, string> = { 'ivy-0xa8f0': 'Ivy', 'toshi-0x52aa': 'Toshi' };

type Set = (update: (old: RuntimeState) => RuntimeState) => void;
/** The wallet commands the 弹幕 红包 flow sends. Returns undefined for commands it does not model. */
export function demoWalletCommand(name: string, payload: Record<string, unknown> | undefined, packets: Map<string, Detail>, get: () => RuntimeState, set: Set, self: string) {
  const list = (key: string) => [...packets.values()].filter(item => item.packet.scope === key).map(item => item.packet);
  // The service names each sender: their public profile travels with the list, even if they never spoke in the room.
  const people = (key: string) => [...new Set(list(key).map(packet => packet.accountId))].map(id => ({ id, nickname: names[id] ?? id.split('-')[0]!.replace(/^./, char => char.toUpperCase()), avatarId: null, wallet: null }));
  const refresh = (key: string) => set(old => ({ ...old, chainRoom: { key, packets: list(key), people: people(key) } as never, chainRevision: (old.chainRevision ?? 0) + 1 } as RuntimeState));
  if (name === 'wallet-room') { const key = String(payload?.key); refresh(key); return { key, packets: list(key), people: people(key) }; }
  if (name === 'wallet-packet') return packets.get(String(payload?.id));
  if (name === 'wallet-claim') {
    const detail = packets.get(String(payload?.packetId)); if (!detail) throw Error('Unknown packet');
    const claim = { packetId: detail.packet.id, accountId: self, recipient: address, index: 4, amount: String(6n * unit), claimedAt: Date.now(), nonce: '1', deadline: Date.now() + HOUR_MS, status: 'issued', transactionHash: null };
    packets.set(detail.packet.id, { ...detail, packet: { ...detail.packet, claimedCount: detail.packet.claimedCount + 1 }, eligibility: 'claimed', myClaim: claim, claims: [{ accountId: self, amount: claim.amount, claimedAt: claim.claimedAt, status: 'issued', best: false }] });
    refresh(detail.packet.scope);
    return claim;
  }
  if (name === 'wallet-packet-review') {
    const count = Number(payload?.count), total = String(payload?.total), key = String(payload?.scope), blessing = String(payload?.blessing ?? '');
    const share = String(BigInt(total) / BigInt(count));
    const input = { kind: 'packet', packet: { kind: 'room', scope: key, distribution: 'random', count, amounts: Array(count).fill(share), allocationSalts: Array(count).fill(hex('f')), blessing } };
    const id = hex('b').slice(0, 60) + String(Date.now() % 10000).padStart(4, '0');
    const payment = { id, input, phase: 'review', passwordRequired: false, total,
      order: { id, accountId: self, payer: address, recipient: deployment.packetContract, kind: 'packet', status: 'quoted', amount: total, createdAt: Date.now(), expiresAt: Date.now() + 5 * MINUTE_MS, confirmedAt: null, transactionHash: null, configVersion: 1, deployment, payload: input } };
    set(old => ({ ...old, wallet: { ...old.wallet, payment } } as RuntimeState));
    return payment;
  }
  if (name === 'wallet-confirm') {
    const at = (phase: string) => set(old => ({ ...old, wallet: { ...old.wallet, payment: old.wallet?.payment && { ...old.wallet.payment, phase } } } as RuntimeState));
    at('signing');
    // Paid: the card shows 发送中 at once (the room's own sending row), then lands as a listed 红包.
    (['submitting', 'pending', 'confirmed'] as const).forEach((phase, index) => setTimeout(() => {
      at(phase);
      if (phase !== 'confirmed') return;
      const payment = get().wallet?.payment as unknown as { id: string; total: string; input: { packet: { scope: string; count: number; blessing: string } } } | undefined;
      if (!payment) return;
      const { scope, count, blessing } = payment.input.packet;
      packets.set(payment.id, { packet: { id: payment.id, accountId: self, kind: 'room', scope, status: 'active', count, amount: payment.total, claimedCount: 0, claimedAmount: '0', createdAt: Date.now(), expiresAt: Date.now() + HOUR_MS },
        distribution: 'random', blessing, eligibility: 'sender', eligibleAt: null, myClaim: null, claims: [] });
      refresh(scope);
    }, 900 * (index + 1)));
    return get().wallet?.payment;
  }
  if (name === 'wallet-dismiss') { set(old => ({ ...old, wallet: { ...old.wallet, payment: undefined } } as RuntimeState)); return undefined; }
  if (name === 'wallet-refresh') return get().wallet;
  return undefined;
}
