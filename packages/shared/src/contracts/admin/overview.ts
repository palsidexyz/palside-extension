import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { nullable, amount } from './common.ts';
import { chainAddress, chainDeployment } from '../chain.ts';
import { adminHealth } from './health.ts';

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const time = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const day = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const activity = { accountsCreated: count, roomMessagesCreated: count, reportSubmissions: count, ordersCreated: count };
export const adminOverview = strictObject({
  checkedAt: time, timeZone: Type.Literal('Asia/Taipei'), todayStartAt: time, todayEndAt: time,
  totals: strictObject({ accountsPresent: count, activeTeams: count }),
  today: strictObject({ ...activity, ordersConfirmed: count, confirmedVolumes: Type.Array(strictObject({ chainId: chainDeployment.properties.chainId, token: chainAddress, decimals: chainDeployment.properties.decimals, amount })) }),
  // Seven Taipei days, oldest first, including the incomplete current day.
  series: Type.Array(strictObject({ day, ...activity }), { minItems: 7, maxItems: 7 }),
  queue: strictObject({ openCases: count, oldestQueuedAt: nullable(time), href: Type.Literal('#/review?status=open') }),
  // Ordinary background jobs with failed attempts awaiting retry; excludes completed or currently leased work.
  jobs: strictObject({ retrying: count, oldestRetryingAt: nullable(time), href: Type.Literal('#/system?status=retrying') }),
  // usedToday is site-wide reserved quota, not successful payments or a fraction of the per-account cap.
  // failedToday counts currently failed sponsored requests last updated in today's Taipei window.
  sponsorship: strictObject({ day, usedToday: count, failedToday: count, oldestFailedAt: nullable(time), perAccountDailyLimit: nullable(count), href: Type.Literal('#/chain') }),
  services: strictObject({ checkedAt: time, abnormalIds: Type.Array(Type.Index(Type.Union(adminHealth.properties.services.items), ['id']), { uniqueItems: true }), href: Type.Literal('#/system') }),
});
export type AdminOverview = Infer<typeof adminOverview>;
