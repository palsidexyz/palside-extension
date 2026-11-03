import { HOUR_MS, MINUTE_MS } from '../units.ts';
/** Milliseconds without requests; expires operator sessions; docs/product/moderation.md#登录与会话. */
export const ADMIN_IDLE_MS = 12 * HOUR_MS;
/** UTF-16 code units; caps operator target IDs; docs/product/moderation.md#页面. */
export const ADMIN_ID_LENGTH = 256;
/** Trimmed graphemes; caps operator reasons and case notes; docs/product/moderation.md#举报与处理. */
export const ADMIN_REASON_LENGTH = 500;
/** Targets per action; caps operator batch changes; docs/product/moderation.md#页面. */
export const ADMIN_BATCH_LIMIT = 100;
/** Rows per CSV; caps operator exports; docs/product/moderation.md#页面. */
export const ADMIN_EXPORT_LIMIT = 10_000;
/** Milliseconds; locks operator credential checks; docs/product/moderation.md#登录与会话. */
export const ADMIN_LOCK_MS = 15 * MINUTE_MS;
/** Failed checks; triggers the operator credential lock; docs/product/moderation.md#登录与会话. */
export const ADMIN_MAX_FAILURES = 5;
/** Rows per page; defaults every operator list; docs/product/moderation.md#页面. */
export const ADMIN_PAGE_SIZE = 25;
/** Distinct reports per episode; defaults and bounds the operator review queue; docs/product/moderation.md#举报与处理. */
export const REPORT_THRESHOLD = { default: 2, min: 1, max: 5 } as const;
/** UTF-16 code units; bounds operator word-list entries; docs/product/moderation.md#搜索词表与链上配置. */
export const WORD_LENGTH = { min: 1, max: 100 } as const;
/** UTF-16 code units; caps operator word-list test input; docs/product/moderation.md#搜索词表与链上配置. */
export const WORD_TEST_LENGTH = 10_000;
/** Built-in reserved words; seeds the operator word list; docs/product/moderation.md#搜索词表与链上配置. */
export const BUILTIN_WORDS = [
  { id: 'reserved-official', word: '官方', normalized: '官方', kind: 'reserved' },
  { id: 'reserved-palside', word: 'Palside', normalized: 'palside', kind: 'reserved' },
  { id: 'reserved-admin', word: '管理员', normalized: '管理员', kind: 'reserved' },
  { id: 'reserved-support', word: '客服', normalized: '客服', kind: 'reserved' },
  { id: 'reserved-robinhood', word: 'Robinhood', normalized: 'robinhood', kind: 'reserved' },
] as const;
/** Milliseconds; coalesces operator search requests; docs/product/moderation.md#搜索词表与链上配置. */
export const SEARCH_DEBOUNCE_MS = 250;
