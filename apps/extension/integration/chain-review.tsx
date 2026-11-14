import { SECOND_MS, HOUR_MS, MINUTE_MS } from '@palside/shared/units';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChainOrderInput } from '@palside/shared/contracts/chain';
import type { ApiResult } from '../src/runtime/transport/api';
import { TeamLevel } from '../src/features/palside/teams/team-level';
import { PacketPage } from '../src/features/palside/wallet/packet';
import { createRoot } from 'react-dom/client';
import { IntegrationIntl } from './intl';
import { reviewStatus } from './review-harness';
import { WalletSettings } from '../src/features/palside/wallet/security';
import { RoomPacketCard, TipPayment } from '../src/features/palside/wallet/room-payments';
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
const packet = { id: '0x' + 'c'.repeat(64), accountId: 'mia', kind: 'room' as const, scope: roomKey, status: 'active' as const, count: 20, amount: String(100n * unit), claimedCount: 4, claimedAmount: String(20n * unit), createdAt: now, expiresAt: now + HOUR_MS };
const chainRoom = { key: roomKey, packets: [packet] };
const deployment = { chainId: 4663 as const, token: '0x3333333333333333333333333333333333333333', packetContract: '0x5555555555555555555555555555555555555555', decimals: 18 as const };
const teamPacket = { ...packet, id: '0x' + 'e'.repeat(64), accountId: palsideFixtures.self, kind: 'team' as const, scope: palsideFixtures.teams[0]!.id };
const teamDetail = { packet: teamPacket, distribution: 'equal', blessing: '小队测试红包', eligibility: 'eligible', eligibleAt: null, myClaim: null, claims: [] };
// 小队里的付款，按聊天时间线的样子排：我发出的、转给我的（还在确认）、两位队友之间的、一个红包。
const transfer = (id: string, accountId: string, recipientId: string, amount: bigint, status: 'confirmed' | 'submitted') => ({ id, accountId, recipientId, amount: String(amount * unit), status, createdAt: now, submittedAt: now, confirmedAt: status === 'confirmed' ? now : null });
const feedItems = [
  { id: 'feed-mine', timestamp: now, transfer: transfer('feed-mine', palsideFixtures.self, 'mia', 20n, 'confirmed') },
  { id: 'feed-incoming', timestamp: now + MINUTE_MS, transfer: transfer('feed-incoming', 'mia', palsideFixtures.self, 5n, 'submitted') },
  { id: 'feed-between', timestamp: now + 120_000, transfer: transfer('feed-between', 'robin', 'leo', 12n, 'confirmed') },
  { id: 'feed-packet', timestamp: now + 180_000, packet: { ...teamDetail, packet: { ...teamPacket, id: '0x' + 'f'.repeat(64), accountId: 'kai', kind: 'team' as const, createdAt: now }, distribution: 'random', blessing: '周五收盘红包', eligibility: 'eligible' } },
  // 我发的、已领完的红包：卡片下面是我自己那条，加上队友合成的一条。
  { id: 'feed-claimed', timestamp: now + 240_000, packet: { ...teamDetail, packet: { ...teamPacket, id: '0x' + 'e'.repeat(64), accountId: palsideFixtures.self, kind: 'team' as const, count: 4, claimedCount: 4, status: 'exhausted' as const, createdAt: now }, distribution: 'random', blessing: '恭喜发财，大吉大利', eligibility: 'claimed',
    claims: [palsideFixtures.self, 'mia', 'robin', 'leo'].map((accountId, index) => ({ accountId, amount: String(BigInt(index + 1) * unit), claimedAt: now + 250_000 + index * 1_000, status: 'issued' as const, best: index === 3 })) } },
  // 我刚付款、还没上链的红包，和一个付款失败的：只有我看得到。
  { id: 'feed-sending', timestamp: now + 300_000, packet: { ...teamDetail, packet: { ...teamPacket, id: '0x' + 'd'.repeat(64), status: 'pending' as const, claimedCount: 0, createdAt: now + 300_000 }, blessing: '刚发的红包', eligibility: 'unavailable' } },
  { id: 'feed-failed', timestamp: now + 320_000, packet: { ...teamDetail, packet: { ...teamPacket, id: '0x' + 'a'.repeat(64), status: 'failed' as const, claimedCount: 0, createdAt: now + 320_000 }, blessing: '没发出去的红包', eligibility: 'unavailable' } },
];
function initial(): WalletState {
  const phase = (scene === 'done' ? 'confirmed' : scene === 'flow' ? 'password' : ['review', 'password', 'pending', 'failed'].includes(scene) ? scene : 'review') as PaymentPhase;
  const input = { kind: 'transfer' as const, recipient, amount: String(50n * unit) };
  return { address, availability: scene === 'closed' ? 'closed' : scene === 'locked' ? 'locked' : scene === 'offline' ? 'offline' : scene === 'loading' ? 'loading' : 'ready', preferences: { smallPayments: false, hideAmounts: false }, openedNotice: false,
    config: { enabled: scene !== 'closed', version: 1, deployment, dailySponsoredLimit: 50, quickPay: { single: String(20n * unit), daily: String(100n * unit) }, minimumLiquidity: String(BigInt(SECOND_MS) * unit), updatedAt: now },
    balance: { address, token: deployment.token, chainId: 4663, balance: String(4200n * unit), blockNumber: '1200' },
    records: { items: [], nextCursor: null },
    payment: { id: '0x' + 'b'.repeat(64), input, phase, passwordRequired: true, total: input.amount, ...(phase === 'failed' ? { error: 'CHAIN_REVERTED' } : {}), order: { id: '0x' + 'b'.repeat(64), accountId: palsideFixtures.self, payer: address, recipient, kind: 'transfer', status: phase === 'failed' ? 'failed' : phase === 'pending' ? 'submitted' : phase === 'confirmed' ? 'confirmed' : 'quoted', amount: input.amount, createdAt: now, expiresAt: now + 300000, confirmedAt: phase === 'confirmed' ? now : null, transactionHash: null, configVersion: 1, deployment, payload: input } },
  };
}
function Fixture() {
  usePaymentSession(palsideFixtures.self);
  const [wallet, setWallet] = useState(initial), [page, setPage] = useState(scene), [chainRevision, setChainRevision] = useState(0);
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
    if (name === 'wallet-team') { if (payload?.teamId !== teamPacket.scope) throw Error('Wrong fixture team'); return { packets: [teamDetail], transfers: [], nextCursor: null }; }
    if (name === 'wallet-review') {
      const input = payload?.input as ChainOrderInput;
      if (input?.kind === 'tip' && input.messageId === 'fixture-tip-message' && BigInt(input.amount) > 0n) return quote(input, input.amount);
      if (input?.kind === 'transfer' && 'recipient' in input && input.recipient === recipient && input.amount === String(12n * unit)) return quote(input, input.amount);
      throw Error('Unmodelled fixture review');
    }
    if (name === 'wallet-packet-review') {
      if (payload?.kind !== 'team' || payload.scope !== teamPacket.scope || payload.distribution !== 'random' || payload.total !== String(25n * unit) || payload.blessing !== '周五收盘') throw Error('Unexpected packet fixture review');
      return quote({ kind: 'packet', packet: { kind: 'team', scope: teamPacket.scope, distribution: 'random', count: 5, amounts: Array(5).fill(String(5n * unit)), allocationSalts: Array(5).fill('0x' + 'f'.repeat(64)), blessing: '周五收盘' } }, String(25n * unit));
    }
    if (name === 'wallet-claim') {
      if (payload?.packetId !== packet.id || !eligibleAt.current || Date.now() < eligibleAt.current) throw Error('Premature or wrong packet claim');
      // The service assigns the share at once and settles it later: the grab returns it as 入账中.
      grabbed.current = { packetId: packet.id, accountId: palsideFixtures.self, recipient: address, index: 4, amount: String(5n * unit), claimedAt: Date.now(), nonce: '1', deadline: now + HOUR_MS, status: 'issued' as const, transactionHash: null };
      // As in production, the claim's chain event arrives at once and refreshes open packets while the seal is still spinning.
      setChainRevision(value => value + 1);
      return grabbed.current;
    }
    if (name === 'wallet-packet') {
      if (payload?.id === teamPacket.id) return teamDetail;
      if (payload?.id !== packet.id) throw Error('Unknown fixture packet');
      // Short explicit fixture deadline exercises the production refresh timer; it does not prove a real 30-second stay.
      eligibleAt.current ??= Date.now() + 3000;
      const eligible = Date.now() >= eligibleAt.current;
      const mine = grabbed.current, others = ['mia', 'leo', 'ava', 'kai'].map((accountId, index) => ({ accountId, amount: String(BigInt(index + 3) * unit), claimedAt: now + index * MINUTE_MS, status: 'confirmed' as const, best: false }));
      if (mine) return { packet: { ...packet, claimedCount: 5, claimedAmount: String(25n * unit) }, distribution: 'random', blessing: '测试红包，祝大家好运', eligibility: 'claimed', eligibleAt: null, myClaim: mine, claims: [...others, { accountId: mine.accountId, amount: mine.amount, claimedAt: mine.claimedAt, status: 'issued' as const, best: false }] };
      return { packet, distribution: 'random', blessing: '测试红包，祝大家好运', eligibility: eligible ? 'eligible' : 'stay-too-short', eligibleAt: eligible ? null : eligibleAt.current, myClaim: null, claims: others };
    }
    if (name === 'wallet-receive') return { uri: address };
    if (name === 'wallet-records') {
      if (scene === 'records' && calls.filter(call => (call as { name: string }).name === name).length === 1) throw Error('Fixture record request failed');
      const records: WalletState['records'] = { items: [{ id: 'fixture-transfer', kind: 'transfer', status: 'confirmed', orderId: null, packetId: null, orderAmount: null, part: 'transfer', transactionHash: '0x' + 'a'.repeat(64), from: recipient, to: address, amount: String(300n * unit), blockNumber: '1199', transactionIndex: 1, logIndex: 0, occurredAt: now }], nextCursor: null };
      setWallet(value => ({ ...value, records })); return records;
    }
    if (name === 'wallet-refresh') return wallet;
    if (name === 'wallet-confirm' || name === 'wallet-dismiss') {
      if (payload?.accountId !== palsideFixtures.self || payload.paymentId !== wallet.payment?.id || wallet.payment?.order.accountId !== palsideFixtures.self) throw Error('Wrong fixture payment owner');
      // scene=flow plays the whole wait after the PIN: a held confirm, then 签名 → 发送 → 等待确认 → 已到账 on fixture timers.
      if (scene === 'flow' && name === 'wallet-confirm' && payload.password) {
        const at = (phase: PaymentPhase) => { walletRef.current = { ...walletRef.current, payment: { ...walletRef.current.payment!, phase } }; setWallet(walletRef.current); };
        await new Promise(resolve => setTimeout(resolve, 900));
        at('signing');
        // ?end=failed ends on a reverted payment instead, to show the failure in place on the stage it reached.
        const end = query.get('end') === 'failed' ? 'failed' as const : 'confirmed' as const;
        (['submitting', 'pending', end] as const).forEach((phase, index) => setTimeout(() => {
          if (phase === 'failed') { walletRef.current = { ...walletRef.current, payment: { ...walletRef.current.payment!, phase, error: 'CHAIN_REVERTED' } }; setWallet(walletRef.current); }
          else at(phase);
        }, 1600 * (index + 1)));
        return walletRef.current.payment;
      }
      const payment = name === 'wallet-confirm' ? { ...wallet.payment, phase: payload.password ? 'pending' as const : 'password' as const } : undefined;
      walletRef.current = { ...wallet, payment };
      setWallet(walletRef.current);
      return payment;
    }
    if (name === 'wallet-preferences') setWallet(value => ({ ...value, preferences: { ...value.preferences, hideAmounts: !!payload?.hideAmounts } }));
    if (name === 'wallet-unlock') setWallet(value => ({ ...value, availability: 'ready' }));
    return wallet.payment;
  }, []);
  const controller = { live: { state: { account: { id: palsideFixtures.self }, authenticated: true, chainRevision, connection: { networkOnline: !query.has('offline'), service: 'ready', messaging: 'ready', retrying: false }, wallet, chainRoom, chainTeam: { teamId: teamPacket.scope, packets: [teamDetail] }, rooms: { pinned: scene === 'packet' ? undefined : roomKey, avatars: {}, current: { messages: [{ id: 'fixture-tip-message', author: { wallet: null, id: 'fixture-tip-author', nickname: 'Mia', avatarId: null }, text: '这条测试弹幕值得打赏' }] } } }, command: command as CommandFunction }, now, run: command, people: palsideFixtures.people, teams: palsideFixtures.teams, me: palsideFixtures.people.find(person => person.id === palsideFixtures.self), data: palsideFixtures, team: { ...palsideFixtures.teams[0], activitySummary: { level: 2, rank: 12, isNew: false, points: 196, nextLevel: 3, pointsToNextLevel: 254, downgrade: null, averageDailyActive: 6.5, averageDailyMessages: 86, sharedViewingHours: 41, activeMembers7d: 7, rankingStatus: 'ranked', calculatedAt: now } }, current: palsideFixtures.teams[0]!.id, go: (next: string) => setPage(next.replace('wallet-', '')), copy: async () => true } as unknown as PalsideController;
  useEffect(() => {
    // Payment scenes open the production sheet over the wallet home, exactly as an entry point would.
    if (['review', 'password', 'pending', 'done', 'failed', 'flow'].includes(scene)) openPayment(initial().payment!.id);
    if (scene === 'transfer') openTransfer();
    reviewStatus('ready');
  }, []);
  return <main data-palside-app data-appearance={query.get('theme') ?? 'light'} data-chain-scene={scene} style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box', background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
    {page === 'level' ? <TeamLevel c={controller} /> : page === 'tip' ? <TipPayment c={controller} messageId="fixture-tip-message" onClose={() => setPage('home')} /> : page === 'packet' ? <PacketPage c={controller} /> : page === 'settings' ? <WalletSettings c={controller} /> : page === 'room' ? <div data-room-packet><RoomPacketCard c={controller} packet={packet} /></div> : page === 'feed' ? <div data-feed style={{ display: 'flex', flexDirection: 'column' }}>{feedItems.map(item => <TeamPaymentCard key={item.id} c={controller} item={item as never} />)}</div> : page === 'receive' ? <WalletReceive c={controller} /> : page === 'records' ? <WalletRecords c={controller} /> : <WalletHome c={controller} />}
    <PaymentSheet c={controller} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Fixture /></IntegrationIntl>);
