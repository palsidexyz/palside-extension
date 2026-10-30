import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChainOrderInput } from '@palside/shared/contracts/chain';
import type { ApiResult } from '../src/runtime/transport/api';
import { TeamLevel } from '../src/features/palside/teams/team-level';
import { PacketPage } from '../src/features/palside/wallet/packet';
import { createRoot } from 'react-dom/client';
import { IntegrationIntl } from './intl';
import { reviewStatus } from './review-harness';
import { WalletSettings } from '../src/features/palside/wallet/security';
import { RoomPayments, TipPayment } from '../src/features/palside/wallet/room-payments';
import { WalletHome, WalletReceive, WalletRecords } from '../src/features/palside/wallet/wallet';
import { PaymentSheet, openPayment, openTransfer, usePaymentSession } from '../src/features/palside/wallet/payment-sheet';
import { TeamPaymentCard } from '../src/features/palside/wallet/team-feed';
import type { PalsideController } from '../src/features/palside/app/use-palside';
import type { WalletState } from '../src/runtime/wallet/controller';
import type { PaymentPhase } from '../src/domain/wallet/model';
import type { CommandFunction } from '../src/runtime/transport/command-map';
import { palsideFixtures } from './fixtures';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Test-only host for production wallet components. No signer, network or real account exists here.
const query = new URLSearchParams(location.search), scene = query.get('scene') ?? 'home';
const address = '0x1111111111111111111111111111111111111111', recipient = '0x2222222222222222222222222222222222222222';
const unit = 10n ** 18n, now = 1_792_627_200_000;
const roomKey = 'token:Robinhood:0x1111111111111111111111111111111111111111';
const packet = { id: '0x' + 'c'.repeat(64), accountId: 'mia', kind: 'room' as const, scope: roomKey, status: 'active' as const, count: 20, amount: String(100n * unit), claimedCount: 4, claimedAmount: String(20n * unit), createdAt: now, expiresAt: now + 3600000 };
const chainRoom = { key: roomKey, packets: [packet] };
const deployment = { chainId: 4663 as const, token: '0x3333333333333333333333333333333333333333', packetContract: '0x5555555555555555555555555555555555555555', decimals: 18 as const };
const invitationPacket = { ...packet, id: '0x' + 'e'.repeat(64), accountId: palsideFixtures.self, kind: 'invitation' as const, scope: palsideFixtures.teams[0]!.id };
const invitationDetail = { packet: invitationPacket, distribution: 'equal', blessing: '邀请新队友的测试红包', eligibility: 'sender', eligibleAt: null, myClaim: null, claims: [] };
// 小队里的付款，按聊天时间线的样子排：我发出的、转给我的（还在确认）、两位队友之间的、一个红包。
const transfer = (id: string, accountId: string, recipientId: string, amount: bigint, status: 'confirmed' | 'submitted') => ({ id, accountId, recipientId, amount: String(amount * unit), status, createdAt: now, confirmedAt: status === 'confirmed' ? now : null });
const feedItems = [
  { id: 'feed-mine', timestamp: now, transfer: transfer('feed-mine', palsideFixtures.self, 'mia', 20n, 'confirmed') },
  { id: 'feed-incoming', timestamp: now + 60_000, transfer: transfer('feed-incoming', 'mia', palsideFixtures.self, 5n, 'submitted') },
  { id: 'feed-between', timestamp: now + 120_000, transfer: transfer('feed-between', 'robin', 'leo', 12n, 'confirmed') },
  { id: 'feed-packet', timestamp: now + 180_000, packet: { ...invitationDetail, packet: { ...invitationPacket, id: '0x' + 'f'.repeat(64), accountId: 'kai', kind: 'team' as const, createdAt: now }, distribution: 'random', blessing: '周五收盘红包', eligibility: 'eligible' } },
];
function initial(): WalletState {
  const phase = (scene === 'done' ? 'confirmed' : ['review', 'password', 'pending', 'failed'].includes(scene) ? scene : 'review') as PaymentPhase;
  const input = { kind: 'transfer' as const, recipient, amount: String(50n * unit) };
  return { address, availability: scene === 'closed' ? 'closed' : scene === 'locked' ? 'locked' : scene === 'offline' ? 'offline' : 'ready', preferences: { smallPayments: false, hideAmounts: false }, openedNotice: false,
    config: { enabled: scene !== 'closed', version: 1, deployment, dailySponsoredLimit: 20, updatedAt: now },
    balance: { address, token: deployment.token, chainId: 4663, balance: String(4200n * unit), blockNumber: '1200' },
    records: { items: [], nextCursor: null },
    payment: { id: '0x' + 'b'.repeat(64), input, phase, passwordRequired: true, total: input.amount, ...(phase === 'failed' ? { error: 'CHAIN_REVERTED' } : {}), order: { id: '0x' + 'b'.repeat(64), accountId: palsideFixtures.self, payer: address, recipient, kind: 'transfer', status: phase === 'failed' ? 'failed' : phase === 'pending' ? 'submitted' : phase === 'confirmed' ? 'confirmed' : 'quoted', amount: input.amount, createdAt: now, expiresAt: now + 300000, confirmedAt: phase === 'confirmed' ? now : null, transactionHash: null, configVersion: 1, deployment, payload: input } },
  };
}
function Fixture() {
  usePaymentSession(palsideFixtures.self);
  const [wallet, setWallet] = useState(initial), [page, setPage] = useState(scene);
  const walletRef = useRef(wallet), eligibleAt = useRef<number | undefined>(undefined), grabbed = useRef<ApiResult<'chain.claim'> | undefined>(undefined);
  useLayoutEffect(() => { walletRef.current = wallet; }, [wallet]);
  const command = useCallback(async (name: string, payload?: Record<string, unknown>) => {
    const calls = JSON.parse(document.documentElement.dataset.chainCalls ?? '[]') as unknown[];
    calls.push({ name, payload }); document.documentElement.dataset.chainCalls = JSON.stringify(calls);
    const wallet = walletRef.current;
    const quote = (input: ChainOrderInput, amount: string) => {
      const payment = { ...initial().payment!, input, phase: 'review' as const, total: amount, order: { ...initial().payment!.order, kind: input.kind, amount, payload: input, status: 'quoted' as const } };
      setWallet(value => ({ ...value, payment })); return payment;
    };
    if (name === 'wallet-room') return chainRoom;
    if (name === 'wallet-team') { if (payload?.teamId !== invitationPacket.scope) throw Error('Wrong fixture team'); return { packets: [invitationDetail], transfers: [], nextCursor: null }; }
    if (name === 'wallet-review') {
      const input = payload?.input as ChainOrderInput;
      if (input?.kind === 'tip' && input.messageId === 'fixture-tip-message' && BigInt(input.amount) > 0n) return quote(input, input.amount);
      if (input?.kind === 'transfer' && 'recipient' in input && input.recipient === recipient && input.amount === String(12n * unit)) return quote(input, input.amount);
      throw Error('Unmodelled fixture review');
    }
    if (name === 'wallet-packet-review') {
      if (payload?.kind !== 'invitation' || payload.scope !== invitationPacket.scope || payload.distribution !== 'equal' || payload.count !== 5 || payload.total !== String(25n * unit) || payload.blessing !== '欢迎队友') throw Error('Unexpected invitation fixture review');
      return quote({ kind: 'packet', packet: { kind: 'invitation', scope: invitationPacket.scope, distribution: 'equal', count: 5, amounts: Array(5).fill(String(5n * unit)), allocationSalts: Array(5).fill('0x' + 'f'.repeat(64)), blessing: '欢迎队友' } }, String(25n * unit));
    }
    if (name === 'wallet-claim') {
      if (payload?.packetId !== packet.id || !eligibleAt.current || Date.now() < eligibleAt.current) throw Error('Premature or wrong packet claim');
      // The service assigns the share at once and settles it later: the grab returns it as 入账中.
      grabbed.current = { packetId: packet.id, accountId: palsideFixtures.self, recipient: address, index: 4, amount: String(5n * unit), claimedAt: Date.now(), nonce: '1', deadline: now + 3600000, status: 'issued' as const, transactionHash: null };
      return grabbed.current;
    }
    if (name === 'wallet-packet') {
      if (payload?.id === invitationPacket.id) return invitationDetail;
      if (payload?.id !== packet.id) throw Error('Unknown fixture packet');
      // Short explicit fixture deadline exercises the production refresh timer; it does not prove a real 30-second stay.
      eligibleAt.current ??= Date.now() + 3000;
      const eligible = Date.now() >= eligibleAt.current;
      const mine = grabbed.current, others = ['mia', 'leo', 'ava', 'kai'].map((accountId, index) => ({ accountId, amount: String(BigInt(index + 3) * unit), claimedAt: now + index * 60000, status: 'confirmed' as const, best: false }));
      if (mine) return { packet: { ...packet, claimedCount: 5, claimedAmount: String(25n * unit) }, distribution: 'random', blessing: '测试红包，祝大家好运', eligibility: 'claimed', eligibleAt: null, myClaim: mine, claims: [...others, { accountId: mine.accountId, amount: mine.amount, claimedAt: mine.claimedAt, status: 'issued' as const, best: false }] };
      return { packet, distribution: 'random', blessing: '测试红包，祝大家好运', eligibility: eligible ? 'eligible' : 'stay-too-short', eligibleAt: eligible ? null : eligibleAt.current, myClaim: null, claims: others };
    }
    if (name === 'wallet-export-private-key') {
      if (document.documentElement.dataset.holdExport === 'true') {
        document.documentElement.dataset.exportPending = 'true';
        await new Promise<void>(resolve => window.addEventListener('fixture-export-release', () => resolve(), { once: true }));
        delete document.documentElement.dataset.exportPending;
      }
      return { id: 'fixture-export', privateKey: 'fixture-key-not-a-real-private-key', expiresAt: Date.now() + 30000 };
    }
    if (name === 'wallet-hide-private-key') return;
    if (name === 'wallet-receive') return { uri: address };
    if (name === 'wallet-records') {
      if (scene === 'records' && calls.filter(call => (call as { name: string }).name === name).length === 1) throw Error('Fixture record request failed');
      const records: WalletState['records'] = { items: [{ id: 'fixture-transfer', kind: 'transfer', status: 'confirmed', orderId: null, packetId: null, orderAmount: null, part: 'transfer', transactionHash: '0x' + 'a'.repeat(64), from: recipient, to: address, amount: String(300n * unit), blockNumber: '1199', transactionIndex: 1, logIndex: 0, occurredAt: now }], nextCursor: null };
      setWallet(value => ({ ...value, records })); return records;
    }
    if (name === 'wallet-refresh') return wallet;
    if (name === 'wallet-confirm' || name === 'wallet-dismiss') {
      if (payload?.accountId !== palsideFixtures.self || payload.paymentId !== wallet.payment?.id || wallet.payment?.order.accountId !== palsideFixtures.self) throw Error('Wrong fixture payment owner');
      const payment = name === 'wallet-confirm' ? { ...wallet.payment, phase: payload.password ? 'pending' as const : 'password' as const } : undefined;
      walletRef.current = { ...wallet, payment };
      setWallet(walletRef.current);
      return payment;
    }
    if (name === 'wallet-preferences') setWallet(value => ({ ...value, preferences: { ...value.preferences, hideAmounts: !!payload?.hideAmounts } }));
    if (name === 'wallet-unlock') setWallet(value => ({ ...value, availability: 'ready' }));
    return wallet.payment;
  }, []);
  const controller = { live: { state: { account: { id: palsideFixtures.self }, authenticated: true, wallet, chainRoom, chainTeam: { teamId: invitationPacket.scope, packets: [invitationDetail] }, rooms: { pinned: scene === 'invitation' ? undefined : roomKey, avatars: {}, current: { messages: [{ id: 'fixture-tip-message', author: { id: 'fixture-tip-author', nickname: 'Mia', avatarId: null }, text: '这条测试弹幕值得打赏' }] } } }, command: command as CommandFunction }, now, run: command, people: palsideFixtures.people, teams: palsideFixtures.teams, me: palsideFixtures.people.find(person => person.id === palsideFixtures.self), data: palsideFixtures, team: { ...palsideFixtures.teams[0], activitySummary: { level: 2, rank: 12, isNew: false, points: 196, nextLevel: 3, pointsToNextLevel: 254, downgrade: null, averageDailyActive: 6.5, averageDailyMessages: 86, sharedViewingHours: 41, activeMembers7d: 7, rankingStatus: 'ranked', calculatedAt: now } }, current: palsideFixtures.teams[0]!.id, go: (next: string) => setPage(next.replace('wallet-', '')), copy: async () => true } as unknown as PalsideController;
  useEffect(() => {
    // Payment scenes open the production sheet over the wallet home, exactly as an entry point would.
    if (['review', 'password', 'pending', 'done', 'failed'].includes(scene)) openPayment(initial().payment!.id);
    if (scene === 'transfer') openTransfer();
    reviewStatus('ready');
  }, []);
  return <main data-palside-app data-appearance={query.get('theme') ?? 'light'} data-chain-scene={scene} style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box', background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
    {page === 'level' ? <TeamLevel c={controller} /> : page === 'tip' ? <TipPayment c={controller} messageId="fixture-tip-message" onClose={() => setPage('home')} /> : page === 'invitation' ? <PacketPage c={controller} invitation /> : page === 'export' ? <WalletSettings c={controller} /> : page === 'room' ? <RoomPayments c={controller} roomKey={roomKey} /> : page === 'feed' ? <div data-feed style={{ display: 'flex', flexDirection: 'column' }}>{feedItems.map(item => <TeamPaymentCard key={item.id} c={controller} item={item as never} />)}</div> : page === 'receive' ? <WalletReceive c={controller} /> : page === 'records' ? <WalletRecords c={controller} /> : <WalletHome c={controller} />}
    <PaymentSheet c={controller} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Fixture /></IntegrationIntl>);
