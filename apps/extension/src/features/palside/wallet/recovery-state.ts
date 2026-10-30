import type { WalletRecovery } from '../../../runtime/wallet/controller';

export const recordLabels = { transfer: 'extension.wallet.transfer', tip: 'extension.wallet.tip', packet: 'extension.wallet.sentPacket', claim: 'extension.wallet.claimedPacket', 'packet-refund': 'extension.wallet.packetRefund' } as const;

export function recoveryLabel(item: WalletRecovery['items'][number]) {
  if (item.order.status === 'confirmed') return 'confirmed';
  if (item.order.status === 'failed' || item.relay?.state === 'failed') return 'recoveryFailed';
  if (item.relay?.state === 'included' || item.relay?.state === 'confirmed') return 'recoveryIndexing';
  if (item.relay?.state === 'cancelled') return 'recoveryCancelled';
  if (item.relay?.state === 'expired') return 'expired';
  if (item.relay && ['submitting', 'uncertain', 'submitted'].includes(item.relay.state)) return 'recoveryUnknown';
  if (item.order.status === 'submitted') return 'pending';
  if (item.order.status === 'expired') return 'expired';
  return item.canResume ? 'review' : 'pending';
}
