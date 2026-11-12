import { NEW_ACCOUNT_MS } from './accounts.ts';
import { MINUTE_MS, DAY_MS, HOUR_MS } from '../units.ts';
/** Chain IDs; admits wallet bindings and deployed payment networks; docs/product/wallet.md#状态与限制. */
export const SUPPORTED_CHAINS = [4663, 31337] as const;
/** Whole PALS; tip quick amounts, default first-middle; docs/product/wallet.md#打赏. */
export const TIP_AMOUNTS = { options: ['10000', '50000', '100000'], initial: '50000' } as const;
/** Chain IDs; restricts production deployment choices; docs/product/wallet.md#状态与限制. */
export const PRODUCTION_CHAINS = [SUPPORTED_CHAINS[0]] as const;
/** Milliseconds; hides prices and warns operators when the chain head is stale; docs/product/wallet.md#状态与限制. */
export const CHAIN_PRICE_MAX_AGE_MS = 5 * MINUTE_MS;
/** PALS per payment and UTC day; defaults and caps operator quick-pay settings; docs/product/wallet.md#收款与转账. */
export const QUICK_PAY_LIMITS = { single: '250000', daily: '1000000' } as const;
/** Claims per transaction; bounds automatic packet settlement; docs/product/wallet.md#红包. */
export const SETTLE_BATCH = 20;
/** Counts and milliseconds; bounds payment orders, packet eligibility and sponsorship; docs/product/wallet.md#状态与限制. */
export const CHAIN_RULES = Object.freeze({
  /** Milliseconds; expires unsigned payment orders; docs/product/wallet.md#状态与限制. */
  orderLifetimeMs: 5 * MINUTE_MS,
  /** Milliseconds present; qualifies room packet claims; docs/product/wallet.md#红包. */
  roomStayMs: 30_000,
  /** Milliseconds of account age; qualifies room packet claims; docs/product/wallet.md#红包. */
  accountAgeMs: NEW_ACCOUNT_MS,
  /** Milliseconds; groups tips to the same message; docs/product/wallet.md#打赏. */
  tipGroupMs: 30_000,
  /** Whole PALS; caps a custom tip amount; docs/product/wallet.md#打赏. */
  maxTipPals: 10_000_000,
  /** Graphemes; limits a packet blessing; docs/product/wallet.md#红包. */
  blessingLength: 24,
  /** Active packets per token; caps simultaneous room packets; docs/product/wallet.md#红包. */
  maxRoomPackets: 5,
  /** Shares per packet; mirrors the escrow maximum count; docs/product/wallet.md#红包. */
  maxPacketCount: 100,
  /** Signed packet orders per account per hour; limits packet creation; docs/product/wallet.md#红包. */
  packetsPerHour: 10,
  /** Claims per account per UTC day; limits room packet grabs; docs/product/wallet.md#红包. */
  roomClaimsPerDay: 20,
  /** Transactions per account per UTC day; defaults operator sponsorship settings; docs/product/wallet.md#网络费与收费. */
  dailySponsoredLimit: 50,
});
/** Milliseconds by packet kind; closes grabbing before escrow settlement; docs/product/wallet.md#红包. */
export const PACKET_LIFETIMES = { team: DAY_MS, room: HOUR_MS } as const;
/** Milliseconds; allows assigned shares to settle before escrow refunds; docs/product/wallet.md#红包. */
export const PACKET_SETTLEMENT_MS = 2 * HOUR_MS;
/** Transactions per account per UTC day; bounds operator sponsorship settings; docs/product/wallet.md#网络费与收费. */
export const SPONSORED_DAILY_LIMIT = { min: 0, max: 10_000 } as const;
/** PALS in base units; defaults the operator minimum liquidity for displaying prices; docs/product/wallet.md#状态与限制. */
export const CHAIN_MINIMUM_LIQUIDITY = '0';
