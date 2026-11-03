import { SECOND_MS, MINUTE_MS, HOUR_MS } from '../units.ts';
/** Milliseconds; starts retries for chain obligations; docs/product/wallet.md#状态与限制. */
export const CHAIN_RETRY_BASE_MS = 5 * SECOND_MS;
/** Milliseconds; caps retries for chain obligations; docs/product/wallet.md#状态与限制. */
export const CHAIN_RETRY_MAX_MS = 5 * MINUTE_MS;
/** Milliseconds; alerts operators about persistent money failures; docs/product/moderation.md#页面. */
export const MONEY_FAILURE_ALERT_MS = HOUR_MS;
/** Milliseconds; bounds each background work pass; docs/product/moderation.md#页面. */
export const WORK_BUDGET_MS = 5 * SECOND_MS;
